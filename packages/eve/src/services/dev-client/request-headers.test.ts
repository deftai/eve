import { getVercelOidcToken } from "#compiled/@vercel/oidc/index.js";
import { readVercelProjectLink } from "#internal/vercel/project-link.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveDevelopmentOidcToken,
  resolveLinkedDevelopmentOidcToken,
} from "./request-headers.js";

vi.mock("#compiled/@vercel/oidc/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#compiled/@vercel/oidc/index.js")>()),
  getVercelOidcToken: vi.fn(),
}));

vi.mock("#internal/vercel/project-link.js", () => ({
  readVercelProjectLink: vi.fn(),
}));

const target = { ownerId: "team_expected", projectId: "prj_expected" } as const;

function token(claims: Record<string, string>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

afterEach(() => {
  vi.mocked(getVercelOidcToken).mockReset();
  vi.mocked(readVercelProjectLink).mockReset();
});

describe("resolveDevelopmentOidcToken", () => {
  it("returns a token whose owner and project match the verified target", async () => {
    const expected = token({ owner_id: target.ownerId, project_id: target.projectId });
    vi.mocked(getVercelOidcToken).mockResolvedValue(expected);

    await expect(resolveDevelopmentOidcToken(target)).resolves.toEqual({
      kind: "resolved",
      token: expected,
    });
    expect(getVercelOidcToken).toHaveBeenCalledWith({
      team: target.ownerId,
      project: target.projectId,
    });
  });

  it("forces a refresh for an explicitly selected project", async () => {
    const expected = token({ owner_id: target.ownerId, project_id: target.projectId });
    vi.mocked(getVercelOidcToken).mockResolvedValue(expected);

    await expect(resolveDevelopmentOidcToken({ ...target, forceRefresh: true })).resolves.toEqual({
      kind: "resolved",
      token: expected,
    });
    expect(getVercelOidcToken).toHaveBeenCalledWith({
      team: target.ownerId,
      project: target.projectId,
      expirationBufferMs: Number.MAX_SAFE_INTEGER,
    });
  });

  it("reports a token minted for a different project", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue(
      token({ owner_id: target.ownerId, project_id: "prj_other" }),
    );

    await expect(resolveDevelopmentOidcToken(target)).resolves.toEqual({
      kind: "target-mismatch",
      mismatchedClaims: ["project_id"],
    });
  });

  it("reports claims that do not match the Vercel OIDC schema", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue(token({ subject: "user" }));

    await expect(resolveDevelopmentOidcToken(target)).resolves.toMatchObject({
      kind: "invalid-claims",
      invalidClaims: expect.arrayContaining([
        expect.stringContaining("owner_id"),
        expect.stringContaining("project_id"),
      ]),
    });
  });

  it("reports a token without a JWT payload", async () => {
    vi.mocked(getVercelOidcToken).mockResolvedValue("not-a-jwt");

    await expect(resolveDevelopmentOidcToken(target)).resolves.toEqual({
      kind: "malformed-token",
      reason: "missing-payload",
    });
  });

  it("reports a JWT payload that is not valid JSON", async () => {
    const payload = Buffer.from("not json").toString("base64url");
    vi.mocked(getVercelOidcToken).mockResolvedValue(`header.${payload}.signature`);

    await expect(resolveDevelopmentOidcToken(target)).resolves.toEqual({
      kind: "malformed-token",
      reason: "invalid-json-payload",
    });
  });

  it("reports why token resolution failed", async () => {
    vi.mocked(getVercelOidcToken).mockRejectedValue(new Error("refresh failed"));

    await expect(resolveDevelopmentOidcToken(target)).resolves.toEqual({
      kind: "resolution-failed",
      message: "refresh failed",
    });
  });
});

describe("resolveLinkedDevelopmentOidcToken", () => {
  it("uses the current local project link to resolve the request bearer", async () => {
    vi.mocked(readVercelProjectLink).mockResolvedValue({
      orgId: target.ownerId,
      projectId: target.projectId,
    });
    const expected = token({ owner_id: target.ownerId, project_id: target.projectId });
    vi.mocked(getVercelOidcToken).mockResolvedValue(expected);

    await expect(resolveLinkedDevelopmentOidcToken("/workspace")).resolves.toBe(expected);
    expect(getVercelOidcToken).toHaveBeenCalledWith({
      team: target.ownerId,
      project: target.projectId,
    });
  });

  it("does not send a bearer when the local directory is unlinked", async () => {
    vi.mocked(readVercelProjectLink).mockResolvedValue(undefined);

    await expect(resolveLinkedDevelopmentOidcToken("/workspace")).resolves.toBe("");
    expect(getVercelOidcToken).not.toHaveBeenCalled();
  });
});
