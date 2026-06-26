import { createHash } from "node:crypto";

import {
  type HandleMessageStreamEvent,
  type TimedHandleMessageStreamEvent,
  timestampHandleMessageStreamEvent,
} from "#protocol/message.js";

export interface EventIdentityScope {
  readonly sessionId: string;
  readonly turnSequence: number | "terminal";
}

/**
 * Creates an event stamper scoped to one logical session turn.
 *
 * At-least-once delivery can invoke multiple physical Workflow steps for the
 * same logical turn. The session and turn sequence survive that replay. Event
 * content keeps IDs stable when independent emissions change order, while the
 * per-content occurrence distinguishes intentionally repeated identical events.
 */
export function createEventStamper(
  scope: EventIdentityScope,
): (event: HandleMessageStreamEvent) => TimedHandleMessageStreamEvent {
  const occurrences = new Map<string, number>();
  const serializedScope = JSON.stringify(scope, sortJsonObjectKeys);

  return (event) => {
    const { meta: _meta, ...logicalEvent } = event;
    const content = JSON.stringify(logicalEvent, sortJsonObjectKeys);
    const occurrence = occurrences.get(content) ?? 0;
    occurrences.set(content, occurrence + 1);

    const id = createHash("sha256")
      .update(serializedScope)
      .update("\0")
      .update(content)
      .update("\0")
      .update(String(occurrence))
      .digest("base64url");

    return timestampHandleMessageStreamEvent(event, `evt_${id}`);
  };
}

function sortJsonObjectKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}
