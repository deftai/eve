import { buildAdapterContext } from "#channel/adapter-context.js";
import { callAdapterEventHandler } from "#channel/adapter.js";
import type {
  SubagentAuthorizationCompletedHookPayload,
  SubagentAuthorizationRequestHookPayload,
} from "#channel/types.js";
import { withContextScope } from "#context/run-step.js";
import { deserializeContext, serializeContext } from "#context/serialize.js";
import { setChannelContext } from "#execution/channel-context.js";
import {
  createDurableSessionState,
  type DurableSessionState,
  readDurableSession,
} from "#execution/durable-session-store.js";
import { hydrateDurableSession } from "#execution/session.js";
import {
  type ProxyInputRequestResult,
  reconcileSessionContinuationToken,
} from "#execution/workflow-steps.js";
import type { HarnessEmitFn } from "#harness/types.js";
import {
  createAuthorizationCompletedEvent,
  createAuthorizationRequiredEvent,
  encodeMessageStreamEvent,
  type HandleMessageStreamEvent,
  timestampHandleMessageStreamEvent,
} from "#protocol/message.js";
import { BundleKey, ChannelKey } from "#runtime/sessions/runtime-context-keys.js";

/**
 * Union of the authorization lifecycle payloads a child subagent forwards
 * to its parent.
 */
export type SubagentAuthorizationHookPayload =
  | SubagentAuthorizationCompletedHookPayload
  | SubagentAuthorizationRequestHookPayload;

/**
 * Runs the parent-side work for a proxied child authorization event:
 * re-emits it on the parent stream so the parent channel renders the
 * sign-in affordance (or resolves it). Emit-only — the challenge's OAuth
 * callback resumes the child session's own hook, so unlike HITL there is
 * no response to route back down.
 */
export async function emitProxiedAuthorizationEvent(input: {
  readonly emit: HarnessEmitFn;
  readonly hookPayload: SubagentAuthorizationHookPayload;
}): Promise<void> {
  const { hookPayload } = input;

  if (hookPayload.kind === "subagent-authorization-request") {
    await input.emit(
      createAuthorizationRequiredEvent({
        authorization: hookPayload.event.authorization,
        description: hookPayload.event.description,
        name: hookPayload.event.name,
        sequence: hookPayload.event.sequence,
        stepIndex: hookPayload.event.stepIndex,
        turnId: hookPayload.event.turnId,
        webhookUrl: hookPayload.event.webhookUrl,
      }),
    );
    return;
  }

  await input.emit(
    createAuthorizationCompletedEvent({
      authorization: hookPayload.event.authorization,
      name: hookPayload.event.name,
      outcome: hookPayload.event.outcome,
      reason: hookPayload.event.reason,
      sequence: hookPayload.event.sequence,
      stepIndex: hookPayload.event.stepIndex,
      turnId: hookPayload.event.turnId,
    }),
  );
}

/**
 * Emits a proxied child authorization lifecycle event through the parent's
 * adapter so the parent channel renders (or resolves) the sign-in
 * affordance. Emit-only — authorization callbacks resume the child's own
 * hook, so no routing entries are recorded on the parent session.
 */
export async function runProxyAuthorizationEventStep(input: {
  readonly hookPayload: SubagentAuthorizationHookPayload;
  readonly parentWritable: WritableStream<Uint8Array>;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<ProxyInputRequestResult> {
  "use step";

  const durableSession = await readDurableSession(input.sessionState);
  const ctx = await deserializeContext(input.serializedContext);
  const adapter = ctx.require(ChannelKey);
  const adapterCtx = buildAdapterContext(adapter, ctx);
  const bundle = ctx.require(BundleKey);
  const session = hydrateDurableSession({
    compactionOverrides: {
      thresholdPercent: bundle.resolvedAgent.config.compaction?.thresholdPercent,
    },
    durable: durableSession,
    turnAgent: bundle.turnAgent,
  });
  const writer = input.parentWritable.getWriter();

  try {
    const emit = async (event: HandleMessageStreamEvent): Promise<void> => {
      const transformed = await callAdapterEventHandler(adapter, event, adapterCtx);
      await writer.write(encodeMessageStreamEvent(timestampHandleMessageStreamEvent(transformed)));
    };

    await withContextScope(ctx, session, async (enrichedSession) => {
      await emitProxiedAuthorizationEvent({
        emit,
        hookPayload: input.hookPayload,
      });
      return { result: undefined, session: enrichedSession };
    });
  } finally {
    writer.releaseLock();
  }

  // Persist adapter-state mutations (e.g. Slack's pending-authorization
  // status message cache) so the matching `authorization.completed`
  // handler can resolve the affordance it rendered.
  setChannelContext(ctx, { ...adapter, state: { ...adapterCtx.state } });

  const nextSerializedContext = serializeContext(ctx);
  const nextSession = reconcileSessionContinuationToken(ctx, session);
  const nextState = createDurableSessionState({ session: nextSession });

  return {
    serializedContext: nextSerializedContext,
    sessionState: nextState,
  };
}
