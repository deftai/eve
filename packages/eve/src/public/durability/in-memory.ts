import { createInMemoryDurabilityBackend } from "#execution/durability/backends/in-memory.js";
import type { DurabilityBackend } from "#public/definitions/durability-backend.js";

/**
 * Options for {@link inMemory}. Reserved for future tuning; v1 accepts none.
 */
export type InMemoryDurabilityOptions = Record<string, never>;

/**
 * Constructs the in-process durability backend for dev and tests.
 *
 * Process-local only — not a security boundary. Production use logs a
 * framework warning unless `EVE_ALLOW_INMEMORY_DURABILITY=1` is set.
 */
export function inMemory(_opts?: InMemoryDurabilityOptions): DurabilityBackend {
  return createInMemoryDurabilityBackend();
}
