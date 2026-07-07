import { IN_MEMORY_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/in-memory.js";
import { VERCEL_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/vercel-workflow.js";

/** Stable durability backend names accepted at compile time. */
export const KNOWN_DURABILITY_BACKEND_NAMES = new Set<string>([
  IN_MEMORY_DURABILITY_BACKEND_NAME,
  VERCEL_DURABILITY_BACKEND_NAME,
]);
