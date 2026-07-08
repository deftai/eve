import type { DurabilityPort } from "#shared/durability-port.js";

/**
 * Runtime context for durability backend binding creation.
 */
export interface DurabilityBackendRuntimeContext {
  readonly appRoot: string;
}

/**
 * Input to {@link DurabilityBackend.createBinding}.
 */
export interface DurabilityBackendCreateInput {
  readonly runtimeContext: DurabilityBackendRuntimeContext;
}

/**
 * Live binding returned when the runtime selects a durability backend.
 */
export interface DurabilityBackendBinding {
  readonly port: DurabilityPort;
  shutdown(): Promise<void>;
}

/**
 * Pluggable durability backend.
 *
 * Parallel to {@link import("#shared/sandbox-backend.js").SandboxBackend}:
 * authors attach a backend to choose which engine hosts durable sessions.
 * v1 ships `vercelWorkflow()` (default) and `inMemory()` (experimental).
 */
export interface DurabilityBackend {
  readonly name: string;
  createBinding(input: DurabilityBackendCreateInput): Promise<DurabilityBackendBinding>;
}
