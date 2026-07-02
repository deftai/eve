import { defineEval } from "eve/evals";

// The consumer's own tool and a second extension's tool are both callable in
// one turn, each under its own name (local_ping is the agent's; tavily__tavily_search
// is namespaced by the tavily mount).
export default defineEval({
  description: "Consumer-authored and mounted-extension tools coexist and both run in one turn.",
  async test(t) {
    await t.send(
      "First call `local_ping`, then call `tavily__tavily_search` with query 'eve'. Report both outputs.",
    );

    t.succeeded();
    t.calledTool("local_ping", { output: { reply: "local-ping" } });
    t.calledTool("tavily__tavily_search", {
      output: { query: "eve", result: "tavily-result-for:eve" },
    });
  },
});
