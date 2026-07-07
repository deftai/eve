import {
  createVercelDurabilityBackend,
  VERCEL_DURABILITY_BACKEND_NAME,
} from "#execution/durability/backends/vercel-workflow.js";
import { IN_MEMORY_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/in-memory.js";
import { createVercelWorkflowRuntime } from "#execution/workflow-runtime.js";
import type { Runtime } from "#channel/types.js";
import type { RuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import type { DurabilityBackend } from "#shared/durability-backend.js";

/**
 * Config for {@link createRuntimeFromDurabilityBackend}.
 */
export interface CreateRuntimeFromDurabilityBackendConfig {
  readonly backend: DurabilityBackend;
  readonly compiledArtifactsSource: RuntimeCompiledArtifactsSource;
  readonly nodeId?: string;
}

/**
 * Selects a {@link Runtime} implementation from a compiled durability backend.
 */
export function createRuntimeFromDurabilityBackend(
  config: CreateRuntimeFromDurabilityBackendConfig,
): Runtime {
  switch (config.backend.name) {
    case VERCEL_DURABILITY_BACKEND_NAME:
      return createVercelWorkflowRuntime({
        compiledArtifactsSource: config.compiledArtifactsSource,
        nodeId: config.nodeId,
      });
    case IN_MEMORY_DURABILITY_BACKEND_NAME:
      throw new Error(
        "inMemory() durability runtime is not wired until Phase 3 (experimental.durability.backend).",
      );
    default:
      throw new Error(`Unknown durability backend "${config.backend.name}".`);
  }
}

/**
 * Default workflow-backed runtime used by channels, schedules, and child sessions.
 */
export function createWorkflowRuntime(config: {
  readonly compiledArtifactsSource: RuntimeCompiledArtifactsSource;
  readonly nodeId?: string;
}): Runtime {
  return createRuntimeFromDurabilityBackend({
    backend: createVercelDurabilityBackend(),
    compiledArtifactsSource: config.compiledArtifactsSource,
    nodeId: config.nodeId,
  });
}