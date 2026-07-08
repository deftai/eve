/** Stable name for the in-process durability backend. */
export const IN_MEMORY_DURABILITY_BACKEND_NAME = "inmemory";

/** Stable name for the Vercel Workflow durability backend. */
export const VERCEL_DURABILITY_BACKEND_NAME = "vercel-workflow";

/** Stable durability backend names accepted at compile time. */
export const KNOWN_DURABILITY_BACKEND_NAMES = new Set<string>([
  IN_MEMORY_DURABILITY_BACKEND_NAME,
  VERCEL_DURABILITY_BACKEND_NAME,
]);
