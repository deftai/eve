/** Returns one session driver's deterministic per-turn control token. */
export function createTurnControlToken(sessionId: string, dispatchIndex: number): string {
  return `${sessionId}:turn-control:${String(dispatchIndex)}`;
}

/** Returns the deterministic private inbox token for one turn control token. */
export function createTurnInboxToken(controlToken: string): string {
  return `${controlToken}:inbox`;
}
