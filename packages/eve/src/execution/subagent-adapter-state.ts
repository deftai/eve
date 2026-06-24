import { isNonEmptyString, isObject } from "#shared/guards.js";

/** Durable adapter kind used for delegated subagent child runs. */
export const SUBAGENT_ADAPTER_KIND = "subagent";

/** Durable state carried on a delegated subagent adapter. */
export interface SubagentAdapterState extends Record<string, unknown> {
  readonly callId: string;
  readonly parentContinuationToken: string;
  readonly parentSessionId: string;
  readonly subagentName: string;
}

/** Validates adapter state after its workflow serialization round trip. */
export function isSubagentAdapterState(value: unknown): value is SubagentAdapterState {
  return (
    isObject(value) &&
    isNonEmptyString(value.callId) &&
    isNonEmptyString(value.parentContinuationToken) &&
    typeof value.parentSessionId === "string" &&
    isNonEmptyString(value.subagentName)
  );
}
