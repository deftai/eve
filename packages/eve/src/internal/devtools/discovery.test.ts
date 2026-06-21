import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chmod: vi.fn(),
  mkdir: vi.fn(),
  randomUUID: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:crypto", () => ({ randomUUID: mocks.randomUUID }));
vi.mock("node:fs/promises", () => ({
  chmod: mocks.chmod,
  mkdir: mocks.mkdir,
  rename: mocks.rename,
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));
vi.mock("node:os", () => ({ homedir: () => "/home/eve-user" }));

describe("DevTools discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.randomUUID.mockReturnValueOnce("local-write").mockReturnValueOnce("registry-write");
  });

  it("resolves one registry file per DevTools host", async () => {
    const { resolveDevToolsRegistryDirectory, resolveDevToolsRegistryPath } =
      await import("./discovery.js");

    expect(resolveDevToolsRegistryDirectory()).toBe("/home/eve-user/.eve/devtools/instances");
    expect(resolveDevToolsRegistryPath("host-1")).toBe(
      "/home/eve-user/.eve/devtools/instances/host-1.json",
    );
  });

  it("writes matching app-local and user-registry discovery records", async () => {
    const { writeDevToolsDiscovery } = await import("./discovery.js");

    await writeDevToolsDiscovery({
      appRoot: "/workspace/weather",
      browserCapability: "secret",
      devtoolsInstanceId: "host-1",
      devtoolsUrl: "http://127.0.0.1:43123/#token=secret",
      runtimeState: {
        runtimeInstanceId: "runtime-1",
        runtimePid: 123,
        runtimeUrl: "http://127.0.0.1:3000/",
      },
    });

    expect(mocks.mkdir).toHaveBeenCalledWith("/workspace/weather/.eve/devtools", {
      mode: 0o700,
      recursive: true,
    });
    expect(mocks.mkdir).toHaveBeenCalledWith("/home/eve-user/.eve/devtools/instances", {
      mode: 0o700,
      recursive: true,
    });
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    const documents = mocks.writeFile.mock.calls.map(([_, contents]) =>
      JSON.parse(contents as string),
    );
    expect(documents).toEqual([
      expect.objectContaining({
        appRoot: "/workspace/weather",
        browserCapability: "secret",
        devtoolsInstanceId: "host-1",
        runtimeInstanceId: "runtime-1",
        supervisorPid: process.pid,
      }),
      expect.objectContaining({
        appRoot: "/workspace/weather",
        browserCapability: "secret",
        devtoolsInstanceId: "host-1",
        runtimeInstanceId: "runtime-1",
        supervisorPid: process.pid,
      }),
    ]);
    expect(mocks.rename).toHaveBeenCalledWith(
      "/workspace/weather/.eve/devtools/current.json.local-write.tmp",
      "/workspace/weather/.eve/devtools/current.json",
    );
    expect(mocks.rename).toHaveBeenCalledWith(
      "/home/eve-user/.eve/devtools/instances/host-1.json.registry-write.tmp",
      "/home/eve-user/.eve/devtools/instances/host-1.json",
    );
  });
});
