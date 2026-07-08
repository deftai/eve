import { describe, expect, it } from "vitest";

import { IN_MEMORY_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/in-memory.js";
import { VERCEL_DURABILITY_BACKEND_NAME } from "#execution/durability/backends/vercel-workflow.js";
import { resolveDurabilityBackendByName } from "#execution/durability/resolve-durability-backend.js";

describe("resolveDurabilityBackendByName", () => {
  it("defaults to vercel-workflow", () => {
    expect(resolveDurabilityBackendByName().name).toBe(VERCEL_DURABILITY_BACKEND_NAME);
  });

  it("resolves inmemory by name", () => {
    expect(resolveDurabilityBackendByName(IN_MEMORY_DURABILITY_BACKEND_NAME).name).toBe(
      IN_MEMORY_DURABILITY_BACKEND_NAME,
    );
  });

  it("rejects unknown backend names", () => {
    expect(() => resolveDurabilityBackendByName("rivet")).toThrow(/Unknown durability backend/);
  });
});
