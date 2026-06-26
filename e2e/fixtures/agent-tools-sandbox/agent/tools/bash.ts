import { defineTool, defineBashTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";

const bash = defineBashTool();

const BASH_OUTPUT_SCHEMA = z.object({
  exitCode: z.number().int(),
  stderr: z.string(),
  stdout: z.string(),
  truncated: z.boolean(),
});

const BASH_LATENCY_OUTPUT_SCHEMA = BASH_OUTPUT_SCHEMA.extend({
  executionCompletedAt: z.number().int(),
  executionStartedAt: z.number().int(),
});

/**
 * Bash tool exposed to the model for the sandbox-bootstrap smoke
 * test. `needsApproval: never()` keeps the smoke test single-turn
 * and avoids tripping the HITL machinery already exercised by
 * `tool-approval.ts` / `tool-denial.ts`.
 *
 * Wrapping the framework's `defineBashTool()` in `defineTool({...})`
 * gives the inferred default a named return type so tsc does not
 * trip the TS2883 "inferred type cannot be named" portability
 * check.
 */
export default defineTool({
  ...bash,
  needsApproval: never(),
  outputSchema: BASH_LATENCY_OUTPUT_SCHEMA,
  async execute(input, ctx) {
    const executionStartedAt = Date.now();
    const result = BASH_OUTPUT_SCHEMA.parse(await bash.execute(input, ctx));
    return {
      ...result,
      executionCompletedAt: Date.now(),
      executionStartedAt,
    };
  },
});
