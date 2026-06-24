import { HookNotFoundError } from "#compiled/@workflow/errors/index.js";

import { applyEveWorkflowQueueNamespace } from "#internal/workflow/queue-namespace.js";

interface WorkflowHookRecord {
  readonly runId: string;
}

/** Resumes cancellation only while the owner token still belongs to the expected run. */
export async function resumeOwnedCancellationHook(input: {
  readonly cancellationHookId: string;
  readonly expectedRunId: string;
  readonly ownerHookId: string;
}): Promise<boolean> {
  applyEveWorkflowQueueNamespace();
  const { getHookByToken, resumeHook } = await import("#compiled/@workflow/core/runtime.js");

  try {
    const hook = normalizeWorkflowHook(await getHookByToken(input.ownerHookId));
    if (hook.runId !== input.expectedRunId) return false;
    await resumeHook(input.cancellationHookId, undefined);
    return true;
  } catch (error) {
    if (HookNotFoundError.is(error)) return false;
    throw error;
  }
}

/** Validates the subset of Workflow hook metadata eve consumes. */
export function normalizeWorkflowHook(value: unknown): WorkflowHookRecord {
  if (value === null || typeof value !== "object" || !("runId" in value)) {
    throw new Error("Workflow hook did not include a run id.");
  }

  const runId = (value as { runId?: unknown }).runId;
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("Workflow hook did not include a run id.");
  }

  return { runId };
}
