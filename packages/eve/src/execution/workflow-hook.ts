import { HookNotFoundError } from "#compiled/@workflow/errors/index.js";

import { applyEveWorkflowQueueNamespace } from "#internal/workflow/queue-namespace.js";

/** Resumes an active cancellation hook without waiting for teardown. */
export async function resumeCancellationHook(hookId: string): Promise<boolean> {
  applyEveWorkflowQueueNamespace();
  const { resumeHook } = await import("#compiled/@workflow/core/runtime.js");

  try {
    await resumeHook(hookId, undefined);
    return true;
  } catch (error) {
    if (HookNotFoundError.is(error)) return false;
    throw error;
  }
}
