import {
  createHook,
  getWorkflowMetadata,
  getWritable,
  type Hook,
} from "#compiled/@workflow/core/index.js";

import type {
  DeliverHookPayload,
  DeliverPayload,
  HookPayload,
  RunInput,
  SessionCapabilities,
} from "#channel/types.js";
import { readRootSessionId } from "#execution/eve-workflow-attributes.js";
import type { RunMode } from "#shared/run-mode.js";
import { notifyDelegatedParentStep } from "#execution/delegated-parent-notification.js";
import {
  createDelegatedSubagentCancellationResult,
  createDelegatedSubagentErrorResult,
  createDelegatedSubagentSuccessResult,
} from "#execution/delegated-parent-result.js";
import type { DurableSessionState } from "#execution/durable-session-store.js";
import type { NextDriverAction } from "#execution/next-driver-action.js";
import { normalizeSerializableError } from "#execution/workflow-errors.js";
import { resolveVercelProductionCallbackBaseUrl } from "#execution/workflow-callback-url.js";
import { createSessionStep } from "#execution/create-session-step.js";
import { dispatchCodeModeRuntimeActionsStep } from "#execution/dispatch-code-mode-runtime-actions-step.js";
import { dispatchRuntimeActionsStep } from "#execution/dispatch-runtime-actions-step.js";
import { emitTerminalSessionFailureStep } from "#execution/workflow-steps.js";
import { fireSessionCallbackStep } from "#execution/session-callback-step.js";
import { createSessionCancellationHookId } from "#execution/cancellation.js";
import { finalizeCancellationStep } from "#execution/cancellation-step.js";
import { cancelDescendantsStep } from "#execution/cancel-descendants-step.js";
import {
  readWorkflowEntrySerializedContext,
  writeSerializedSessionId,
} from "#execution/workflow-serialized-context.js";
import {
  assertCanPark,
  awaitCancellationSignal,
  createActiveTurnCancellation,
  dispatchAndAwaitTurn,
  raceTurnCancellation,
  rearmActiveTurnCancellation,
  routeDeliverForChildren,
  waitForNextDeliver,
  waitForPendingRuntimeActionResults,
  type ActiveTurnCancellation,
  type DriverCancellation,
  type DriverDispatchOutcome,
} from "#execution/workflow-entry-helpers.js";

// workflow-entry.ts is the durable workflow body — the bundler rejects
// node built-ins here, so `internal/logging.ts` cannot be imported.
// Error logging happens inside `emitTerminalSessionFailureStep`.

/**
 * Serializable workflow-entry input. All runtime state travels via
 * `serializedContext`, which is produced by `serializeContext(ctx)`
 * and deserialized at each `"use step"` boundary.
 */
export interface WorkflowEntryInput {
  readonly input: RunInput["input"];
  readonly serializedContext: Record<string, unknown>;
}

export interface WorkflowEntryResult {
  readonly output: unknown;
}

type DriverTransition =
  | { readonly action: NextDriverAction; readonly kind: "action" }
  | { readonly kind: "done"; readonly result: WorkflowEntryResult };

/**
 * Long-lived workflow entrypoint. Handles both root sessions and
 * delegated child sessions: root sessions expose only parent
 * control-plane events; delegated children publish their full progress
 * on a child stream and resume the parked parent with a
 * `subagent-result` on completion.
 *
 * Dispatches on the closed-contract {@link NextDriverAction} returned
 * by each step. The only session-shape flag the driver reads (besides
 * identity) is `hasProxyInputRequests`, the documented short-circuit
 * for hook-payload routing.
 */
export async function workflowEntry(input: WorkflowEntryInput): Promise<WorkflowEntryResult> {
  "use workflow";

  const { workflowRunId: sessionId } = getWorkflowMetadata();
  // Seed `eve.sessionId` so the terminal failure emitter can stamp it
  // onto `session.failed` even if `createSessionStep` itself throws.
  writeSerializedSessionId(input.serializedContext, sessionId);

  const driverWritable = getWritable<Uint8Array>();

  try {
    const {
      bundle: serializedBundle,
      capabilities,
      continuationToken,
      mode,
    } = readWorkflowEntrySerializedContext(input.serializedContext);

    // Derived once and reused for createSession + tag emission so the
    // chain-root id can never drift between persisted session and tags.
    const rootSessionIdFromParent = readRootSessionId(input.serializedContext);

    // `createSessionStep` emits the session/subagent-root `$eve.*` tags
    // from inside its own step body (see create-session-step.ts), so no
    // separate attribute step is spent here in the workflow body.
    const { state: sessionState } = await createSessionStep({
      compiledArtifactsSource: serializedBundle.source,
      continuationToken,
      inputMessage: input.input.message,
      nodeId: serializedBundle.nodeId,
      outputSchema: input.input.outputSchema,
      rootSessionId: rootSessionIdFromParent,
      serializedContext: input.serializedContext,
      sessionId,
    });

    return await runDriverLoop({
      capabilities,
      driverWritable,
      initialInput: {
        kind: "deliver",
        payloads: [
          {
            message: input.input.message,
            context: input.input.context,
            outputSchema: input.input.outputSchema,
          },
        ],
      },
      mode,
      serializedContext: input.serializedContext,
      sessionState,
    });
  } catch (error) {
    // Safety net for failures the tool-loop harness does not already
    // surface as `session.failed` (deserialization, runtime-action
    // throws, adapter `deliver` throws, staging errors, etc.) so the
    // channel still sees a terminal event.
    await emitTerminalSessionFailureStep({
      error: normalizeSerializableError(error),
      parentWritable: driverWritable,
      serializedContext: input.serializedContext,
    });
    await fireSessionCallbackStep({
      error: normalizeSerializableError(error),
      serializedContext: input.serializedContext,
      status: "failed",
    });
    await notifyDelegatedParentStep({
      result: createDelegatedSubagentErrorResult(input.serializedContext, error),
      serializedContext: input.serializedContext,
    });
    throw error;
  }
}

