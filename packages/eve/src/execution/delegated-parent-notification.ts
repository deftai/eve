/**
 * Bridges a delegated subagent's terminal outcome back to its parent
 * driver via the subagent-result hook. Pure projection helpers live
 * in `delegated-parent-result.ts` so the workflow step-proxy transform
 * doesn't strip them from this file.
 */

import { ChannelKey } from "#runtime/sessions/runtime-context-keys.js";
import { deserializeContext } from "#context/serialize.js";
import type { RuntimeSubagentResultActionResult } from "#runtime/actions/types.js";
import { SUBAGENT_ADAPTER_KIND } from "#execution/subagent-adapter-state.js";
import { applyEveWorkflowQueueNamespace } from "#internal/workflow/queue-namespace.js";

/**
 * Resumes the parent driver's hook with a delegated subagent result.
 * No-op for root sessions.
 */
export async function notifyDelegatedParentStep(input: {
  readonly ignoreMissing?: boolean;
  readonly result: RuntimeSubagentResultActionResult | undefined;
  readonly serializedContext: Record<string, unknown>;
}): Promise<void> {
  "use step";

  if (input.result === undefined) {
    return;
  }

  const ctx = await deserializeContext(input.serializedContext);
  const adapter = ctx.get(ChannelKey);

  if (adapter?.kind !== SUBAGENT_ADAPTER_KIND) {
    return;
  }

  const parentContinuationToken = String(adapter.state?.parentContinuationToken ?? "");
  if (parentContinuationToken === "") {
    return;
  }

  applyEveWorkflowQueueNamespace();
  const [{ resumeHook }, { HookNotFoundError }] = await Promise.all([
    import("#compiled/@workflow/core/runtime.js"),
    import("#compiled/@workflow/errors/index.js"),
  ]);
  try {
    await resumeHook(parentContinuationToken, {
      kind: "runtime-action-result",
      results: [input.result],
    });
  } catch (error) {
    if (input.ignoreMissing === true && HookNotFoundError.is(error)) return;
    throw error;
  }
}
