import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Blocks until the active turn is cancelled.",
  inputSchema: z.object({}),
  async execute(_input, { abortSignal }) {
    await new Promise<never>((_resolve, reject) => {
      const onAbort = () => {
        reject(abortSignal.reason ?? new Error("Turn cancelled."));
      };

      if (abortSignal.aborted) {
        onAbort();
        return;
      }

      abortSignal.addEventListener("abort", onAbort, { once: true });
    });
  },
});
