import type { NextDriverAction } from "#execution/next-driver-action.js";
import { normalizeSerializableError } from "#execution/workflow-errors.js";
import {
  migrateTurnWorkflowInput,
  type TurnStepInput,
  type TurnWorkflowInput,
} from "#execution/durable-session-migrations/turn-workflow.js";
import { turnStep } from "#execution/workflow-steps.js";
import { createHook, type Hook } from "#compiled/@workflow/core/index.js";
import {
  createCancellationReason,
  createTurnWorkflowCancellationHookId,
  readCancellationScope,
} from "#execution/cancellation.js";
import type { CancellationScope } from "#channel/types.js";
import { applyEveWorkflowQueueNamespace } from "#internal/workflow/queue-namespace.js";
import { disposeHook } from "#execution/hook-ownership.js";

const TASK_MODE_WAIT_ERROR_MESSAGE = "Task mode cannot wait for follow-up input (`next: null`).";

/**
 * Hook payload the turn child workflow delivers to the parent driver
 * on completion. `turn-result` wraps a {@link NextDriverAction} the
 * driver dispatches on; `turn-error` carries a normalized error the
 * driver rethrows.
 */
export type TurnCompletionPayload =
  | { readonly kind: "turn-result"; readonly action: NextDriverAction }
  | { readonly kind: "turn-cancelled"; readonly scope: CancellationScope }
  | { readonly kind: "turn-error"; readonly error: unknown };

export type { TurnWorkflowInput };

/**
 * Short-lived workflow that owns one runtime turn for the driver.
 *
 * `parentWritable` is threaded in from the driver run so event writes
 * land on the driver's stream. Resolves the turn into a
 * {@link NextDriverAction} and reports it back through
 * {@link notifyDriverStep}.
 */
export async function turnWorkflow(rawInput: unknown): Promise<void> {
  "use workflow";

  const input = migrateTurnWorkflowInput(rawInput);
  let currentStepInput: TurnStepInput = input.stepInput;
  const controller = new AbortController();
  const cancellationHookId = createTurnWorkflowCancellationHookId(input.completionToken);
  const cancelHook = createHook<void>({
    token: cancellationHookId,
  });

  try {
    const cancellation = awaitHookPayload(cancelHook).then(() => ({ kind: "cancel" as const }));

    while (true) {
      const outcome = await Promise.race([
        turnStep({
          ...currentStepInput,
          abortController: controller,
        }).then((result) => ({
          kind: "result" as const,
          result,
        })),
        cancellation,
      ]);

      if (outcome.kind === "cancel") {
        controller.abort(createCancellationReason("turn"));
        await notifyDriverStep({
          completionToken: input.completionToken,
          payload: { kind: "turn-cancelled", scope: "turn" },
        });
        return;
      }

      const { result } = outcome;

      if (result.action === "done") {
        await notifyDriverStep({
          completionToken: input.completionToken,
          payload: {
            action: {
              kind: "done",
              output: result.output ?? "",
              isError: result.isError,
              serializedContext: result.serializedContext,
              sessionState: result.sessionState,
            },
            kind: "turn-result",
          },
        });
        return;
      }

      if (result.action === "dispatch-code-mode-runtime-actions") {
        await notifyDriverStep({
          completionToken: input.completionToken,
          payload: {
            action: {
              kind: "dispatch-code-mode-runtime-actions",
              pendingActionKeys: result.pendingRuntimeActionKeys,
              serializedContext: result.serializedContext,
              sessionState: result.sessionState,
            },
            kind: "turn-result",
          },
        });
        return;
      }

      if (result.action === "park") {
        const pendingActionKeys = result.pendingRuntimeActionKeys;
        const canPark =
          pendingActionKeys !== undefined ||
          result.hasPendingAuthorization ||
          (result.hasPendingInputBatch && input.capabilities?.requestInput === true) ||
          input.mode === "conversation";

        if (!canPark) {
          throw new Error(TASK_MODE_WAIT_ERROR_MESSAGE);
        }

        const action: NextDriverAction =
          pendingActionKeys !== undefined
            ? {
                kind: "dispatch-runtime-actions",
                pendingActionKeys,
                serializedContext: result.serializedContext,
                sessionState: result.sessionState,
              }
            : {
                kind: "park",
                serializedContext: result.serializedContext,
                sessionState: result.sessionState,
                authorizationNames: result.authorizationNames,
              };

        await notifyDriverStep({
          completionToken: input.completionToken,
          payload: { action, kind: "turn-result" },
        });
        return;
      }

      currentStepInput = {
        abortController: controller,
        input: undefined,
        parentWritable: currentStepInput.parentWritable,
        serializedContext: result.serializedContext,
        sessionState: result.sessionState,
      };
    }
  } catch (error) {
    const cancellationScope = readCancellationScope(controller.signal.reason);
    if (controller.signal.aborted && cancellationScope !== undefined) {
      await notifyDriverStep({
        completionToken: input.completionToken,
        payload: { kind: "turn-cancelled", scope: cancellationScope },
      });
      return;
    }
    await notifyDriverStep({
      completionToken: input.completionToken,
      payload: {
        error: normalizeSerializableError(error),
        kind: "turn-error",
      },
    });
    throw error;
  } finally {
    await disposeHook(cancelHook);
  }
}

async function awaitHookPayload<T>(hook: Hook<T>): Promise<T> {
  for await (const value of hook) return value;
  throw new Error("Turn cancellation hook closed before receiving a signal.");
}

/** Resumes the driver's one-shot completion hook with the turn result. */
export async function notifyDriverStep(input: {
  readonly completionToken: string;
  readonly payload: TurnCompletionPayload;
}): Promise<void> {
  "use step";

  applyEveWorkflowQueueNamespace();
  const [{ resumeHook }, { HookNotFoundError }] = await Promise.all([
    import("#compiled/@workflow/core/runtime.js"),
    import("#compiled/@workflow/errors/index.js"),
  ]);
  try {
    await resumeHook(input.completionToken, input.payload);
  } catch (error) {
    if (HookNotFoundError.is(error)) return;
    throw error;
  }
}
