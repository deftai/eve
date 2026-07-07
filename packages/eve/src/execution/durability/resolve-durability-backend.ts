import {
  createInMemoryDurabilityBackend,
  IN_MEMORY_DURABILITY_BACKEND_NAME,
} from "#execution/durability/backends/in-memory.js";
import { createVercelDurabilityBackend } from "#execution/durability/backends/vercel-workflow.js";
import { KNOWN_DURABILITY_BACKEND_NAMES } from "#execution/durability/known-backends.js";
import type { DurabilityBackend } from "#shared/durability-backend.js";

/**
 * Resolves a compiled durability backend name to a live backend instance.
 *
 * Returns {@link createVercelDurabilityBackend} when `backendName` is omitted.
 */
export function resolveDurabilityBackendByName(backendName?: string): DurabilityBackend {
  if (backendName === undefined) {
    return createVercelDurabilityBackend();
  }

  if (!KNOWN_DURABILITY_BACKEND_NAMES.has(backendName)) {
    throw new Error(
      `Unknown durability backend "${backendName}". Supported backends: ${[...KNOWN_DURABILITY_BACKEND_NAMES].join(", ")}.`,
    );
  }

  if (backendName === IN_MEMORY_DURABILITY_BACKEND_NAME) {
    return createInMemoryDurabilityBackend();
  }

  return createVercelDurabilityBackend();
}
