import { isHookNotFoundError } from "#execution/hook-ownership.js";
import { resumeHook } from "#internal/workflow/runtime.js";

/** Activates the turn child whose inbox ownership was committed by the dispatch step. */
export async function activateTurnStep(input: {
  readonly expectedRunId: string;
  readonly inboxToken: string;
}): Promise<void> {
  "use step";

  try {
    await resumeHook(input.inboxToken, {
      expectedRunId: input.expectedRunId,
      kind: "turn-activation",
    });
  } catch (error) {
    // A replay can arrive after the activated child disposed its inbox. The
    // committed owner cannot be replaced here without activating a different run.
    if (isHookNotFoundError(error)) return;
    throw error;
  }
}
