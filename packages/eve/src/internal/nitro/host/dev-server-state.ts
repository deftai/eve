import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "#compiled/zod/index.js";
import { isEveServerHealthy } from "#shared/eve-server-health.js";

// `eve dev` records where the dev server for a project root is listening, under
// `.eve/dev-server.json`, so a later bare `eve dev` in the same root reconnects
// instead of starting a duplicate. The record is a discovery *hint*, not a lock:
// there is no ownership, claim, or mutual exclusion. The OS bind is the only
// arbiter of a port, and an explicit `--port`/`--host`/`PORT` opts out of the
// hint entirely. Writes land via atomic rename so a reader never sees a torn
// file, and a stale record is simply ignored once it stops health-checking.
const STATE_FILE_NAME = "dev-server.json";

const devServerRecordSchema = z
  .object({
    pid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    url: z.string().url().refine(isHttpServerUrl, "Expected an HTTP(S) server URL."),
  })
  .strict();

/**
 * The recorded address of the dev server running for a project root: the URL it
 * listens on and its owning process id. Persisted so a later `eve dev` in the
 * same root can reconnect to it.
 */
export type DevServerRecord = Readonly<z.infer<typeof devServerRecordSchema>>;

/**
 * Returns the recorded dev server for `appRoot` only if it is still live and
 * answering its health route — i.e. one a new `eve dev` can reconnect to. A
 * missing, malformed, dead, or unhealthy record yields `null`. The process
 * liveness check guards against a stale record whose port was reclaimed by an
 * unrelated process.
 */
async function read(appRoot: string): Promise<DevServerRecord | null> {
  const record = await loadDevServerRecord(appRoot);

  if (record === null || !isProcessRunning(record.pid)) {
    return null;
  }

  return (await isEveServerHealthy(record.url)) ? record : null;
}

async function write(appRoot: string, record: DevServerRecord): Promise<void> {
  const stateDir = join(appRoot, ".eve");
  await mkdir(stateDir, { recursive: true });
  const statePath = join(stateDir, STATE_FILE_NAME);
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  const validated = devServerRecordSchema.parse(record);
  await writeFile(temporaryPath, `${JSON.stringify(validated)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

async function clear(appRoot: string, pid: number): Promise<void> {
  try {
    const record = await loadDevServerRecord(appRoot);
    if (record !== null && record.pid === pid) {
      await rm(resolveStatePath(appRoot), { force: true });
    }
  } catch {
    // Intentionally swallowed; see the `clear` doc on `devServerState`.
  }
}

/**
 * The dev server's persisted reconnect record under `.eve/dev-server.json`:
 *
 * - `read(appRoot)` — the recorded server, but only if it is still live and
 *   answering its health route (one a new `eve dev` can reconnect to); a
 *   missing, malformed, dead, or unhealthy record yields `null`. The liveness
 *   check guards against a stale record whose port was reclaimed by an
 *   unrelated process.
 * - `write(appRoot, record)` — records the URL and owning pid of the server now
 *   serving `appRoot`.
 * - `clear(appRoot, pid)` — removes the record, but only if it is still owned by
 *   `pid`, so a shutting-down process never deletes a successor's record.
 *   Best-effort: a failed clear leaves a record the next reconnect health-checks.
 */
export const devServerState = { read, write, clear };

function resolveStatePath(appRoot: string): string {
  return join(appRoot, ".eve", STATE_FILE_NAME);
}

async function loadDevServerRecord(appRoot: string): Promise<DevServerRecord | null> {
  let raw: string;

  try {
    raw = await readFile(resolveStatePath(appRoot), "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = devServerRecordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error, "EPERM");
  }
}

function isHttpServerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isErrnoException(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
