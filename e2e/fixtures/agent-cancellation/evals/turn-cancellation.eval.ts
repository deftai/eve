import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

const WAIT_TOOL_NAME = "wait-for-cancellation";
const FOLLOW_UP_MESSAGE = "follow up after cancellation";

export default defineEval({
  description: "Turn cancellation aborts active work and preserves the session for a follow-up.",
  tags: ["cancellation", "workflow"],

  async test(t) {
    const activeTurn = await t.startTurn(
      `Call ${WAIT_TOOL_NAME} and wait for it to finish before replying.`,
    );

    await t.sleep(5_000);
    await activeTurn.cancel();

    const cancelledTurn = await activeTurn.result();
    await t.require(cancelledTurn.status, equals("waiting"));
    cancelledTurn.calledTool(WAIT_TOOL_NAME, { count: 1, status: "pending" });
    cancelledTurn.eventOrder([{ type: "turn.cancelled" }, { type: "session.waiting" }]);
    cancelledTurn.notEvent("turn.failed");
    cancelledTurn.notEvent("session.failed");

    const followUp = (await t.send(FOLLOW_UP_MESSAGE)).expectOk();
    await t.require(followUp.sessionId, equals(cancelledTurn.sessionId));
    await t.require(followUp.message, equals(`cancellation-follow-up-ok:${FOLLOW_UP_MESSAGE}`));

    t.event("turn.cancelled", { count: 1 });
    t.notEvent("turn.failed");
    t.notEvent("session.failed");
  },
});
