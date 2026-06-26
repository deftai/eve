import { deserializeContext } from "#context/serialize.js";
import { readDurableSession, type DurableSessionState } from "#execution/durable-session-store.js";
import {
  cancelRemoteAgentTurn,
  resolveRemoteAgentForAction,
} from "#execution/remote-agent-dispatch.js";
import { getPendingRuntimeActionBatch } from "#harness/runtime-actions.js";
import { BundleKey } from "#runtime/sessions/runtime-context-keys.js";
import type { RuntimeSubagentResultActionResult } from "#runtime/actions/types.js";

/** Cancels every remote child recorded on the turn's pending runtime-action batch. */
export async function cancelPendingRemoteAgentTurnsStep(input: {
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<readonly RuntimeSubagentResultActionResult[]> {
  "use step";

  const durableSession = await readDurableSession(input.sessionState);
  const batch = getPendingRuntimeActionBatch(durableSession.state);
  if (batch?.remoteAgentSessions === undefined) return [];

  const ctx = await deserializeContext(input.serializedContext);
  const bundle = ctx.require(BundleKey);

  return Promise.all(
    batch.actions.flatMap((action) => {
      if (action.kind !== "remote-agent-call") return [];

      const identity = batch.remoteAgentSessions?.[action.callId];
      if (identity === undefined) return [];

      return [
        (async (): Promise<RuntimeSubagentResultActionResult> => {
          const remote = resolveRemoteAgentForAction({
            nodeId: action.nodeId,
            registry: bundle.subagentRegistry.subagentsByNodeId,
            remoteAgentName: action.remoteAgentName,
          });
          await cancelRemoteAgentTurn({
            continuationToken: identity.continuationToken,
            remote,
            sessionId: identity.sessionId,
          });
          return {
            callId: action.callId,
            isError: true,
            kind: "subagent-result",
            output: {
              code: "REMOTE_AGENT_CANCELLED",
              message: `Remote agent "${action.remoteAgentName}" was cancelled.`,
            },
            subagentName: action.remoteAgentName,
          };
        })(),
      ];
    }),
  );
}
