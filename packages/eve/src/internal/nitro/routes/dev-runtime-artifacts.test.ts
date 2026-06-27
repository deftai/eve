import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rebuildDevelopmentRuntimeArtifacts: vi.fn(),
  readDevelopmentRuntimeArtifactsRevision: vi.fn(),
}));

vi.mock("#internal/nitro/dev-runtime-artifacts.js", async () => {
  const actual = await vi.importActual<typeof import("#internal/nitro/dev-runtime-artifacts.js")>(
    "#internal/nitro/dev-runtime-artifacts.js",
  );
  return {
    ...actual,
    readDevelopmentRuntimeArtifactsRevision: mocks.readDevelopmentRuntimeArtifactsRevision,
  };
});

vi.mock("#internal/nitro/host/dev-runtime-rebuild.js", () => ({
  rebuildDevelopmentRuntimeArtifacts: mocks.rebuildDevelopmentRuntimeArtifacts,
}));

beforeEach(() => {
  mocks.rebuildDevelopmentRuntimeArtifacts.mockReset();
  mocks.readDevelopmentRuntimeArtifactsRevision.mockReset();
});

describe("handleDevRuntimeArtifactsRebuildRequest", () => {
  it("rebuilds authored runtime artifacts before returning the new revision", async () => {
    const { handleDevRuntimeArtifactsRebuildRequest } =
      await import("#internal/nitro/routes/dev-runtime-artifacts.js");
    mocks.rebuildDevelopmentRuntimeArtifacts.mockResolvedValueOnce(true);
    mocks.readDevelopmentRuntimeArtifactsRevision.mockReturnValueOnce({
      revision: "/tmp/app/.eve/dev-runtime/snapshots/next",
    });

    const response = await handleDevRuntimeArtifactsRebuildRequest({ appRoot: "/tmp/app" });

    expect(mocks.rebuildDevelopmentRuntimeArtifacts).toHaveBeenCalledWith("/tmp/app");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revision: "/tmp/app/.eve/dev-runtime/snapshots/next",
    });
  });
});

describe("handleDevRuntimeArtifactsRequest", () => {
  it("returns the current dev runtime artifact revision", async () => {
    const { handleDevRuntimeArtifactsRequest } =
      await import("#internal/nitro/routes/dev-runtime-artifacts.js");
    mocks.readDevelopmentRuntimeArtifactsRevision.mockReturnValueOnce({
      revision: "/tmp/app/.eve/dev-runtime/snapshots/current",
    });

    const response = handleDevRuntimeArtifactsRequest({ appRoot: "/tmp/app" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      revision: "/tmp/app/.eve/dev-runtime/snapshots/current",
    });
    expect(mocks.readDevelopmentRuntimeArtifactsRevision).toHaveBeenCalledWith("/tmp/app");
  });
});
