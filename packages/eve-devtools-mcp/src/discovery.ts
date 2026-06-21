import { readFile, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { DevToolsDiscovery } from "./types.js";

const DISCOVERY_RELATIVE_PATH = join(".eve", "devtools", "current.json");
const HEALTH_TIMEOUT_MS = 1_000;

export interface DevToolsDiscoveryOptions {
  readonly appRoot?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly registryDirectory?: string;
}

/** Returns the default per-user registry populated by running `eve dev` supervisors. */
export function resolveDevToolsRegistryDirectory(homeDirectory = homedir()): string {
  return join(homeDirectory, ".eve", "devtools", "instances");
}

/** Discovers and health-checks all active local Eve DevTools hosts. */
export async function discoverDevToolsInstances(
  options: DevToolsDiscoveryOptions = {},
): Promise<readonly DevToolsDiscovery[]> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  if (options.appRoot !== undefined) {
    const path = join(resolve(options.appRoot), DISCOVERY_RELATIVE_PATH);
    const discovery = await readDiscovery(path);
    if (!(await isHealthy(discovery, fetchImplementation))) {
      throw new Error(`The Eve DevTools server discovered at ${path} is not responding.`);
    }
    return [discovery];
  }

  const registryDirectory = options.registryDirectory ?? resolveDevToolsRegistryDirectory();
  let names: readonly string[];
  try {
    names = (await readdir(registryDirectory)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const discoveries = await Promise.all(
    names.map(async (name) => {
      const path = join(registryDirectory, name);
      try {
        const discovery = await readDiscovery(path);
        if (await isHealthy(discovery, fetchImplementation)) return discovery;
      } catch {
        // Invalid and unreachable entries are stale process artifacts.
      }
      await rm(path, { force: true }).catch(() => {});
      return undefined;
    }),
  );
  return discoveries
    .filter((value): value is DevToolsDiscovery => value !== undefined)
    .sort((left, right) => left.appRoot.localeCompare(right.appRoot));
}

async function readDiscovery(path: string): Promise<DevToolsDiscovery> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(`No active Eve DevTools server was discovered at ${path}.`);
    }
    throw error;
  }
  if (!isRecord(value) || !isDiscovery(value)) {
    throw new Error(`Invalid Eve DevTools discovery document at ${path}.`);
  }
  return {
    appRoot: value.appRoot,
    browserCapability: value.browserCapability,
    devtoolsInstanceId:
      stringValue(value.devtoolsInstanceId) ??
      stringValue(value.runtimeInstanceId) ??
      value.appRoot,
    devtoolsUrl: value.devtoolsUrl,
    schemaVersion: value.schemaVersion,
    supervisorPid: numberValue(value.supervisorPid),
    updatedAt: stringValue(value.updatedAt),
  };
}

async function isHealthy(
  discovery: DevToolsDiscovery,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImplementation(new URL("/api/v1/health", discovery.devtoolsUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isDiscovery(value: Record<string, unknown>): value is Record<string, unknown> & {
  readonly appRoot: string;
  readonly browserCapability: string;
  readonly devtoolsUrl: string;
  readonly schemaVersion: number;
} {
  return (
    typeof value.appRoot === "string" &&
    typeof value.browserCapability === "string" &&
    typeof value.devtoolsUrl === "string" &&
    value.schemaVersion === 1
  );
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
