import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { devServerState } from "#internal/nitro/host/dev-server-state.js";

const DEAD_PID = 2_147_483_646;

describe("dev-server record", () => {
  let appRoot: string;

  beforeEach(async () => {
    appRoot = await mkdtemp(join(tmpdir(), "eve-dev-server-state-"));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(appRoot, { force: true, recursive: true });
  });

  async function writeRawRecord(value: unknown): Promise<void> {
    await mkdir(join(appRoot, ".eve"), { recursive: true });
    await writeFile(
      join(appRoot, ".eve", "dev-server.json"),
      typeof value === "string" ? value : JSON.stringify(value),
      "utf8",
    );
  }

  async function readRawRecord(): Promise<unknown> {
    return JSON.parse(await readFile(join(appRoot, ".eve", "dev-server.json"), "utf8"));
  }

  it("writes a record and reads it back as the active server when healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    await devServerState.write(appRoot, { pid: process.pid, url: "http://127.0.0.1:2000/" });

    expect(await readRawRecord()).toEqual({ pid: process.pid, url: "http://127.0.0.1:2000/" });
    expect(await devServerState.read(appRoot)).toEqual({
      pid: process.pid,
      url: "http://127.0.0.1:2000/",
    });
  });

  it("treats a record as inactive when its process is gone (no health request)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await writeRawRecord({ pid: DEAD_PID, url: "http://127.0.0.1:2000/" });

    expect(await devServerState.read(appRoot)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a live record as inactive when the server fails its health check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await writeRawRecord({ pid: process.pid, url: "http://127.0.0.1:2000/" });

    expect(await devServerState.read(appRoot)).toBeNull();
  });

  it("returns null for a missing or malformed record", async () => {
    expect(await devServerState.read(appRoot)).toBeNull();

    for (const record of [
      { pid: process.pid, url: "ftp://localhost/x" },
      { pid: -1, url: "http://127.0.0.1:2000/" },
      { pid: process.pid },
      "{ not json",
    ]) {
      await writeRawRecord(record);
      expect(await devServerState.read(appRoot)).toBeNull();
    }
  });

  it("clears only a record owned by the given pid", async () => {
    await devServerState.write(appRoot, { pid: process.pid, url: "http://127.0.0.1:2000/" });

    await devServerState.clear(appRoot, DEAD_PID);
    expect(await readRawRecord()).toEqual({ pid: process.pid, url: "http://127.0.0.1:2000/" });

    await devServerState.clear(appRoot, process.pid);
    await expect(readRawRecord()).rejects.toThrow();
  });

  it("writes a single trailing-newline JSON record", async () => {
    await devServerState.write(appRoot, { pid: process.pid, url: "http://127.0.0.1:2000/" });

    const raw = await readFile(join(appRoot, ".eve", "dev-server.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });
});
