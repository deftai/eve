import { defineConfig } from "eve/extension";

export default defineConfig({
  apiKey: { type: "string", secret: true, required: true },
  tier: { type: "string", default: "free" },
});
