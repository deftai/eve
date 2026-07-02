import { defineEval } from "eve/evals";

// Both extensions author defineState("budget"). eve scopes each to its own
// package, so bumping toolkit's budget twice leaves tavily's budget at 1 — the
// counters do not share one durable slot.
//
// This also covers the two distinct bundling paths for that scoping:
//   - tavily's budget tool is composed straight from the extension (module-map
//     path);
//   - toolkit's budget tool is a consumer override that re-exports the
//     extension's tool (agent/tools/toolkit__toolkit_budget.ts), so its
//     `defineState` is evaluated inside the consumer's bundle. If build-time
//     scoping regressed, that eager consumer-side import would collapse both
//     counters onto one bare "budget" slot and tavily would read 3, not 1.
export default defineEval({
  description: "Two extensions' identically-named defineState do not collide within a session.",
  async test(t) {
    await t.send(
      "Bump the toolkit budget twice by calling `toolkit__toolkit_budget` two times, then bump the tavily budget once by calling `tavily__tavily_budget`. Report each tool's returned count.",
    );

    t.succeeded();
    t.calledTool("toolkit__toolkit_budget", { output: { scope: "toolkit", count: 2 } });
    t.calledTool("tavily__tavily_budget", { output: { scope: "tavily", count: 1 } });
  },
});
