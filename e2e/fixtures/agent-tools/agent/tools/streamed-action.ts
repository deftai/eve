import { defineTool } from "eve/tools";
import { z } from "zod";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default defineTool({
  description:
    "Test-only tool: records when local execution begins, then waits before returning. Only call when the user explicitly asks to use `streamed-action`.",
  inputSchema: z.object({
    label: z.string(),
  }),
  async execute(input) {
    const executionStartedAt = Date.now();
    await delay(500);

    return { executionStartedAt, label: input.label };
  },
});
