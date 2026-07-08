import { IN_MEMORY_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/in-memory.js";
import { createLogger } from "#internal/logging.js";

const log = createLogger("execution.durability");

let warnedInMemoryInProduction = false;

/**
 * Logs a one-time production warning when the compiled agent selects the
 * in-memory durability backend unless explicitly overridden.
 */
export function warnIfInMemoryDurabilityInProduction(backendName: string | undefined): void {
  if (backendName !== IN_MEMORY_DURABILITY_BACKEND_NAME) {
    return;
  }
  if (process.env.EVE_ALLOW_INMEMORY_DURABILITY === "1") {
    return;
  }
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
    return;
  }
  if (warnedInMemoryInProduction) {
    return;
  }
  warnedInMemoryInProduction = true;
  log.warn(
    "experimental.durability.backend is set to inMemory() in a production environment. Process-local durability is not durable across restarts or replicas. Set EVE_ALLOW_INMEMORY_DURABILITY=1 to suppress this warning.",
  );
}

/** Test-only reset for warning deduplication. */
export function resetDurabilityBootWarningForTests(): void {
  warnedInMemoryInProduction = false;
}
