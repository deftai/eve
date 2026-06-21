import { createDevToolsClient, DevToolsApiError, type DevToolsClient } from "./devtools-client.js";
import type { DevToolsDiscoveryOptions } from "./discovery.js";
import { discoverDevToolsInstances } from "./discovery.js";
import { inspectSession, type SessionInspection } from "./inspect-session.js";
import type { DevToolsDiscovery, DevToolsRun } from "./types.js";

export interface DevToolsInstance {
  readonly client: DevToolsClient;
  readonly discovery: DevToolsDiscovery;
}

export type ResolveDevToolsInstances = () => Promise<readonly DevToolsInstance[]>;

/** Creates a session on the selected active app, or the sole app when only one is running. */
export async function createSessionAcrossInstances(
  instances: readonly DevToolsInstance[],
  message: string,
  appRoot?: string,
): Promise<RegisteredRun> {
  const instance = selectInstance(instances, appRoot);
  return registeredRun(instance.discovery, await instance.client.createRun(message));
}

/** Continues a session after resolving its owning app from the session ID. */
export async function continueSessionAcrossInstances(
  instances: readonly DevToolsInstance[],
  sessionId: string,
  message: string,
): Promise<RegisteredRun> {
  const instance = await findSessionInstance(instances, sessionId);
  return registeredRun(instance.discovery, await instance.client.continueRun(sessionId, message));
}

/** Creates a resolver that refreshes the active per-user registry for every MCP tool call. */
export function createDevToolsInstanceResolver(
  options: DevToolsDiscoveryOptions = {},
): ResolveDevToolsInstances {
  return async () =>
    (await discoverDevToolsInstances(options)).map((discovery) => ({
      client: createDevToolsClient(discovery),
      discovery,
    }));
}

/** Lists sessions across every active local Eve DevTools host. */
export async function listSessionsAcrossInstances(
  instances: readonly DevToolsInstance[],
): Promise<readonly RegisteredRun[]> {
  const runs = await Promise.all(
    instances.map(async (instance) =>
      (await instance.client.listRuns()).map((run) => registeredRun(instance.discovery, run)),
    ),
  );
  return runs.flat().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** Finds a session across active hosts and returns its runtime evidence and owning app. */
export async function inspectSessionAcrossInstances(
  instances: readonly DevToolsInstance[],
  sessionId: string,
): Promise<RegisteredInspection> {
  const instance = await findSessionInstance(instances, sessionId);
  return {
    devtools: instanceMetadata(instance.discovery),
    ...(await inspectSession(instance.client, sessionId)),
  };
}

async function findSessionInstance(
  instances: readonly DevToolsInstance[],
  sessionId: string,
): Promise<DevToolsInstance> {
  const matches: DevToolsInstance[] = [];
  for (const instance of instances) {
    try {
      await instance.client.getRun(sessionId);
      matches.push(instance);
    } catch (error) {
      if (error instanceof DevToolsApiError && error.status === 404) continue;
      throw error;
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `Session ${sessionId} was not found in any active Eve DevTools instance. Active app roots: ${instances.map((instance) => instance.discovery.appRoot).join(", ") || "none"}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Session ${sessionId} exists in multiple Eve DevTools instances: ${matches.map((instance) => instance.discovery.appRoot).join(", ")}.`,
    );
  }
  return matches[0]!;
}

interface RegisteredRun extends DevToolsRun {
  readonly appRoot: string;
  readonly devtoolsInstanceId: string;
}

interface RegisteredInspection extends SessionInspection {
  readonly devtools: ReturnType<typeof instanceMetadata>;
}

function registeredRun(discovery: DevToolsDiscovery, run: DevToolsRun): RegisteredRun {
  return {
    ...run,
    appRoot: discovery.appRoot,
    devtoolsInstanceId: discovery.devtoolsInstanceId,
  };
}

function selectInstance(
  instances: readonly DevToolsInstance[],
  appRoot: string | undefined,
): DevToolsInstance {
  if (appRoot !== undefined) {
    const instance = instances.find((candidate) => candidate.discovery.appRoot === appRoot);
    if (instance !== undefined) return instance;
    throw new Error(`No active Eve DevTools instance was found for app root ${appRoot}.`);
  }
  if (instances.length === 1) return instances[0]!;
  if (instances.length === 0) throw new Error("No active Eve DevTools instances were found.");
  throw new Error(
    `Multiple Eve DevTools instances are active. Pass appRoot: ${instances.map((instance) => instance.discovery.appRoot).join(", ")}.`,
  );
}

function instanceMetadata(discovery: DevToolsDiscovery) {
  return {
    appRoot: discovery.appRoot,
    devtoolsInstanceId: discovery.devtoolsInstanceId,
    supervisorPid: discovery.supervisorPid,
  };
}
