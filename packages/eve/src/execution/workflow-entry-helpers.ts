import { createHook, type Hook } from "#compiled/@workflow/core/index.js";

import type {
  CancellationScope,
  DeliverHookPayload,
  DeliverPayload,
  HookPayload,
  SessionCapabilities,
} from "#channel/types.js";
import {
  createActiveTurnCancellationHookId,
  createTurnWorkflowCancellationHookId,
} from "#execution/cancellation.js";
import type { DurableSessionState } from "#execution/durable-session-store.js";
import type { NextDriverAction } from "#execution/next-driver-action.js";
import type { TurnCompletionPayload } from "#execution/turn-workflow.js";
import { cancelTurnSegmentStep } from "#execution/turn-cancellation-step.js";
import { disposeHook } from "#execution/hook-ownership.js";
import { rebuildSerializableError } from "#execution/workflow-errors.js";
import {
  dispatchTurnStep,
  routeProxiedDeliverStep,
  runProxyInputRequestStep,
} from "#execution/workflow-steps.js";
import { accumulateRuntimeActionResults } from "#harness/runtime-actions.js";
import type { RuntimeSubagentResultActionResult } from "#runtime/actions/types.js";
import type { InputResponse } from "#runtime/input/types.js";
import type { RunMode } from "#shared/run-mode.js";

export interface DriverCancellation {
  readonly kind: "cancelled";
  readonly scope: CancellationScope;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}

export type CancellationSignal = Pick<DriverCancellation, "kind" | "scope">;

export type DriverDispatchOutcome =
  | { readonly kind: "action"; readonly action: NextDriverAction }
  | DriverCancellation;

export interface ActiveTurnCancellation {
  readonly hook: Hook<void>;
  readonly iterator: AsyncIterator<void>;
  readonly promise: Promise<void>;
}

