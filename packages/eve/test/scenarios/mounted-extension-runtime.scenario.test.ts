import { describe, expect, it } from "vitest";

import { compileAgent } from "../../src/compiler/compile-agent.js";
import { createDiskRuntimeCompiledArtifactsSource } from "../../src/runtime/compiled-artifacts-source.js";
import { loadCompiledManifest } from "../../src/runtime/loaders/manifest.js";
import { loadCompiledModuleMap } from "../../src/runtime/loaders/module-map.js";
import { resolveRuntimeAgentGraph } from "../../src/runtime/resolve-agent-graph.js";
import { useScenarioApp } from "../../src/internal/testing/scenario-app.js";

const scenarioApp = useScenarioApp();

/**
 * End-to-end proof that a mounted extension's config binds at runtime: the
 * generated module map evaluates the mount (`crm({ apiKey })`) at load, which
 * binds the extension's config handle; the composed tool — loaded from the
 * package and namespaced `crm__…` — reads the bound value through `config.get()`.
 */
describe("mounted extension runtime", () => {
  it("binds mounted config and exposes the composed tool by its namespaced name", async () => {
    const app = await scenarioApp({
      name: "mounted-extension-runtime",
      installDependencies: true,
      files: {
        "agent/agent.mjs": 'export default { model: "openai/gpt-5.4" };\n',
        "agent/instructions.md": "You are a precise assistant.\n",
        "agent/extensions/crm.mjs": [
          'import crm from "@acme/crm";',
          'export default crm({ apiKey: "sk-runtime" });',
          "",
        ].join("\n"),
        "node_modules/@acme/crm/package.json": `${JSON.stringify({
          name: "@acme/crm",
          type: "module",
          eve: { extension: "ext" },
          exports: { ".": "./index.mjs" },
        })}\n`,
        "node_modules/@acme/crm/index.mjs": 'export { default } from "./ext/config.mjs";\n',
        "node_modules/@acme/crm/ext/config.mjs": [
          'import { defineConfig } from "eve/extension";',
          "export default defineConfig({ apiKey: { type: 'string', required: true } });",
          "",
        ].join("\n"),
        "node_modules/@acme/crm/ext/tools/crm_echo.mjs": [
          'import { defineTool } from "eve/tools";',
          'import config from "../config.mjs";',
          "export default defineTool({",
          '  description: "Echo the configured API key.",',
          "  inputSchema: { type: 'object', properties: {}, additionalProperties: false },",
          "  async execute() {",
          "    return { apiKey: config.get().apiKey };",
          "  },",
          "});",
          "",
        ].join("\n"),
      },
    });

    await compileAgent({ startPath: app.appRoot });

    const compiledArtifactsSource = createDiskRuntimeCompiledArtifactsSource(app.appRoot);
    const [manifest, moduleMap] = await Promise.all([
      loadCompiledManifest({ compiledArtifactsSource }),
      loadCompiledModuleMap({ compiledArtifactsSource }),
    ]);
    const graph = await resolveRuntimeAgentGraph({ manifest, moduleMap });

    const tool = graph.root.agent.tools.find((entry) => entry.name === "crm__crm_echo");
    expect(tool).toBeDefined();
    await expect(tool?.execute?.({})).resolves.toEqual({ apiKey: "sk-runtime" });
  });
});
