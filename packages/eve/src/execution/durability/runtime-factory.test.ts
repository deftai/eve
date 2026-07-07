import { describe, expect, it } from "vitest";

import { createInMemoryDurabilityBackend } from "#execution/durability/backends/in-memory.js";
import {
  createRuntimeFromDurabilityBackend,
  createWorkflowRuntime,
} from "#execution/durability/runtime-factory.js";
import { vercelWorkflow } from "#public/durability/vercel-workflow.js";
import type { RuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";

describe("createRuntimeFromDurabilityBackend", () => {
  const compiledArtifactsSource = {} as RuntimeCompiledArtifactsSource;

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

  it("rejects inMemory until Phase 3 wiring", () => {
    expect(() =>
      createRuntimeFromDurabilityBackend({
        backend: createInMemoryDurabilityBackend(),
        compiledArtifactsSource,
      }),
    ).toThrow(/Phase 3/);
  });

  it("rejects unknown backend names", () => {
    expect(() =>
      createRuntimeFromDurabilityBackend({
        backend: { name: "unknown", createBinding: async () => ({ port: {} as never, shutdown: async () => {} }) },
        compiledArtifactsSource,
      }),
    ).toThrow(/Unknown durability backend/);
  });
});