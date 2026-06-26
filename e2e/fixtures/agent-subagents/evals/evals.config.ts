import { defineEvalConfig } from "eve/evals";

/** Default judge model for any `t.judge.*` assertion in this fixture. */
export default defineEvalConfig({
  judge: {
    model: "zai/glm-5.2",
    modelOptions: {
      providerOptions: {
        gateway: { only: ["zai"] },
      },
    },
  },
});
