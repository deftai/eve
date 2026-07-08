import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAgentSourceManifest, createModuleSourceRef } from "#discover/manifest.js";
import { compileAgentConfig } from "#compiler/normalize-agent-config.js";
import type { ManifestCompileContext } from "#compiler/normalize-helpers.js";
import { inMemory } from "#public/durability/in-memory.js";
import { vercelWorkflow } from "#public/durability/vercel-workflow.js";

const mocks = vi.hoisted(() => ({
  loadModuleBackedDefinition: vi.fn(),
}));

vi.mock("#compiler/normalize-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#compiler/normalize-helpers.js")>()),
  loadModuleBackedDefinition: mocks.loadModuleBackedDefinition,
}));

describe("compileAgentConfig durability backend", () => {
  beforeEach(() => {
    mocks.loadModuleBackedDefinition.mockReset();
  });

  it("compiles inMemory() to backendName inmemory", async () => {
    mocks.loadModuleBackedDefinition.mockResolvedValue({
      model: "openai/gpt-5.5",
      experimental: {
        durability: { backend: inMemory() },
      },
    });

    const compiled = await compileAgentConfig(createManifest(), {
      modelCatalog: createModelCatalog(),
    });

    expect(compiled.experimental?.durability).toEqual({ backendName: "inmemory" });
  });

  it("compiles vercelWorkflow() to backendName vercel-workflow", async () => {
    mocks.loadModuleBackedDefinition.mockResolvedValue({
      model: "openai/gpt-5.5",
      experimental: {
        durability: { backend: vercelWorkflow() },
      },
    });

    const compiled = await compileAgentConfig(createManifest(), {
      modelCatalog: createModelCatalog(),
    });

    expect(compiled.experimental?.durability).toEqual({ backendName: "vercel-workflow" });
  });

  it("rejects unknown durability backends at compile time", async () => {
    mocks.loadModuleBackedDefinition.mockResolvedValue({
      model: "openai/gpt-5.5",
      experimental: {
        durability: {
          backend: {
            name: "rivet",
            createBinding: async () => ({
              port: {} as never,
              shutdown: async () => {},
            }),
          },
        },
      },
    });

    await expect(
      compileAgentConfig(createManifest(), {
        modelCatalog: createModelCatalog(),
      }),
    ).rejects.toThrow(/Unknown durability backend "rivet"/);
  });
});

function createManifest() {
  return createAgentSourceManifest({
    agentId: "app",
    agentRoot: "/app/agent",
    appRoot: "/app",
    configModule: createModuleSourceRef({
      logicalPath: "agent.ts",
      sourceId: "agent-config",
    }),
  });
}

function createModelCatalog(): ManifestCompileContext["modelCatalog"] {
  return {
    getByProviderModelId: vi.fn(),
    getModelLimits: vi.fn(async () => ({ contextWindowTokens: 256_000 })),
  };
}
