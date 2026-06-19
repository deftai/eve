import { defineEval } from "eve/evals";

import { WORKSPACE_SEED_PATH, WORKSPACE_SEED_TOKEN } from "./shared.js";

const WORKSPACE_SEED_CONTENT = `${WORKSPACE_SEED_TOKEN}\n`;

export default defineEval({
  description: "Sandbox: a workspace-seeded file is exposed through download_file.",
  async test(t) {
    const turn = await t.send(
      [
        `Use download_file to make ${WORKSPACE_SEED_PATH} available with mediaType text/plain.`,
        "Do not call any other tools.",
        "Reply briefly when it is ready.",
      ].join("\n"),
    );
    turn.expectOk();

    t.didNotFail();
    t.completed();
    t.calledTool("download_file", {
      input: { filePath: WORKSPACE_SEED_PATH, mediaType: "text/plain" },
      isError: false,
      output: {
        filename: "seed-data.txt",
        mediaType: "text/plain",
        size: Buffer.byteLength(WORKSPACE_SEED_CONTENT),
        type: "file",
        url: `data:text/plain;base64,${Buffer.from(WORKSPACE_SEED_CONTENT).toString("base64")}`,
      },
    });
  },
});
