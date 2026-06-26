import type { ToolSet, TypedToolError, TypedToolResult } from "ai";

import { createActionResultEvent, type ActionResultStreamEvent } from "#protocol/message.js";
import {
  createRuntimeToolResultFromStepResult,
  createRuntimeToolResultFromValue,
} from "#harness/action-result-helpers.js";
import type { HarnessEmissionState } from "#harness/emission.js";
import { toError } from "#shared/errors.js";

type StreamActionResultState = Pick<HarnessEmissionState, "sequence" | "stepIndex" | "turnId">;

/** Projects one terminal AI SDK tool result into eve's action-result protocol event. */
export function createStreamToolResultEvent(input: {
  readonly state: StreamActionResultState;
  readonly toolResult: TypedToolResult<ToolSet>;
}): ActionResultStreamEvent {
  return createActionResultEvent({
    result: createRuntimeToolResultFromStepResult(input.toolResult),
    sequence: input.state.sequence,
    stepIndex: input.state.stepIndex,
    turnId: input.state.turnId,
  });
}

/** Projects one terminal AI SDK tool error into eve's failed action-result protocol event. */
export function createStreamToolErrorEvent(input: {
  readonly state: StreamActionResultState;
  readonly toolError: TypedToolError<ToolSet>;
}): ActionResultStreamEvent {
  return createActionResultEvent({
    result: createRuntimeToolResultFromValue({
      callId: input.toolError.toolCallId,
      isError: true,
      output: toError(input.toolError.error),
      toolName: input.toolError.toolName,
    }),
    sequence: input.state.sequence,
    stepIndex: input.state.stepIndex,
    turnId: input.state.turnId,
  });
}
