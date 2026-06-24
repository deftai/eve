/**
 * Pure helpers that project a delegated subagent's terminal output
 * into the runtime-action result shape its parent driver expects.
 * Lives in its own (non-directive) file to escape the workflow
 * step-proxy transform.
 */

import type { RuntimeSubagentResultActionResult } from "#runtime/actions/types.js";
import type { JsonValue } from "#shared/json.js";
import { toErrorMessage } from "#shared/errors.js";
import {
  isSubagentAdapterState,
  SUBAGENT_ADAPTER_KIND,
} from "#execution/subagent-adapter-state.js";
import { readSerializedChannel } from "#execution/workflow-serialized-context.js";

/**
 * Builds the success-shaped {@link RuntimeSubagentResultActionResult}.
 * Returns `undefined` for root sessions (no parent to notify).
 */
export function createDelegatedSubagentSuccessResult(
  serializedContext: Record<string, unknown>,
  output: unknown,
): RuntimeSubagentResultActionResult | undefined {
  const channel = readSerializedChannel(serializedContext);

  if (channel?.kind !== SUBAGENT_ADAPTER_KIND || !isSubagentAdapterState(channel.state)) {
    return undefined;
  }

  return {
    callId: channel.state.callId,
    kind: "subagent-result",
    output: output as JsonValue,
    subagentName: channel.state.subagentName,
  };
}

/** Failure-path mirror of {@link createDelegatedSubagentSuccessResult}. */
export function createDelegatedSubagentErrorResult(
  serializedContext: Record<string, unknown>,
  error: unknown,
): RuntimeSubagentResultActionResult | undefined {
  const success = createDelegatedSubagentSuccessResult(serializedContext, "");

  if (success === undefined) {
    return undefined;
  }

  return {
    ...success,
    isError: true,
    output: {
      code: "SUBAGENT_EXECUTION_FAILED",
      message: toErrorMessage(error),
    },
  };
}

/** Cancellation-path mirror of {@link createDelegatedSubagentSuccessResult}. */
export function createDelegatedSubagentCancellationResult(
  serializedContext: Record<string, unknown>,
): RuntimeSubagentResultActionResult | undefined {
  const success = createDelegatedSubagentSuccessResult(serializedContext, "");

  if (success === undefined) {
    return undefined;
  }

  return {
    ...success,
    isError: true,
    output: {
      code: "SUBAGENT_EXECUTION_CANCELLED",
      message: "Delegated session was cancelled.",
    },
  };
}
