import { buildAdapterContext } from "#channel/adapter-context.js";
import { callAdapterEventHandler } from "#channel/adapter.js";
import type { SubagentAuthorizationEventHookPayload } from "#channel/types.js";
import { withContextScope } from "#context/run-step.js";
import { deserializeContext, serializeContext } from "#context/serialize.js";
import type { HarnessSession } from "#harness/types.js";
import { BundleKey, ChannelKey } from "#runtime/sessions/runtime-context-keys.js";
import { encodeMessageStreamEvent, timestampHandleMessageStreamEvent } from "#protocol/message.js";
import {
  createDurableSessionState,
  type DurableSessionState,
  readDurableSession,
} from "#execution/durable-session-store.js";
import { setChannelContext } from "#execution/channel-context.js";
import { hydrateDurableSession } from "#execution/session.js";
import { reconcileSessionContinuationToken } from "#execution/workflow-steps.js";

export interface ProxyAuthorizationEventResult {
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}

/**
 * Re-emits a child subagent's `authorization.required` /
 * `authorization.completed` event through the parent's adapter so the
 * parent channel renders the sign-in challenge (and later resolves it).
 *
 * Emits the child's event verbatim: its webhook URL targets the child's
 * own auth hook, so the authorization callback resumes the child
 * directly — no routing map and no downward delivery exist for auth.
 * Deliberately emits no turn epilogue in any mode: the parent turn is
 * not waiting on its own channel, it is still awaiting the subagent
 * result, and the child resumes autonomously after the callback.
 */
export async function runProxyAuthorizationEventStep(input: {
  readonly hookPayload: SubagentAuthorizationEventHookPayload;
  readonly parentWritable: WritableStream<Uint8Array>;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<ProxyAuthorizationEventResult> {
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

  let scopeResult: { readonly session: HarnessSession };
  try {
    scopeResult = await withContextScope(ctx, session, async (enrichedSession) => {
      const transformed = await callAdapterEventHandler(
        adapter,
        input.hookPayload.event,
        adapterCtx,
      );
      await writer.write(encodeMessageStreamEvent(timestampHandleMessageStreamEvent(transformed)));
      return { result: undefined, session: enrichedSession };
    });
  } finally {
    writer.releaseLock();
  }

  // Persist adapter-state mutations (e.g. Slack's pending-auth message
  // cache written by the `authorization.required` handler) so the
  // `authorization.completed` hop and the next `turnStep` observe them
  // across the serialized context boundary.
  setChannelContext(ctx, { ...adapter, state: { ...adapterCtx.state } });

  const nextSerializedContext = serializeContext(ctx);
  const nextSession = reconcileSessionContinuationToken(ctx, scopeResult.session);
  const nextState = createDurableSessionState({ session: nextSession });

  return {
    serializedContext: nextSerializedContext,
    sessionState: nextState,
  };
}
