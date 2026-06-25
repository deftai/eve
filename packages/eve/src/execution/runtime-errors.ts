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

/**
 * Thrown by a {@link Runtime}'s `cancelTurn` when no active turn matches the
 * continuation token.
 */
export class RuntimeNoActiveTurnError extends Error {
  readonly code = "NO_ACTIVE_TURN" as const;
  readonly continuationToken: string;

  constructor(continuationToken: string) {
    super(`No active turn for continuationToken "${continuationToken}".`);
    this.name = "RuntimeNoActiveTurnError";
    this.continuationToken = continuationToken;
  }
}

/** Type guard for {@link RuntimeNoActiveSessionError}. */
export function isRuntimeNoActiveSessionError(
  error: unknown,
): error is RuntimeNoActiveSessionError {
  return error instanceof RuntimeNoActiveSessionError;
}

/** Type guard for {@link RuntimeNoActiveTurnError}. */
export function isRuntimeNoActiveTurnError(error: unknown): error is RuntimeNoActiveTurnError {
  return error instanceof RuntimeNoActiveTurnError;
}
