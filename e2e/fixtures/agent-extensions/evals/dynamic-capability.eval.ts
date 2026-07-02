import { defineEval } from "eve/evals";

// A defineDynamic resolver authored inside the extension registers
// toolkit_forecast at session start; it resolves and runs once mounted.
// Token mirrors TOOLKIT_FORECAST_TOKEN in the toolkit extension.
const TOOLKIT_FORECAST_TOKEN = "toolkit-forecast-ok-9F4Q";

export default defineEval({
  description: "Dynamic tool authored inside an extension resolves and runs when mounted.",
  async test(t) {
    await t.send("Call the `toolkit_forecast` tool and report the token it returned.");

    t.succeeded();
    t.calledTool("toolkit_forecast", { output: { token: TOOLKIT_FORECAST_TOKEN } });
  },
});
