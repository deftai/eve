import { applyEveWorkflowQueueNamespace } from "#internal/workflow/queue-namespace.js";

/** Makes one best-effort cancellation attempt against the current turn. */
export async function cancelTurnSegmentStep(input: { readonly hookId: string }): Promise<void> {
  "use step";

  const [{ resumeHook }, { HookNotFoundError }] = await Promise.all([
    import("#compiled/@workflow/core/runtime.js"),
    import("#compiled/@workflow/errors/index.js"),
  ]);
  applyEveWorkflowQueueNamespace();

  try {
    await resumeHook(input.hookId, undefined);
  } catch (error) {
    if (HookNotFoundError.is(error)) return;
    throw error;
  }
}
