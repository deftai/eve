import type { AuthFn } from "#public/channels/auth.js";
import type { EveChannelInput } from "#public/channels/eve.js";
import type { SessionAuthContext } from "#channel/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readVercelProjectLink: vi.fn(),
  vercelOidc: vi.fn(),
}));

let capturedAuth: EveChannelInput["auth"] | undefined;

vi.mock("#internal/vercel/project-link.js", () => ({
  readVercelProjectLink: mocks.readVercelProjectLink,
}));

vi.mock("#public/channels/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#public/channels/auth.js")>()),
  vercelOidc: mocks.vercelOidc,
}));

vi.mock("#public/channels/eve.js", () => ({
  eveChannel(input: EveChannelInput) {
    capturedAuth = input.auth;
    return { adapter: {}, routes: [] };
  },
}));

import { getFrameworkChannelDefinitions } from "./index.js";

const USER_AUTH: SessionAuthContext = {
  attributes: {},
  authenticator: "oidc",
  issuer: "https://oidc.vercel.com/acme",
  principalId: "https://oidc.vercel.com/acme:user_ada",
  principalType: "user",
  subject: "user_ada",
};

const RUNTIME_AUTH: SessionAuthContext = {
  attributes: {},
  authenticator: "oidc",
  principalId: "https://oidc.vercel.com/acme:runtime",
  principalType: "runtime",
};

function frameworkAuth(appRoot: string): readonly AuthFn<Request>[] {
  capturedAuth = undefined;
  getFrameworkChannelDefinitions({ appRoot });

  if (!Array.isArray(capturedAuth)) throw new Error("Expected ordered framework route auth.");
  return capturedAuth;
}

afterEach(() => {
  capturedAuth = undefined;
  mocks.readVercelProjectLink.mockReset();
  mocks.vercelOidc.mockReset();
  vi.unstubAllEnvs();
});

describe("framework eve channel auth", () => {
  it("uses a linked development project to prefer verified Vercel user auth", async () => {
    vi.stubEnv("VERCEL_TARGET_ENV", "");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.readVercelProjectLink.mockResolvedValue({
      orgId: "team_acme",
      projectId: "prj_current",
    });
    mocks.vercelOidc.mockImplementation(
      (options?: { readonly currentVercelProject?: unknown }) => async () =>
        options?.currentVercelProject === undefined ? null : USER_AUTH,
    );

    const [vercelAuth] = frameworkAuth("/workspace");
    if (vercelAuth === undefined)
      throw new Error("Expected Vercel auth before the local fallback.");

    await expect(
      vercelAuth(
        new Request("http://localhost/eve/v1/session", {
          headers: { authorization: "Bearer signed-vercel-oidc-token" },
        }),
      ),
    ).resolves.toEqual(USER_AUTH);

    expect(mocks.readVercelProjectLink).toHaveBeenCalledWith("/workspace");
    expect(mocks.vercelOidc).toHaveBeenCalledWith({
      currentVercelProject: {
        environment: "development",
        projectId: "prj_current",
      },
    });
  });

  it("keeps an unlinked local request on the local-dev fallback", async () => {
    vi.stubEnv("VERCEL_TARGET_ENV", "");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.readVercelProjectLink.mockResolvedValue(undefined);
    mocks.vercelOidc.mockImplementation(() => async () => null);

    const [vercelAuth, localAuth] = frameworkAuth("/workspace");
    if (vercelAuth === undefined || localAuth === undefined) {
      throw new Error("Expected Vercel auth followed by the local fallback.");
    }

    const request = new Request("http://localhost/eve/v1/session");
    await expect(vercelAuth(request)).resolves.toBeNull();
    expect(localAuth(request)).toMatchObject({
      principalId: "local-dev",
      principalType: "local-dev",
    });
  });

  it("does not let a non-user Vercel principal shadow the local fallback", async () => {
    vi.stubEnv("VERCEL_TARGET_ENV", "");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.readVercelProjectLink.mockResolvedValue({
      orgId: "team_acme",
      projectId: "prj_current",
    });
    mocks.vercelOidc.mockImplementation(
      (options?: { readonly currentVercelProject?: unknown }) => async () =>
        options?.currentVercelProject === undefined ? null : RUNTIME_AUTH,
    );

    const [vercelAuth, localAuth] = frameworkAuth("/workspace");
    if (vercelAuth === undefined || localAuth === undefined) {
      throw new Error("Expected Vercel auth followed by the local fallback.");
    }

    const request = new Request("http://localhost/eve/v1/session", {
      headers: { authorization: "Bearer signed-vercel-oidc-token" },
    });
    await expect(vercelAuth(request)).resolves.toBeNull();
    expect(localAuth(request)).toMatchObject({ principalType: "local-dev" });
  });

  it("does not bind a public non-Vercel request to the local project link", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.vercelOidc.mockImplementation(
      (options?: { readonly currentVercelProject?: unknown }) => async () =>
        options?.currentVercelProject === undefined ? RUNTIME_AUTH : USER_AUTH,
    );

    const [vercelAuth] = frameworkAuth("/workspace");
    if (vercelAuth === undefined)
      throw new Error("Expected Vercel auth before the local fallback.");

    await expect(
      vercelAuth(
        new Request("https://public.example/eve/v1/session", {
          headers: { authorization: "Bearer signed-vercel-oidc-token" },
        }),
      ),
    ).resolves.toEqual(RUNTIME_AUTH);

    expect(mocks.readVercelProjectLink).not.toHaveBeenCalled();
  });

  it("keeps deployed runtimes on their environment-backed Vercel OIDC policy", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    mocks.vercelOidc.mockImplementation(() => async () => USER_AUTH);

    const [vercelAuth] = frameworkAuth("/workspace");
    if (vercelAuth === undefined)
      throw new Error("Expected Vercel auth before the local fallback.");

    await expect(
      vercelAuth(
        new Request("http://localhost/eve/v1/session", {
          headers: { authorization: "Bearer signed-vercel-oidc-token" },
        }),
      ),
    ).resolves.toEqual(USER_AUTH);

    expect(mocks.readVercelProjectLink).not.toHaveBeenCalled();
  });
});
