import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveTestVercelTarget } from "#internal/testing/verified-vercel-target.js";

import { createDevelopmentCredentialGate } from "./credential-gate.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function verifiedTarget(host: string) {
  return await resolveTestVercelTarget({
    host,
    projectId: "prj_verified",
    projectName: "verified-project",
  });
}

describe("createDevelopmentCredentialGate", () => {
  it("stays anonymous until an authoritative target is installed", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "ambient-bypass");
    const gate = createDevelopmentCredentialGate("https://verified.example.com/path");

    await expect(gate.resolveToken()).resolves.toBe("");
    await expect(gate.resolveBypassHeaders()).resolves.toEqual({});

    const target = await verifiedTarget("verified.example.com");
    gate.authorize({ target, resolveToken: async () => " oidc-token " });

    await expect(gate.resolveToken()).resolves.toBe("oidc-token");
    await expect(gate.resolveBypassHeaders()).resolves.toEqual({
      "x-vercel-protection-bypass": "ambient-bypass",
    });
  });

  it("rejects authority for a different origin without replacing current authority", async () => {
    const gate = createDevelopmentCredentialGate("https://verified.example.com");
    const target = await verifiedTarget("verified.example.com");
    const otherTarget = await verifiedTarget("other.example.com");
    gate.authorize({ target, resolveToken: async () => "first-token" });

    expect(() =>
      gate.authorize({ target: otherTarget, resolveToken: async () => "other-token" }),
    ).toThrow("does not match");
    await expect(gate.resolveToken()).resolves.toBe("first-token");
  });

  it("permits an automation bypass only after origin verification", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "verified-bypass");
    const gate = createDevelopmentCredentialGate("https://verified.example.com");
    await expect(gate.resolveBypassHeaders()).resolves.toEqual({});

    gate.authorize({
      target: await verifiedTarget("verified.example.com"),
      resolveToken: async () => "",
    });

    await expect(gate.resolveToken()).resolves.toBe("");
    await expect(gate.resolveBypassHeaders()).resolves.toEqual({
      "x-vercel-protection-bypass": "verified-bypass",
    });
  });

  it("resolves the current token for every request", async () => {
    const gate = createDevelopmentCredentialGate("https://verified.example.com");
    const resolveToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce(" first-token ")
      .mockResolvedValueOnce("second-token");
    gate.authorize({
      target: await verifiedTarget("verified.example.com"),
      resolveToken,
    });

    await expect(gate.resolveToken()).resolves.toBe("first-token");
    await expect(gate.resolveToken()).resolves.toBe("second-token");
    expect(resolveToken).toHaveBeenCalledTimes(2);
  });
});
