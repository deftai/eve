import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Search the web with tavily. Returns a deterministic fixture result. Call when asked to search the web.",
  inputSchema: z.object({ query: z.string() }),
  async execute({ query }) {
    return { query, result: `tavily-result-for:${query}` };
  },
});
