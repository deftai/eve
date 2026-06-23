import { defineEval } from "eve/evals";

import { postChannel } from "./shared.js";

/** Structured-output smoke for the cross-channel `args.receive` handoff. */
export default defineEval({
  description: "Custom channel smoke: structured cross-channel receive.",

  async test(t) {
    const payload = await postChannel<{ ok: boolean; sessionId?: string }>(t.target, "/webhook", {
      message: "Return a structured summary of this handoff.",
      structured: true,
    });
    if (payload.ok !== true || typeof payload.sessionId !== "string") {
      throw new Error(`Unexpected webhook response: ${JSON.stringify(payload)}`);
    }

    const session = await t.target.attachSession(payload.sessionId);
    const results = session.events.filter((event) => event.type === "result.completed");
    if (results.length !== 1) {
      throw new Error(`Expected one result.completed event, received ${results.length}.`);
    }

    const result = results[0]?.data.result;
    if (
      !isRecord(result) ||
      typeof result.title !== "string" ||
      typeof result.count !== "number" ||
      !Number.isInteger(result.count)
    ) {
      throw new Error(`Unexpected structured result: ${JSON.stringify(result)}`);
    }

    t.didNotFail();
    t.completed();
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
