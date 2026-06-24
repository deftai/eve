/**
 * Thrown by a {@link Runtime}'s `deliver` when no in-flight session
 * matches the continuation token. Callers using the resume-or-start
 * pattern (e.g. {@link createSendFn}) treat this as the signal to start
 * a fresh session.
 */
export class RuntimeNoActiveSessionError extends Error {
  readonly code = "NO_ACTIVE_SESSION" as const;
  readonly continuationToken: string;

  constructor(continuationToken: string) {
    super(`No active session for continuationToken "${continuationToken}".`);
    this.name = "RuntimeNoActiveSessionError";
    this.continuationToken = continuationToken;
  }
}

/** Type guard for {@link RuntimeNoActiveSessionError}. */
export function isRuntimeNoActiveSessionError(
  error: unknown,
): error is RuntimeNoActiveSessionError {
  return error instanceof RuntimeNoActiveSessionError;
}

/**
 * Raised when a cancellation capability is stale or belongs to another
 * session. Callers intentionally receive one non-disclosing classification.
 */
export class RuntimeCancellationConflictError extends Error {
  readonly code = "CANCELLATION_CONFLICT" as const;

  constructor() {
    super("Cancellation capability is stale or does not match the session.");
    this.name = "RuntimeCancellationConflictError";
  }
}

/** Type guard for {@link RuntimeCancellationConflictError}. */
export function isRuntimeCancellationConflictError(
  error: unknown,
): error is RuntimeCancellationConflictError {
  return error instanceof RuntimeCancellationConflictError;
}
