import type { CancellationScope } from "#channel/types.js";
import { buildAdapterContext } from "#channel/adapter-context.js";
import { callAdapterEventHandler } from "#channel/adapter.js";
import { deserializeContext, serializeContext } from "#context/serialize.js";
import { dispatchStreamEventHooks } from "#context/hook-lifecycle.js";
import { withContextScope } from "#context/run-step.js";
import { ChannelKey, BundleKey } from "#runtime/sessions/runtime-context-keys.js";
import { createCancellationReason } from "#execution/cancellation.js";
import {
  createDurableSessionState,
  type DurableSessionState,
  readDurableSession,
} from "#execution/durable-session-store.js";
import { hydrateDurableSession } from "#execution/session.js";
import { clearPendingAuthorization } from "#harness/authorization.js";
import { clearPendingCodeModeInterrupt } from "#harness/code-mode-interrupt-state.js";
import { clearPendingInputBatch } from "#harness/input-requests.js";
import { clearProxyInputRequests } from "#harness/proxy-input-requests.js";
import { clearPendingRuntimeActionBatch } from "#harness/runtime-actions.js";
import { isHarnessBetweenTurns, setHarnessEmissionState } from "#harness/emission.js";
import {
  createSessionCancelledEvent,
  createSessionWaitingEvent,
  createTurnCancelledEvent,
  encodeMessageStreamEvent,
  type HandleMessageStreamEvent,
  timestampHandleMessageStreamEvent,
} from "#protocol/message.js";

export interface FinalizedCancellation {
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}

/** Emits canonical cancellation boundaries and clears state owned by the cancelled turn. */
export async function finalizeCancellationStep(input: {
  readonly parentWritable: WritableStream<Uint8Array>;
  readonly scope: CancellationScope;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<FinalizedCancellation> {
  "use step";

  const durable = await readDurableSession(input.sessionState);
  const ctx = await deserializeContext(input.serializedContext);
  const bundle = ctx.require(BundleKey);
  const adapter = ctx.require(ChannelKey);
  let session = hydrateDurableSession({
    compactionOverrides: {
      thresholdPercent: bundle.resolvedAgent.config.compaction?.thresholdPercent,
    },
    durable,
    turnAgent: bundle.turnAgent,
  });

  session = clearPendingRuntimeActionBatch(session);
  session = clearPendingCodeModeInterrupt(session);
  session = clearPendingInputBatch(session);
  session = {
    ...session,
    state: clearPendingAuthorization(session.state),
  };
  session = clearProxyInputRequests(session);

  const prior = input.sessionState.emissionState;
  const events: HandleMessageStreamEvent[] = [];
  if (!isHarnessBetweenTurns(session)) {
    events.push(createTurnCancelledEvent({ sequence: prior.sequence, turnId: prior.turnId }));
  }
  events.push(
    input.scope === "turn"
      ? createSessionWaitingEvent()
      : createSessionCancelledEvent(input.sessionState.sessionId),
  );

  const reason = createCancellationReason(input.scope);
  const scopeResult = await withContextScope(
    ctx,
    session,
    async (enrichedSession) => {
      const adapterCtx = buildAdapterContext(adapter, ctx);
      const writer = input.parentWritable.getWriter();
      try {
        for (const event of events) {
          const transformed = await callAdapterEventHandler(adapter, event, adapterCtx);
          await writer.write(
            encodeMessageStreamEvent(timestampHandleMessageStreamEvent(transformed)),
          );
          await dispatchStreamEventHooks({
            ctx,
            event: transformed,
            registry: bundle.hookRegistry,
          });
        }
        if (input.scope === "session") {
          await writer.close();
        }
      } finally {
        writer.releaseLock();
      }
      return { result: undefined, session: enrichedSession };
    },
    {
      abortSignal: AbortSignal.abort(reason),
      cancel(): never {
        throw reason;
      },
    },
  );
  session = scopeResult.session;

  session = setHarnessEmissionState(session, {
    sequence: prior.sequence + 1,
    sessionStarted: true,
    stepIndex: 0,
    turnId: "",
  });

  return {
    serializedContext: serializeContext(ctx),
    sessionState: createDurableSessionState({ session }),
  };
}
