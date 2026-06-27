import * as workflowRuntime from "#compiled/@workflow/core/runtime.js";
import type { CryptoKey } from "#compiled/@workflow/core/encryption.js";
import type {
  Hook,
  ValidQueueName,
  WorkflowRunWithoutData,
} from "#compiled/@workflow/world/index.js";
import { createLogger, logError } from "#internal/logging.js";
import {
  LEGACY_EVE_WORKFLOW_QUEUE_NAMESPACE,
  WORKFLOW_QUEUE_NAMESPACE_ENV,
} from "#internal/workflow/queue-namespace.js";

// Workflow turbo backgrounds run_started and forces optimistic inline start.
// Keep eve on the fully ordered runtime path until that beta behavior is safe.
process.env.WORKFLOW_TURBO = "0";

export * from "#compiled/@workflow/core/runtime.js";
export type {
  StartOptionsWithoutDeploymentId,
  WorkflowFunction,
  WorkflowMetadata,
} from "#compiled/@workflow/core/runtime/start.js";

const log = createLogger("workflow.runtime");
const VERCEL_DEPLOYMENT_ID_ENV = "VERCEL_DEPLOYMENT_ID";
const QUEUE_NAMESPACE_PROBE_TIMEOUT_MS = 1_000;
const namespaceHealthCache = new Map<string, Promise<boolean>>();

/** Installs a World across source and vendored Workflow package identities. */
export function setWorld(world: unknown): void {
  workflowRuntime.setWorld(world as Parameters<typeof workflowRuntime.setWorld>[0]);
}

/**
 * Resumes a Workflow hook and wakes legacy eve deployments whose workflow
 * handlers still subscribe to the pre-agent-scoped queue namespace.
 */
export async function resumeHook<T = any>(
  tokenOrHook: string | Hook,
  payload: T,
  encryptionKeyOverride?: CryptoKey,
): Promise<Hook> {
  const hook =
    encryptionKeyOverride === undefined
      ? await workflowRuntime.resumeHook(tokenOrHook, payload)
      : await workflowRuntime.resumeHook(tokenOrHook, payload, encryptionKeyOverride);

  try {
    await enqueueLegacyWorkflowResumeIfNeeded(hook);
  } catch (error) {
    logError(log, "failed to enqueue legacy workflow resume", error, {
      hookId: hook.hookId,
      runId: hook.runId,
    });
  }

  return hook;
}

async function enqueueLegacyWorkflowResumeIfNeeded(hook: Hook): Promise<void> {
  const currentNamespace = currentWorkflowQueueNamespace();
  if (currentNamespace === undefined || currentNamespace === LEGACY_EVE_WORKFLOW_QUEUE_NAMESPACE) {
    return;
  }

  const currentDeploymentId = currentVercelDeploymentId();
  if (currentDeploymentId === undefined) return;

  const world = await workflowRuntime.getWorld();
  const run = await world.runs.get(hook.runId, { resolveData: "none" });
  if (run.deploymentId === currentDeploymentId) return;

  const currentNamespaceIsReachable = await isWorkflowNamespaceReachable({
    deploymentId: run.deploymentId,
    namespace: currentNamespace,
  });
  if (currentNamespaceIsReachable) return;

  await world.queue(
    workflowQueueName(run.workflowName, LEGACY_EVE_WORKFLOW_QUEUE_NAMESPACE),
    {
      runId: run.runId,
      traceCarrier: readTraceCarrier(run),
    },
    {
      deploymentId: run.deploymentId,
      specVersion: run.specVersion ?? 1,
    },
  );
}

async function isWorkflowNamespaceReachable(input: {
  readonly deploymentId: string;
  readonly namespace: string;
}): Promise<boolean> {
  const cacheKey = `${input.deploymentId}\0${input.namespace}`;
  let cached = namespaceHealthCache.get(cacheKey);
  if (cached === undefined) {
    cached = probeWorkflowNamespace(input);
    namespaceHealthCache.set(cacheKey, cached);
  }
  return cached;
}

async function probeWorkflowNamespace(input: {
  readonly deploymentId: string;
  readonly namespace: string;
}): Promise<boolean> {
  try {
    const world = await workflowRuntime.getWorld();
    const result = await workflowRuntime.healthCheck(world, "workflow", {
      deploymentId: input.deploymentId,
      namespace: input.namespace,
      timeout: QUEUE_NAMESPACE_PROBE_TIMEOUT_MS,
    });
    return result.healthy;
  } catch {
    return false;
  }
}

function currentWorkflowQueueNamespace(): string | undefined {
  const value = process.env[WORKFLOW_QUEUE_NAMESPACE_ENV]?.trim();
  return value ? value : undefined;
}

function currentVercelDeploymentId(): string | undefined {
  const value = process.env[VERCEL_DEPLOYMENT_ID_ENV]?.trim();
  return value ? value : undefined;
}

function readTraceCarrier(run: WorkflowRunWithoutData): Record<string, string> | undefined {
  const traceCarrier = run.executionContext?.["traceCarrier"];
  if (traceCarrier === undefined || traceCarrier === null || typeof traceCarrier !== "object") {
    return undefined;
  }
  return traceCarrier as Record<string, string>;
}

function workflowQueueName(workflowName: string, namespace: string): ValidQueueName {
  return `__${namespace}_wkf_workflow_${workflowName}` as ValidQueueName;
}
