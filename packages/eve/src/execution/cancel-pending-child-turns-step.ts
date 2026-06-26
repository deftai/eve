import { readDurableSession, type DurableSessionState } from "#execution/durable-session-store.js";
import { sendTurnCancellationStep } from "#execution/turn-control-protocol.js";
import { getPendingRuntimeActionBatch } from "#harness/runtime-actions.js";

/** Cascades cancellation to every local child turn in the pending action batch. */
export async function cancelPendingChildTurnsStep(input: {
  readonly sessionState: DurableSessionState;
}): Promise<void> {
  "use step";

  const durableSession = await readDurableSession(input.sessionState);
  const batch = getPendingRuntimeActionBatch(durableSession.state);
  if (batch?.childTurnInboxTokens === undefined) return;

  await Promise.all(
    batch.actions.flatMap((action) => {
      if (action.kind !== "subagent-call") return [];
      const inboxToken = batch.childTurnInboxTokens?.[action.callId];
      return inboxToken === undefined ? [] : [sendTurnCancellationStep({ inboxToken })];
    }),
  );
}
