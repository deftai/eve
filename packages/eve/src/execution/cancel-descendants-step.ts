import { deserializeContext } from "#context/serialize.js";
import { createSessionCancellationHookId } from "#execution/cancellation.js";
import { type DurableSessionState, readDurableSession } from "#execution/durable-session-store.js";
import { resumeOwnedCancellationHook } from "#execution/workflow-hook.js";
import {
  cancelRemoteAgentSession,
  resolveRemoteAgentForAction,
} from "#execution/remote-agent-dispatch.js";
import { getPendingRuntimeActionBatch } from "#harness/runtime-actions.js";
import { BundleKey } from "#runtime/sessions/runtime-context-keys.js";

/** Requests cancellation of every child owned by the active runtime-action batch. */
export async function cancelDescendantsStep(input: {
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}): Promise<void> {
  "use step";

  const durable = await readDurableSession(input.sessionState);
  const batch = getPendingRuntimeActionBatch(durable.state);
  if (batch?.children === undefined) return;

  const ctx = await deserializeContext(input.serializedContext);
  const bundle = ctx.require(BundleKey);
  const tasks: Promise<void>[] = [];

  for (const action of batch.actions) {
    const child = batch.children[action.callId];
    if (child === undefined) continue;

    if (action.kind === "subagent-call") {
      tasks.push(cancelLocalChild(child));
      continue;
    }

    if (action.kind === "remote-agent-call") {
      const remote = resolveRemoteAgentForAction({
        nodeId: action.nodeId,
        remoteAgentName: action.remoteAgentName,
        registry: bundle.subagentRegistry.subagentsByNodeId,
      });
      tasks.push(
        cancelRemoteAgentSession({
          remote,
          sessionId: child.sessionId,
        }),
      );
    }
  }

  await Promise.allSettled(tasks);
}

async function cancelLocalChild(input: {
  readonly continuationToken: string;
  readonly sessionId: string;
}): Promise<void> {
  await resumeOwnedCancellationHook({
    cancellationHookId: createSessionCancellationHookId(input.sessionId),
    expectedRunId: input.sessionId,
    ownerHookId: input.continuationToken,
  });
}
