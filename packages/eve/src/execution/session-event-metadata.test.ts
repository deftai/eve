import { describe, expect, it } from "vitest";

import { SessionEventMetadataCursor } from "#execution/session-event-metadata.js";
import { getHarnessEmissionState } from "#harness/emission.js";
import type { HarnessSession } from "#harness/types.js";
import { createSessionWaitingEvent, createTurnStartedEvent } from "#protocol/message.js";

describe("SessionEventMetadataCursor", () => {
  it("reuses event IDs when a durable execution replays from the same cursor", () => {
    const first = new SessionEventMetadataCursor({ eventIndex: 7, sessionId: "session_1" });
    const replay = new SessionEventMetadataCursor({ eventIndex: 7, sessionId: "session_1" });
    const event = createTurnStartedEvent({ sequence: 2, turnId: "turn_2" });

    expect(first.stamp(event).meta.eventId).toBe(replay.stamp(event).meta.eventId);
  });

  it("gives equal legitimate events distinct IDs within one execution", () => {
    const cursor = new SessionEventMetadataCursor({ eventIndex: 7, sessionId: "session_1" });
    const event = createTurnStartedEvent({ sequence: 2, turnId: "turn_2" });

    expect(cursor.stamp(event).meta.eventId).not.toBe(cursor.stamp(event).meta.eventId);
  });

  it("carries active turn coordinates onto session boundaries", () => {
    const cursor = new SessionEventMetadataCursor({ eventIndex: 0, sessionId: "session_1" });
    cursor.stamp(createTurnStartedEvent({ sequence: 2, turnId: "turn_2" }));

    const waiting = cursor.stamp(createSessionWaitingEvent({ sequence: 2, turnId: "turn_2" }));

    expect(waiting.meta.turn).toEqual({ id: "turn_2", sequence: 2 });
  });

  it("persists the next event position on the returned session", () => {
    const cursor = new SessionEventMetadataCursor({ eventIndex: 7, sessionId: "session_1" });
    cursor.stamp(createTurnStartedEvent({ sequence: 2, turnId: "turn_2" }));
    cursor.stamp(createSessionWaitingEvent({ sequence: 2, turnId: "turn_2" }));

    const updated = cursor.apply(createSession());

    expect(getHarnessEmissionState(updated.state).eventIndex).toBe(9);
  });
});

function createSession(): HarnessSession {
  return {
    agent: { modelReference: { id: "test-model" }, system: "test", tools: [] },
    compaction: { recentWindowSize: 10, threshold: 100_000 },
    continuationToken: "eve:test",
    history: [],
    sessionId: "session_1",
  };
}
