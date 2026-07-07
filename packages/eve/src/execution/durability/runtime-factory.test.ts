import { afterEach, describe, expect, it, vi } from "vitest";

import { createInMemoryDurabilityBackend } from "#execution/durability/backends/in-memory.js";
import { resetDurabilityBootWarningForTests } from "#execution/durability/durability-boot-warning.js";
import {
  createAgentRuntime,
  createRuntimeFromDurabilityBackend,
  createWorkflowRuntime,
} from "#execution/durability/runtime-factory.js";
import { vercelWorkflow } from "#public/durability/vercel-workflow.js";
import type { RuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";

describe("createRuntimeFromDurabilityBackend", () => {
  const compiledArtifactsSource = {} as RuntimeCompiledArtifactsSource;

  afterEach(() => {
    resetDurabilityBootWarningForTests();
    vi.unstubAllEnvs();
  });

  it("returns a Runtime for vercelWorkflow()", () => {
    const runtime = createRuntimeFromDurabilityBackend({
      backend: vercelWorkflow(),
      compiledArtifactsSource,
    });
    expect(runtime).toMatchObject({
      deliver: expect.any(Function),
      getEventStream: expect.any(Function),
      run: expect.any(Function),
    });
  });

  it("matches createWorkflowRuntime for the default backend", () => {
    const fromFactory = createRuntimeFromDurabilityBackend({
      backend: vercelWorkflow(),
      compiledArtifactsSource,
    });
    const fromLegacy = createWorkflowRuntime({ compiledArtifactsSource });
    expect(Object.keys(fromFactory).sort()).toEqual(Object.keys(fromLegacy).sort());
  });

  it("rejects inMemory channel runtime in v1", () => {
    expect(() =>
      createRuntimeFromDurabilityBackend({
        backend: createInMemoryDurabilityBackend(),
        compiledArtifactsSource,
      }),
    ).toThrow(/inMemory\(\)/);
  });

  it("warns in production when creating runtime with inmemory manifest backend", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createAgentRuntime({
        compiledArtifactsSource,
        durabilityBackendName: "inmemory",
      }),
    ).toThrow(/inMemory\(\)/);
    vi.unstubAllEnvs();
  });

  it("rejects unknown backend names", () => {
    expect(() =>
      createRuntimeFromDurabilityBackend({
        backend: {
          name: "unknown",
          createBinding: async () => ({ port: {} as never, shutdown: async () => {} }),
        },
        compiledArtifactsSource,
      }),
    ).toThrow(/Unknown durability backend/);
  });
});
