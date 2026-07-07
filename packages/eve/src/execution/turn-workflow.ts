import { createVercelDurabilityPort } from "#execution/durability/backends/vercel-workflow.js";
import { runTurnDriver } from "#execution/durability/turn-driver.js";
import {
  migrateTurnWorkflowInput,
  type TurnWorkflowInput,
} from "#execution/durable-session-migrations/turn-workflow.js";

export type { TurnWorkflowInput };

/** Runs one complete logical turn, including child-agent waits when supported. */
export async function turnWorkflow(rawInput: unknown): Promise<void> {
  "use workflow";

  const input = migrateTurnWorkflowInput(rawInput);
  const port = createVercelDurabilityPort({
    sessionId: input.stepInput.sessionState.sessionId,
  });

  return runTurnDriver({ port, workflowInput: input });
}