async function runDriverLoop(input: {
  readonly capabilities?: SessionCapabilities;
  readonly driverWritable: WritableStream<Uint8Array>;
  readonly initialInput: DeliverHookPayload;
  readonly mode: RunMode;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<WorkflowEntryResult> {
  // Per-session auth hook. Created before any turns so it exists
  // when authorization.required events trigger OAuth callbacks.
  // getHookUrl() builds callback URLs with this token.
  const authHook = createHook<HookPayload>({
    token: `${input.sessionState.sessionId}:auth`,
  });
  const authIterator: AsyncIterator<HookPayload> = authHook[Symbol.asyncIterator]();
  let pendingAuthNext: Promise<IteratorResult<HookPayload>> | null = null;
  const sessionCancellationHook = createHook<void>({
    token: createSessionCancellationHookId(input.sessionState.sessionId),
  });
  const sessionCancellationIterator = sessionCancellationHook[Symbol.asyncIterator]();
  const sessionCancellation = awaitCancellationSignal(sessionCancellationIterator);
  let activeTurnCancellation: ActiveTurnCancellation | undefined = createActiveTurnCancellation({
    sessionId: input.sessionState.sessionId,
  });
  // Fast descendant resumes can start the next turn before the prior
  // completion hook disposal is persisted by the Workflow SDK, so each
  // turn needs its own session-scoped token.
  let turnDispatchIndex = 0;
  const nextTurnCompletionToken = (): string =>
    `${input.sessionState.sessionId}:turn-completion:${String(turnDispatchIndex++)}`;

  // Register before the first turn when a placeholder token exists.
  // Tokenless channels must anchor during that turn before hook registration.
  let parkToken = "";
  let hook: Hook<HookPayload> | undefined;
  let iterator: AsyncIterator<HookPayload> | undefined;
  let pendingNext: Promise<IteratorResult<HookPayload>> | null = null;
  const bufferedDeliveries: DeliverHookPayload[] = [];

  const createParkHook = (nextToken: string): Hook<HookPayload> => {
    parkToken = nextToken;
    hook = createHook<HookPayload>({ token: parkToken });
    iterator = hook[Symbol.asyncIterator]();
    pendingNext = null;
    return hook;
  };

  if (input.sessionState.continuationToken) {
    createParkHook(input.sessionState.continuationToken);
  }

  const getNextPromise = (): Promise<IteratorResult<HookPayload>> => {
    if (iterator === undefined) {
      throw new Error("Cannot wait for deliveries before a continuation token is available.");
    }

    pendingNext ??= iterator.next();
    return pendingNext;
  };

  const consumeNext = (): void => {
    pendingNext = null;
  };

  const getAuthNextPromise = (): Promise<IteratorResult<HookPayload>> => {
    pendingAuthNext ??= authIterator.next();
    return pendingAuthNext;
  };

  const consumeAuthNext = (): void => {
    pendingAuthNext = null;
  };

  /**
   * Disposes the current park hook and creates a fresh one at
   * `nextToken`. Channels that re-key mid-session must coordinate
   * with their senders — in-flight deliveries to the old token after
   * this returns are silently dropped.
   */
  const closeParkHook = (): void => {
    if (hook !== undefined) {
      hook.dispose();
    }
    hook = undefined;
    iterator = undefined;
    pendingNext = null;
  };

  const rekeyHook = async (nextToken: string): Promise<void> => {
    if (!nextToken || (hook !== undefined && nextToken === parkToken)) return;
    closeParkHook();
    await claimHook(createParkHook(nextToken));
  };

  const hooksToClaim: Hook<unknown>[] = [
    authHook,
    sessionCancellationHook,
    activeTurnCancellation.hook,
  ];
  if (hook !== undefined) hooksToClaim.push(hook);
  await Promise.all(hooksToClaim.map((candidate) => claimHook(candidate)));

  try {
    const initialTransition = await applyTurnOutcome(
      await dispatchAndAwaitTurn({
        cancellation: raceTurnCancellation(activeTurnCancellation, sessionCancellation),
        capabilities: input.capabilities,
        completionToken: nextTurnCompletionToken(),
        delivery: input.initialInput,
        mode: input.mode,
        parentWritable: input.driverWritable,
        serializedContext: input.serializedContext,
        sessionState: input.sessionState,
      }),
    );
    if (initialTransition.kind === "done") return initialTransition.result;
    let action = initialTransition.action;

    while (true) {
      switch (action.kind) {
        case "done": {
          disposeActiveTurnCancellation();
          return await finalizeDone({
            action,
            driverWritable: input.driverWritable,
          });
        }

        case "dispatch-code-mode-runtime-actions":
        case "dispatch-runtime-actions": {
          const dispatchStep =
            action.kind === "dispatch-code-mode-runtime-actions"
              ? dispatchCodeModeRuntimeActionsStep
              : dispatchRuntimeActionsStep;

          const dispatchResult = await dispatchStep({
            callbackBaseUrl: resolveVercelProductionCallbackBaseUrl() ?? getWorkflowMetadata().url,
            parentWritable: input.driverWritable,
            serializedContext: action.serializedContext,
            sessionState: action.sessionState,
          });

          const runtimeResults = await waitForPendingRuntimeActionResults({
            bufferedDeliveries,
            cancellation: () => raceTurnCancellation(activeTurnCancellation, sessionCancellation),
            consumeNext,
            getNextPromise,
            initialResults: dispatchResult.results,
            parentWritable: input.driverWritable,
            pendingActionKeys: action.pendingActionKeys,
            rekeyHook,
            serializedContext: action.serializedContext,
            sessionState: dispatchResult.sessionState,
          });

          if (runtimeResults === null) {
            return { output: "" };
          }

          if (runtimeResults.kind === "cancelled") {
            const transition = await applyTurnOutcome(runtimeResults);
            if (transition.kind === "done") return transition.result;
            action = transition.action;
            break;
          }

          const transition = await applyTurnOutcome(
            await dispatchAndAwaitTurn({
              cancellation: raceTurnCancellation(activeTurnCancellation, sessionCancellation),
              capabilities: input.capabilities,
              completionToken: nextTurnCompletionToken(),
              delivery: {
                kind: "runtime-action-result",
                results: runtimeResults.results,
              },
              mode: input.mode,
              parentWritable: input.driverWritable,
              serializedContext: runtimeResults.serializedContext,
              sessionState: runtimeResults.sessionState,
            }),
          );
          if (transition.kind === "done") return transition.result;
          action = transition.action;
          break;
        }

        case "park": {
          if (action.authorizationNames && action.authorizationNames.length > 0) {
            const expected = action.authorizationNames.length;
            const allPayloads: DeliverPayload[] = [];

            while (allPayloads.length < expected) {
              const nextOrCancellation = await Promise.race([
                raceTurnCancellation(activeTurnCancellation, sessionCancellation),
                getAuthNextPromise().then((next) => ({ kind: "next" as const, next })),
              ]);
              if (nextOrCancellation.kind === "cancelled") {
                const transition = await applyTurnOutcome({
                  ...nextOrCancellation,
                  serializedContext: action.serializedContext,
                  sessionState: action.sessionState,
                });
                if (transition.kind === "done") return transition.result;
                action = transition.action;
                break;
              }
              const { next } = nextOrCancellation;
              consumeAuthNext();
              if (next.done) break;
              if (next.value.kind === "deliver") {
                allPayloads.push(...next.value.payloads);
              }
            }

            if (action.kind !== "park" || !action.authorizationNames) {
              break;
            }

            const transition = await applyTurnOutcome(
              await dispatchAndAwaitTurn({
                cancellation: raceTurnCancellation(activeTurnCancellation, sessionCancellation),
                capabilities: input.capabilities,
                completionToken: nextTurnCompletionToken(),
                delivery: {
                  kind: "deliver",
                  payloads: allPayloads,
                },
                mode: input.mode,
                parentWritable: input.driverWritable,
                serializedContext: action.serializedContext,
                sessionState: action.sessionState,
              }),
            );
            if (transition.kind === "done") return transition.result;
            action = transition.action;
            break;
          }

          let nextDeliver;
          while (true) {
            nextDeliver = await waitForNextDeliver({
              bufferedDeliveries,
              cancellation: raceTurnCancellation(activeTurnCancellation, sessionCancellation),
              consumeNext,
              getNextPromise,
            });
            if (nextDeliver?.kind !== "cancelled" || nextDeliver.scope !== "turn") break;
            rearmTurnCancellation();
          }

          if (nextDeliver === null) {
            return { output: "" };
          }

          if (nextDeliver.kind === "cancelled") {
            const transition = await applyTurnOutcome({
              ...nextDeliver,
              serializedContext: action.serializedContext,
              sessionState: action.sessionState,
            });
            if (transition.kind === "done") return transition.result;
            action = transition.action;
            break;
          }

          const remainder = await routeDeliverForChildren({
            auth: nextDeliver.auth,
            parentWritable: input.driverWritable,
            payloads: nextDeliver.payloads,
            sessionState: action.sessionState,
          });

          if (remainder === undefined) {
            // Fully routed to a descendant; parent has no turn to run.
            continue;
          }

          const transition = await applyTurnOutcome(
            await dispatchAndAwaitTurn({
              cancellation: raceTurnCancellation(activeTurnCancellation, sessionCancellation),
              capabilities: input.capabilities,
              completionToken: nextTurnCompletionToken(),
              delivery: {
                auth: nextDeliver.auth,
                kind: "deliver",
                payloads: [remainder],
              },
              mode: input.mode,
              parentWritable: input.driverWritable,
              serializedContext: action.serializedContext,
              sessionState: action.sessionState,
            }),
          );
          if (transition.kind === "done") return transition.result;
          action = transition.action;
          break;
        }
      }
    }
  } finally {
    disposeActiveTurnCancellation();
    closeParkHook();
    authHook.dispose();
    sessionCancellationHook.dispose();
  }

  function disposeActiveTurnCancellation(): void {
    if (activeTurnCancellation === undefined) return;
    activeTurnCancellation.hook.dispose();
    activeTurnCancellation = undefined;
  }

  function rearmTurnCancellation(): void {
    if (activeTurnCancellation === undefined) return;
    activeTurnCancellation = rearmActiveTurnCancellation(activeTurnCancellation);
  }

  async function applyTurnOutcome(outcome: DriverDispatchOutcome): Promise<DriverTransition> {
    const transition: DriverTransition =
      outcome.kind === "cancelled"
        ? await finalizeDriverCancellation(outcome)
        : { action: outcome.action, kind: "action" };

    if (transition.kind === "action" && transition.action.kind !== "done") {
      assertCanPark(transition.action.sessionState);
      await rekeyHook(transition.action.sessionState.continuationToken);
    }
    return transition;
  }

  async function finalizeDriverCancellation(
    cancellation: DriverCancellation,
  ): Promise<DriverTransition> {
    if (cancellation.scope === "turn") {
      rearmTurnCancellation();
    }

    if (cancellation.scope === "session") {
      // Releasing the continuation is the reset linearization point. New work
      // may claim the same identity while teardown remains bound to this run.
      closeParkHook();
    }

    await cancelDescendantsStep({
      serializedContext: cancellation.serializedContext,
      sessionState: cancellation.sessionState,
    });

    const finalized = await finalizeCancellationStep({
      parentWritable: input.driverWritable,
      scope: cancellation.scope,
      serializedContext: cancellation.serializedContext,
      sessionState: cancellation.sessionState,
    });

    if (cancellation.scope === "session") {
      await fireSessionCallbackStep({
        serializedContext: finalized.serializedContext,
        status: "cancelled",
      });
      await notifyDelegatedParentStep({
        ignoreMissing: true,
        result: createDelegatedSubagentCancellationResult(finalized.serializedContext),
        serializedContext: finalized.serializedContext,
      });
      return { kind: "done", result: { output: "" } };
    }

    return {
      action: {
        kind: "park",
        serializedContext: finalized.serializedContext,
        sessionState: finalized.sessionState,
      },
      kind: "action",
    };
  }
}

async function finalizeDone(input: {
  readonly action: NextDriverAction & { readonly kind: "done" };
  readonly driverWritable: WritableStream<Uint8Array>;
}): Promise<WorkflowEntryResult> {
  const { output, serializedContext } = input.action;
  const failed = input.action.isError === true;

  await fireSessionCallbackStep({
    error: failed ? output : undefined,
    output: failed ? undefined : output,
    serializedContext,
    status: failed ? "failed" : "completed",
  });
  await notifyDelegatedParentStep({
    result: failed
      ? createDelegatedSubagentErrorResult(serializedContext, output)
      : createDelegatedSubagentSuccessResult(serializedContext, output),
    serializedContext,
  });
  return { output };
}

async function claimHook(hook: Hook<unknown>): Promise<void> {
  const conflict = await hook.getConflict();
  if (conflict !== null) {
    throw new Error(`Workflow hook token is owned by run "${conflict.runId}".`);
  }
}
