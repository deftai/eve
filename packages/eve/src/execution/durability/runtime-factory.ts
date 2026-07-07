import { IN_MEMORY_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/in-memory.js";
import { warnIfInMemoryDurabilityInProduction } from "#execution/durability/durability-boot-warning.js";
import { resolveDurabilityBackendByName } from "#execution/durability/resolve-durability-backend.js";
import { createVercelWorkflowRuntime } from "#execution/workflow-runtime.js";
import type { Runtime } from "#channel/types.js";
import type { RuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import type { DurabilityBackend } from "#shared/durability-backend.js";
import { VERCEL_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/vercel-workflow.js";

/**
 * Config for {@link createRuntimeFromDurabilityBackend}.
 */
export interface CreateRuntimeFromDurabilityBackendConfig {
  readonly backend: DurabilityBackend;
  readonly compiledArtifactsSource: RuntimeCompiledArtifactsSource;
  readonly nodeId?: string;
}

/**
 * Config for {@link createAgentRuntime}.
 */
export interface CreateAgentRuntimeConfig {
  readonly compiledArtifactsSource: RuntimeCompiledArtifactsSource;
  readonly durabilityBackendName?: string;
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
        "experimental.durability.backend is set to inMemory(), but the in-process channel Runtime is not implemented in v1. Use vercelWorkflow() (default) for serving traffic.",
      );
    default:
      throw new Error(`Unknown durability backend "${config.backend.name}".`);
  }
}

/**
 * Creates a channel {@link Runtime} using the compiled agent's durability backend.
 */
export function createAgentRuntime(config: CreateAgentRuntimeConfig): Runtime {
  const backend = resolveDurabilityBackendByName(config.durabilityBackendName);
  warnIfInMemoryDurabilityInProduction(backend.name);
  return createRuntimeFromDurabilityBackend({
    backend,
    compiledArtifactsSource: config.compiledArtifactsSource,
    nodeId: config.nodeId,
  });
}

/**
 * Default workflow-backed runtime used by channels, schedules, and child sessions.
 */
export function createWorkflowRuntime(config: CreateAgentRuntimeConfig): Runtime {
  return createAgentRuntime(config);
}
