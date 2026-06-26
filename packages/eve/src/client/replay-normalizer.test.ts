import { describe, expect, it } from "vitest";

import { ReplayNormalizer } from "#client/replay-normalizer.js";
import type { HandleMessageStreamEvent } from "#protocol/message.js";

describe("ReplayNormalizer", () => {
  it("suppresses interleaved copies of the same logical event", () => {
    const normalizer = new ReplayNormalizer();
    const started = event("turn.started", "turn_0:start", 0);
    const completed = event("turn.completed", "turn_0:complete", 0);

    expect(
      [started, started, completed, completed].filter((value) => normalizer.shouldExpose(value)),
    ).toEqual([started, completed]);
  });

  it("suppresses every late event from a settled turn", () => {
    const normalizer = new ReplayNormalizer();
    const started = event("turn.started", "turn_0:start", 0);
    const waiting = event("session.waiting", "turn_0:waiting", 0);
    const nextStarted = event("turn.started", "turn_1:start", 1);

    expect(normalizer.shouldExpose(started)).toBe(true);
    expect(normalizer.shouldExpose(waiting)).toBe(true);
    expect(normalizer.shouldExpose(started)).toBe(false);
    expect(normalizer.shouldExpose(waiting)).toBe(false);
    expect(normalizer.shouldExpose(nextStarted)).toBe(true);
  });

  it("preserves equal payloads with distinct logical IDs", () => {
    const normalizer = new ReplayNormalizer();
    const first = event("message.appended", "turn_0:text:1", 0);
    const second = event("message.appended", "turn_0:text:2", 0);

    expect(normalizer.shouldExpose(first)).toBe(true);
    expect(normalizer.shouldExpose(second)).toBe(true);
  });

  it("restores active-turn identities across reconnects", () => {
    const first = new ReplayNormalizer();
    const started = event("turn.started", "turn_0:start", 0);
    const message = event("message.appended", "turn_0:text:1", 0);

    expect(first.shouldExpose(started)).toBe(true);
    expect(first.shouldExpose(message)).toBe(true);

    const restored = new ReplayNormalizer(first.cursor);
    expect(restored.shouldExpose(started)).toBe(false);
    expect(restored.shouldExpose(message)).toBe(false);
  });

  it("uses a legacy history prefix to reject a late replay", () => {
    const normalizer = new ReplayNormalizer();
    const started = { data: { sequence: 0, turnId: "turn_0" }, type: "turn.started" } as const;
    const completed = {
      data: { sequence: 0, turnId: "turn_0" },
      type: "turn.completed",
    } as const;
    const waiting = { data: { wait: "next-user-message" }, type: "session.waiting" } as const;

    normalizer.observeHistory(started);
    normalizer.observeHistory(completed);
    normalizer.observeHistory(waiting);

    expect(normalizer.shouldExpose(event("turn.started", "turn_0:start", 0))).toBe(false);
    expect(normalizer.shouldExpose(event("turn.completed", "turn_0:complete", 0))).toBe(false);
    expect(normalizer.shouldExpose(event("session.waiting", "turn_0:waiting", 0))).toBe(false);
  });

  it("passes legacy events through without guessing identity", () => {
    const normalizer = new ReplayNormalizer();
    const legacy = { data: { sequence: 0, turnId: "turn_0" }, type: "turn.started" } as const;

    expect(normalizer.shouldExpose(legacy)).toBe(true);
    expect(normalizer.shouldExpose(legacy)).toBe(true);
  });
});

function event(
  type: HandleMessageStreamEvent["type"],
  eventId: string,
  sequence: number,
): HandleMessageStreamEvent {
  const turn = { id: `turn_${sequence}`, sequence };
  const data =
    type === "session.waiting"
      ? { sequence, turnId: turn.id, wait: "next-user-message" as const }
      : { sequence, turnId: turn.id };
  return {
    data,
    meta: { at: "2026-06-26T00:00:00.000Z", eventId, turn },
    type,
  } as HandleMessageStreamEvent;
}
