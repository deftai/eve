import { createVercelDurabilityBackend } from "#execution/durability/backends/vercel-workflow.js";
import type { DurabilityBackend } from "#public/definitions/durability-backend.js";

/**
 * Constructs the production durability backend wrapping `@workflow/core`.
 *
 * Default when `experimental.durability.backend` is omitted.
 */
export function vercelWorkflow(): DurabilityBackend {
  return createVercelDurabilityBackend();
}
