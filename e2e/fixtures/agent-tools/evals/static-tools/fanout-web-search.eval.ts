import { defineEval } from "eve/evals";

import { FANOUT_SIZE, fanoutRequestsPrecedeFirstResult } from "./fanout.js";

const TOOL_NAME = "web_search";
const TRISTATE_LOCATIONS = [
  "New York City, NY",
  "Brooklyn, NY",
  "Queens, NY",
  "Newark, NJ",
  "Jersey City, NJ",
  "Stamford, CT",
  "Bridgeport, CT",
  "Yonkers, NY",
  "Long Island, NY",
  "Hoboken, NJ",
] as const;

export default defineEval({
  description: "Provider tools smoke: ten web searches stream before the first result.",
  async test(t) {
    const turn = await t.send(
      [
        `Use the provider-managed \`${TOOL_NAME}\` tool exactly ${FANOUT_SIZE} separate times in one tool-use step.`,
        `Search the current weather for each location exactly once: ${TRISTATE_LOCATIONS.join("; ")}.`,
        "Use one search query per tool call; do not combine locations in one call.",
        "Start every search before waiting for any result. Do not use any other tool.",
        "After every search returns, give a concise tristate weather summary.",
      ].join("\n"),
    );
    turn.expectOk();

    t.didNotFail();
    t.completed();
    t.calledTool(TOOL_NAME, { isError: false, times: FANOUT_SIZE });
    t.noFailedActions();
    t.event(
      (events) => fanoutRequestsPrecedeFirstResult({ events, toolName: TOOL_NAME }),
      "ten provider web-search requests precede the first provider result",
    );
  },
});
