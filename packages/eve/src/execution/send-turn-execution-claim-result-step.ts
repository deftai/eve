import { resumeHook } from "#internal/workflow/runtime.js";

/** Tells one turn child whether it owns execution for its parent turn. */
export async function sendTurnExecutionClaimResultStep(input: {
  readonly accepted: boolean;
  readonly claimId: string;
  readonly inboxToken: string;
}): Promise<void> {
  "use step";

  await resumeHook(input.inboxToken, {
    accepted: input.accepted,
    claimId: input.claimId,
    kind: "turn-execution-claim-result",
  });
}