export async function dispatchAndAwaitTurn(input: {
  readonly cancellation: Promise<CancellationSignal>;
  readonly capabilities?: SessionCapabilities;
  readonly completionToken: string;
  readonly delivery: HookPayload;
  readonly mode: RunMode;
  readonly parentWritable: WritableStream<Uint8Array>;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<DriverDispatchOutcome> {
  const completion = createHook<TurnCompletionPayload>({ token: input.completionToken });
  const completionToken = completion.token;

  try {
    await dispatchTurnStep({
      capabilities: input.capabilities,
      completionToken,
      delivery: input.delivery,
      mode: input.mode,
      parentWritable: input.parentWritable,
      serializedContext: input.serializedContext,
      sessionState: input.sessionState,
    });

    const completionPayload = awaitHookPayload(completion);
    const outcome = await Promise.race([
      input.cancellation,
      completionPayload.then((payload) => ({ kind: "completion" as const, payload })),
    ]);

    let payload: TurnCompletionPayload;
    if (outcome.kind === "cancelled") {
      await cancelTurnSegmentStep({
        hookId: createTurnWorkflowCancellationHookId(completionToken),
      });
      return {
        ...outcome,
        serializedContext: input.serializedContext,
        sessionState: input.sessionState,
      };
    }
    payload = outcome.payload;

    if (payload.kind === "turn-error") throw rebuildSerializableError(payload.error);
    if (payload.kind === "turn-cancelled") {
      return {
        kind: "cancelled",
        scope: payload.scope,
        serializedContext: input.serializedContext,
        sessionState: input.sessionState,
      };
    }

    return { action: payload.action, kind: "action" };
  } finally {
    await disposeHook(completion);
  }
}

async function awaitHookPayload<T>(hook: Hook<T>): Promise<T> {
  for await (const value of hook) return value;
  throw new Error("Turn completion hook closed before delivering a result.");
}

interface PendingRuntimeActionResultsOutcome {
  readonly kind: "results";
  readonly results: readonly RuntimeSubagentResultActionResult[];
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}

export async function waitForPendingRuntimeActionResults(input: {
  readonly bufferedDeliveries: DeliverHookPayload[];
  readonly cancellation: () => Promise<CancellationSignal>;
  readonly consumeNext: () => void;
  readonly getNextPromise: () => Promise<IteratorResult<HookPayload>>;
  readonly initialResults?: readonly RuntimeSubagentResultActionResult[];
  readonly parentWritable: WritableStream<Uint8Array>;
  readonly pendingActionKeys: readonly string[];
  readonly rekeyHook: (nextToken: string) => Promise<void>;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<PendingRuntimeActionResultsOutcome | DriverCancellation | null> {
  let currentSessionState = input.sessionState;
  let currentSerializedContext = input.serializedContext;

  let results: readonly RuntimeSubagentResultActionResult[] | null;
  try {
    results = (await accumulateRuntimeActionResults({
      bufferedDeliveries: input.bufferedDeliveries,
      async getNext() {
        while (true) {
          const nextOrCancellation = await Promise.race([
            input.cancellation(),
            input.getNextPromise().then((next) => ({ kind: "next" as const, next })),
          ]);
          if (nextOrCancellation.kind === "cancelled") throw nextOrCancellation;
          const { next } = nextOrCancellation;
          input.consumeNext();
          if (next.done) return null;

          const value = next.value;
          if (value.kind === "deliver") {
            const remainder = await routeDeliverForChildren({
              auth: value.auth,
              parentWritable: input.parentWritable,
              payloads: value.payloads,
              sessionState: currentSessionState,
            });
            if (remainder === undefined) continue;
            return { kind: "deliver", value: { ...value, payloads: [remainder] } };
          }
          if (value.kind === "runtime-action-result") {
            return { kind: "runtime-action-result", results: value.results };
          }

          const proxyResult = await runProxyInputRequestStep({
            hookPayload: value,
            parentWritable: input.parentWritable,
            serializedContext: currentSerializedContext,
            sessionState: currentSessionState,
          });
          currentSessionState = proxyResult.sessionState;
          currentSerializedContext = proxyResult.serializedContext;
          await input.rekeyHook(currentSessionState.continuationToken);
        }
      },
      initialResults: input.initialResults,
      pendingActionKeys: input.pendingActionKeys,
    })) as readonly RuntimeSubagentResultActionResult[] | null;
  } catch (error) {
    if (isCancellationSignal(error)) {
      return {
        ...error,
        serializedContext: currentSerializedContext,
        sessionState: currentSessionState,
      };
    }
    throw error;
  }

  if (results === null) return null;
  return {
    kind: "results",
    results,
    serializedContext: currentSerializedContext,
    sessionState: currentSessionState,
  };
}

export async function routeDeliverForChildren(input: {
  readonly auth: DeliverHookPayload["auth"];
  readonly parentWritable: WritableStream<Uint8Array>;
  readonly payloads: readonly DeliverPayload[];
  readonly sessionState: DurableSessionState;
}): Promise<DeliverPayload | undefined> {
  const coalesced = coalescePayloads(input.payloads);
  if (!input.sessionState.hasProxyInputRequests) return coalesced;

  const routed = await routeProxiedDeliverStep({
    auth: input.auth,
    parentWritable: input.parentWritable,
    payload: coalesced,
    sessionState: input.sessionState,
  });
  return routed.remainder;
}

export async function waitForNextDeliver(input: {
  readonly bufferedDeliveries: DeliverHookPayload[];
  readonly cancellation: Promise<CancellationSignal>;
  readonly consumeNext: () => void;
  readonly getNextPromise: () => Promise<IteratorResult<HookPayload>>;
}): Promise<DeliverHookPayload | CancellationSignal | null> {
  if (input.bufferedDeliveries.length > 0) {
    return input.bufferedDeliveries.shift() ?? null;
  }

  while (true) {
    const nextOrCancellation = await Promise.race([
      input.cancellation,
      input.getNextPromise().then((next) => ({ kind: "next" as const, next })),
    ]);
    if (nextOrCancellation.kind === "cancelled") return nextOrCancellation;
    const first = nextOrCancellation.next;
    input.consumeNext();
    if (first.done) return null;
    if (first.value.kind === "deliver") return first.value;
  }
}

function coalescePayloads(payloads: readonly DeliverPayload[]): DeliverPayload {
  if (payloads.length === 0) return {};
  if (payloads.length === 1) return payloads[0] ?? {};

  const merged: Record<string, unknown> = {};
  const inputResponses: InputResponse[] = [];
  for (const payload of payloads) {
    for (const [key, value] of Object.entries(payload)) {
      if (key !== "inputResponses" && value !== undefined) merged[key] = value;
    }
    if (payload.inputResponses !== undefined) inputResponses.push(...payload.inputResponses);
  }
  if (inputResponses.length > 0) merged.inputResponses = inputResponses;
  return merged as DeliverPayload;
}

export function createActiveTurnCancellation(input: {
  readonly sessionId: string;
}): ActiveTurnCancellation {
  const hook = createHook<void>({ token: createActiveTurnCancellationHookId(input.sessionId) });
  const iterator = hook[Symbol.asyncIterator]();
  return { hook, iterator, promise: awaitCancellationSignal(iterator) };
}

export function rearmActiveTurnCancellation(
  active: ActiveTurnCancellation,
): ActiveTurnCancellation {
  return {
    ...active,
    promise: awaitCancellationSignal(active.iterator),
  };
}

export async function awaitCancellationSignal(iterator: AsyncIterator<void>): Promise<void> {
  const result = await iterator.next();
  if (!result.done) return;
  throw new Error("Cancellation hook closed before receiving a signal.");
}

export function raceTurnCancellation(
  active: ActiveTurnCancellation | undefined,
  sessionCancellation: Promise<void>,
): Promise<CancellationSignal> {
  if (active === undefined) {
    return sessionCancellation.then(() => ({ kind: "cancelled", scope: "session" }));
  }
  return Promise.race([
    active.promise.then(() => ({ kind: "cancelled" as const, scope: "turn" as const })),
    sessionCancellation.then(() => ({ kind: "cancelled" as const, scope: "session" as const })),
  ]);
}

function isCancellationSignal(value: unknown): value is CancellationSignal {
  if (value === null || typeof value !== "object") return false;
  const signal = value as Partial<CancellationSignal>;
  return signal.kind === "cancelled" && (signal.scope === "turn" || signal.scope === "session");
}

export function assertCanPark(sessionState: DurableSessionState): void {
  if (sessionState.continuationToken) return;
  throw new Error(
    "Cannot park: no continuation token available. The channel must " +
      "post the first message during the initial turn (anchoring the " +
      "session) or `send()` must be called with an explicit " +
      "continuationToken.",
  );
}
