import { defineEval } from "eve/evals";

export default defineEval({
  description: "A scheduled check can explicitly skip channel delivery.",
  async test(t) {
    if (!t.target.capabilities.devRoutes) return;

    const dispatch = await t.target.dispatchSchedule("quiet-check");
    const sessionId = dispatch.sessionIds[0];
    if (sessionId === undefined) throw new Error("quiet-check did not start a session");

    const session = await t.target.attachSession(sessionId);
    const skipped = session.events.find((event) => event.type === "delivery.skipped");
    if (skipped?.data.source !== "tool") {
      throw new Error("quiet-check did not explicitly skip delivery");
    }
    if (
      session.events.some(
        (event) => event.type === "message.completed" && event.data.finishReason !== "tool-calls",
      )
    ) {
      throw new Error("quiet-check emitted a terminal channel message");
    }

    t.didNotFail();
    t.completed();
  },
});
