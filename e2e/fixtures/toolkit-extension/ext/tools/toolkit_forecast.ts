import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

export const TOOLKIT_FORECAST_TOKEN = "toolkit-forecast-ok-9F4Q";

// A dynamic capability authored inside an extension: the resolver registers a
// tool at session start, and it composes and runs like any other extension
// contribution once mounted.
export default defineDynamic({
  events: {
    "session.started": async () => ({
      toolkit_forecast: defineTool({
        description:
          "Return the toolkit forecast token. Call when asked to run the toolkit forecast.",
        inputSchema: z.object({}),
        async execute() {
          return { token: TOOLKIT_FORECAST_TOKEN };
        },
      }),
    }),
  },
});
