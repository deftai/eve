import type { CancellationScope } from "#channel/types.js";

const CANCELLATION_REASON_KIND = "eve-cancellation";

/** Serializable reason carried by Workflow's durable AbortController. */
export interface EveCancellationReason {
  readonly kind: typeof CANCELLATION_REASON_KIND;
  readonly message: string;
  readonly name: "AbortError";
  readonly scope: CancellationScope;
}

export function createCancellationReason(scope: CancellationScope): EveCancellationReason {
  return {
    kind: CANCELLATION_REASON_KIND,
    message: `The eve ${scope} was cancelled.`,
    name: "AbortError",
    scope,
  };
}

export function readCancellationScope(value: unknown): CancellationScope | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const reason = value as Partial<EveCancellationReason>;
  if (reason.kind !== CANCELLATION_REASON_KIND) return undefined;
  return reason.scope === "turn" || reason.scope === "session" ? reason.scope : undefined;
}

/** Addresses the cancellation hook owned by one dispatched child turn workflow. */
export function createTurnWorkflowCancellationHookId(completionToken: string): string {
  return `${completionToken}:cancel`;
}

/** Addresses the session-lifetime hook, including while the entry workflow is parked. */
export function createSessionCancellationHookId(sessionId: string): string {
  return `${sessionId}:cancel-session`;
}

/** Addresses the current-turn hook; signals received while parked are accepted no-ops. */
export function createActiveTurnCancellationHookId(sessionId: string): string {
  return `${sessionId}:cancel-turn`;
}
