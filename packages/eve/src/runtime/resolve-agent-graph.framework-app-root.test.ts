import { describe, expect, it, vi } from "vitest";

import { createCompiledAgentManifest, ROOT_COMPILED_AGENT_NODE_ID } from "#compiler/manifest.js";
import { TEST_DEFAULT_MODEL_ID } from "#internal/testing/app-harness.js";

const mocks = vi.hoisted(() => ({
  getFrameworkChannelDefinitions: vi.fn(() => []),
}));

vi.mock("#runtime/framework-channels/index.js", () => ({
  getAllFrameworkChannelNames: () => new Set(),
  getFrameworkChannelDefinitions: mocks.getFrameworkChannelDefinitions,
}));

import { resolveRuntimeAgentGraph } from "#runtime/resolve-agent-graph.js";

describe("resolveRuntimeAgentGraph", () => {
  it("uses the authored app root for framework channels when supplied", async () => {
    const manifest = createCompiledAgentManifest({
      agentRoot: "/snapshot/app/agent",
      appRoot: "/snapshot/app",
      config: {
        model: {
          id: TEST_DEFAULT_MODEL_ID,
          routing: { kind: "gateway", target: "openai" },
        },
        name: "snapshot-agent",
      },
    });

    await resolveRuntimeAgentGraph({
      frameworkAppRoot: "/workspace/app",
      manifest,
      moduleMap: {
        nodes: {
          [ROOT_COMPILED_AGENT_NODE_ID]: { modules: {} },
        },
      },
    });

    expect(mocks.getFrameworkChannelDefinitions).toHaveBeenCalledWith({
      appRoot: "/workspace/app",
    });
  });
});
