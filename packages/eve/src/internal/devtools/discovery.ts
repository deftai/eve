import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEVTOOLS_DISCOVERY_SCHEMA_VERSION = 1;

interface DiscoveryRuntimeState {
  readonly inspectorUrl?: string;
  readonly runtimeInstanceId: string;
  readonly runtimePid?: number;
  readonly runtimeUrl?: string;
}

export function resolveDevToolsDiscoveryPath(appRoot: string): string {
  return join(appRoot, ".eve", "devtools", "current.json");
}

export function resolveDevToolsRegistryDirectory(homeDirectory = homedir()): string {
  return join(homeDirectory, ".eve", "devtools", "instances");
}

export function resolveDevToolsRegistryPath(
  devtoolsInstanceId: string,
  homeDirectory = homedir(),
): string {
  return join(resolveDevToolsRegistryDirectory(homeDirectory), `${devtoolsInstanceId}.json`);
}

export async function writeDevToolsDiscovery(input: {
  readonly appRoot: string;
  readonly browserCapability: string;
  readonly devtoolsInstanceId: string;
  readonly devtoolsUrl: string;
  readonly runtimeState: DiscoveryRuntimeState;
}): Promise<void> {
  const discoveryPath = resolveDevToolsDiscoveryPath(input.appRoot);
  const discoveryDirectory = join(input.appRoot, ".eve", "devtools");
  const registryPath = resolveDevToolsRegistryPath(input.devtoolsInstanceId);
  const registryDirectory = resolveDevToolsRegistryDirectory();
  const runtime = input.runtimeState;
  const document = {
    appRoot: input.appRoot,
    browserCapability: input.browserCapability,
    devtoolsInstanceId: input.devtoolsInstanceId,
    devtoolsUrl: input.devtoolsUrl,
    inspectorUrl: runtime.inspectorUrl,
    runtimeInstanceId: runtime.runtimeInstanceId,
    runtimePid: runtime.runtimePid,
    runtimeUrl: runtime.runtimeUrl,
    schemaVersion: DEVTOOLS_DISCOVERY_SCHEMA_VERSION,
    supervisorPid: process.pid,
    updatedAt: new Date().toISOString(),
  };
  await Promise.all([
    prepareDiscoveryDirectory(discoveryDirectory),
    prepareDiscoveryDirectory(registryDirectory),
  ]);
  await Promise.all([
    writeDiscoveryFile(discoveryPath, document),
    writeDiscoveryFile(registryPath, document),
  ]);
}

async function prepareDiscoveryDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await chmod(path, 0o700);
}

async function writeDiscoveryFile(path: string, document: unknown): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
