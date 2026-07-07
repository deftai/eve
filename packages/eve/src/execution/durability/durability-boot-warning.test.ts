import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetDurabilityBootWarningForTests,
  warnIfInMemoryDurabilityInProduction,
} from "#execution/durability/durability-boot-warning.js";

describe("warnIfInMemoryDurabilityInProduction", () => {
  afterEach(() => {
    resetDurabilityBootWarningForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not warn for vercel-workflow backend", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");

    warnIfInMemoryDurabilityInProduction("vercel-workflow");

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once in production when inmemory is selected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");

    warnIfInMemoryDurabilityInProduction("inmemory");
    warnIfInMemoryDurabilityInProduction("inmemory");

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("inMemory()");
  });

  it("suppresses the warning when EVE_ALLOW_INMEMORY_DURABILITY is set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EVE_ALLOW_INMEMORY_DURABILITY", "1");

    warnIfInMemoryDurabilityInProduction("inmemory");

    expect(warn).not.toHaveBeenCalled();
  });
});
