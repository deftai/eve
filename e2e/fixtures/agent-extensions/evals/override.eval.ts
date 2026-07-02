import { defineEval } from "eve/evals";

// agent/tools/toolkit__toolkit_ping.ts shadows the mounted toolkit ping, so the
// consumer's version runs instead of the extension's ("toolkit-extension-ping").
export default defineEval({
  description: "A consumer file shadows a mounted extension tool of the same name.",
  async test(t) {
    await t.send("Call the `toolkit__toolkit_ping` tool and report exactly what it returned.");

    t.succeeded();
    t.calledTool("toolkit__toolkit_ping", { output: { reply: "consumer-override-ping" } });
  },
});
