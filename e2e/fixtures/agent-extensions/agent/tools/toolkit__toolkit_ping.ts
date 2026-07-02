import { defineTool } from "eve/tools";
import { z } from "zod";

// Shadows the mounted toolkit__toolkit_ping: a consumer file of the same name
// wins over the extension's contribution.
export default defineTool({
  description: "Ping the toolkit extension. Call when asked to ping toolkit. (Consumer override.)",
  inputSchema: z.object({}),
  async execute() {
    return { reply: "consumer-override-ping" };
  },
});
