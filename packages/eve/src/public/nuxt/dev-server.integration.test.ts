import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

import {
  EVE_BASE_URL_ENV,
  resolveProductionEveServer,
  resolveSharedEveDevServer,
} from "./dev-server.js";

async function createTempAppRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "eve-nuxt-dev-server-"));
}

async function writeRegistry(appRoot: string, registry: Record<string, unknown>): Promise<void> {
  await mkdir(join(appRoot, ".eve"), { recursive: true });
  await writeFile(
    join(appRoot, ".eve", "nuxt-dev-server.json"),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
}

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed: boolean;
  kill(): void;
  pid: number;
}

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.pid = 12345;
  child.kill = () => {
    child.killed = true;
    child.emit("exit", null, "SIGTERM");
  };
  return child;
}

afterEach(async () => {
  spawnMock.mockReset();
  existsSyncMock.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete process.env[EVE_BASE_URL_ENV];
});

describe("resolveSharedEveDevServer", () => {
  it("reuses a healthy registered server instead of spawning", async () => {
    const appRoot = await createTempAppRoot();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await writeRegistry(appRoot, {
      appRoot,
      origin: "http://127.0.0.1:49152",
      pid: null,
      updatedAt: new Date().toISOString(),
    });

    const handle = await resolveSharedEveDevServer(appRoot);

    expect(handle).toEqual({ origin: "http://127.0.0.1:49152" });
    expect(handle.process).toBeUndefined();
    expect(process.env[EVE_BASE_URL_ENV]).toBe("http://127.0.0.1:49152");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:49152/eve/v1/health", {
      signal: expect.any(AbortSignal),
    });
  });

  it("ignores non-server URLs in dev server output while waiting for the listening URL", async () => {
    const appRoot = await createTempAppRoot();
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);

    const handlePromise = resolveSharedEveDevServer(appRoot);

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
    child.stdout.emit(
      "data",
      Buffer.from('dependency metadata: "homepage": "https://rolldown.rs/"\n'),
    );
    child.stdout.emit("data", Buffer.from("docs: open http://localhost for details\n"));
    child.stderr.emit("data", Buffer.from("dev server listening at http://127.0.0.1:33449\n"));

    await expect(handlePromise).resolves.toEqual({
      origin: "http://127.0.0.1:33449",
      process: child,
    });
    await expect(readRegisteredOrigin(appRoot)).resolves.toBe("http://127.0.0.1:33449");
  });
});

describe("resolveProductionEveServer", () => {
  it("auto-starts the built eve server for local preview when output exists", async () => {
    const appRoot = await createTempAppRoot();
    const child = createMockChildProcess();
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockReturnValue(child);

    const originPromise = resolveProductionEveServer({
      appRoot,
      localServerOrigin: "http://127.0.0.1:4274",
    });

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
    child.stderr.emit("data", Buffer.from("Listening on http://127.0.0.1:4274\n"));

    await expect(originPromise).resolves.toBe("http://127.0.0.1:4274");
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      [join(appRoot, ".output", "server", "index.mjs")],
      expect.objectContaining({
        cwd: appRoot,
        env: expect.objectContaining({
          HOST: "127.0.0.1",
          PORT: "4274",
        }),
      }),
    );
  });

  it("falls back to the configured local origin when the build output is missing", async () => {
    const appRoot = await createTempAppRoot();
    existsSyncMock.mockReturnValue(false);

    await expect(
      resolveProductionEveServer({
        appRoot,
        localServerOrigin: "http://127.0.0.1:4274",
      }),
    ).resolves.toBe("http://127.0.0.1:4274");
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

async function readRegisteredOrigin(appRoot: string): Promise<string> {
  const registry = JSON.parse(
    await readFile(join(appRoot, ".eve", "nuxt-dev-server.json"), "utf8"),
  ) as { readonly origin?: unknown };
  if (typeof registry.origin !== "string") {
    throw new Error("eve dev server registry did not record a string origin.");
  }
  return registry.origin;
}
