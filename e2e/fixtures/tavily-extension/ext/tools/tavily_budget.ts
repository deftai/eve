import { defineState } from "eve/context";
import { defineTool } from "eve/tools";
import { z } from "zod";

// Same bare "budget" name as toolkit-extension. eve namespaces each to its own
// mount, so the two counters stay independent within one session.
const budget = defineState("budget", () => ({ count: 0 }));

export default defineTool({
  description:
    "Increment and read the tavily budget counter. Call when asked to bump the tavily budget.",
  inputSchema: z.object({}),
  async execute() {
    budget.update((state) => ({ count: state.count + 1 }));
    return { scope: "tavily", count: budget.get().count };
  },
});
