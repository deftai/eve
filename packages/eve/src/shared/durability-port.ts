import type { HandleMessageStreamEvent } from "#protocol/message.js";

/**
 * Payload delivered through a durability inbox (eve hook equivalent).
 */
export type DurabilityInboxPayload = unknown;

/**
 * Async inbox with exclusive ownership semantics aligned with
 * {@link import("#execution/hook-ownership.js").claimHookOwnership}.
 */
export interface DurabilityInbox<T = DurabilityInboxPayload> {
  readonly token: string;
  claim(ownerSessionId: string): Promise<void>;
  dispose(): Promise<void>;
  getConflict(): Promise<{ readonly runId: string } | null>;
  resume(payload: T): Promise<void>;
  iterate(): AsyncIterator<T>;
}

/**
 * Handle for a child turn started from a parent session.
 */
export interface DurabilityChildTurnHandle {
  readonly id: string;
  awaitResult(): Promise<unknown>;
}

/**
 * Live session metadata returned when a durability session opens.
 */
export interface DurabilitySessionHandle {
  readonly continuationToken: string;
  readonly sessionId: string;
}

/**
 * Input to {@link DurabilityPort.startSession}.
 */
export interface DurabilityStartSessionInput {
  readonly continuationToken?: string;
  readonly sessionId: string;
}

/**
 * Input to {@link DurabilityPort.checkpoint}.
 */
export interface DurabilityCheckpointInput<T> {
  readonly fn: () => Promise<T>;
  readonly name: string;
  readonly sessionId: string;
}

/**
 * Input to {@link DurabilityPort.createInbox}.
 */
export interface DurabilityCreateInboxInput {
  readonly sessionId: string;
  readonly token: string;
}

/**
 * Input to {@link DurabilityPort.startChildTurn}.
 */
export interface DurabilityStartChildTurnInput {
  readonly parentSessionId: string;
  readonly run: () => Promise<unknown>;
}

/**
 * Options for {@link DurabilityPort.readEventStream}.
 */
export interface DurabilityReadEventStreamOptions {
  readonly startIndex?: number;
}

/**
 * Capability flags a backend may expose for degraded-mode documentation.
 */
export interface DurabilityBackendCapabilities {
  readonly childTurns: boolean;
  readonly checkpoints: boolean;
  readonly crossDeployChildRouting: boolean;
  readonly eventStream: boolean;
  readonly inboxes: boolean;
  readonly scheduleTriggers: boolean;
}

/**
 * Eve-owned durability primitives consumed by SessionDriver and TurnDriver.
 *
 * Backends implement this port; orchestration never calls Workflow SDK APIs
 * directly once the extraction is complete.
 */
export interface DurabilityPort {
  readonly capabilities: DurabilityBackendCapabilities;
  appendEvent(sessionId: string, event: HandleMessageStreamEvent): Promise<void>;
  checkpoint<T>(input: DurabilityCheckpointInput<T>): Promise<T>;
  createInbox<T = DurabilityInboxPayload>(input: DurabilityCreateInboxInput): DurabilityInbox<T>;
  readEventStream(
    sessionId: string,
    options?: DurabilityReadEventStreamOptions,
  ): ReadableStream<HandleMessageStreamEvent>;
  startChildTurn(input: DurabilityStartChildTurnInput): DurabilityChildTurnHandle;
  startSession(input: DurabilityStartSessionInput): Promise<DurabilitySessionHandle>;
}
