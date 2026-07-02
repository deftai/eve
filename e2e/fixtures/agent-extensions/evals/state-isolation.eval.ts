import { defineEval } from "eve/evals";

// Both extensions author defineState("budget"). eve namespaces each to its own
// mount, so bumping toolkit's budget twice leaves tavily's budget at 1 — the
// counters do not share one durable slot.
export default defineEval({
  description: "Two extensions' identically-named defineState do not collide within a session.",
  async test(t) {
    await t.send(
      "Bump the toolkit budget twice by calling `toolkit__toolkit_budget` two times, then bump the tavily budget once by calling `tavily__tavily_budget`. Report each tool's returned count.",
    );

    t.succeeded();
    t.calledTool("tavily__tavily_budget", { output: { scope: "tavily", count: 1 } });
  },
});
