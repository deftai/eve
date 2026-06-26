import { describe, expect, it } from "vitest";

import { createEventStamper, type EventIdentityScope } from "#execution/event-stamper.js";
import {
  createActionsRequestedEvent,
  createSessionWaitingEvent,
  createStepStartedEvent,
} from "#protocol/message.js";
import type { JsonObject } from "#shared/json.js";

const turnScope: EventIdentityScope = { sessionId: "session_1", turnSequence: 4 };

function actionEvent(callId: string, input: JsonObject) {
  return createActionsRequestedEvent({
    actions: [{ callId, input, kind: "tool-call", toolName: "lookup" }],
    sequence: 4,
    stepIndex: 0,
    turnId: "turn_4",
  });
}

describe("createEventStamper", () => {
  it("recreates event IDs across physical step invocations and reordered emissions", () => {
    const firstInvocation = createEventStamper(turnScope);
    const replayedInvocation = createEventStamper(turnScope);
    const firstCall = actionEvent("call_1", { city: "New York", units: "celsius" });
    const secondCall = actionEvent("call_2", { city: "London", units: "celsius" });

    const firstCallId = firstInvocation(firstCall).meta.id;
    const secondCallId = firstInvocation(secondCall).meta.id;

    expect(replayedInvocation(secondCall).meta.id).toBe(secondCallId);
    expect(replayedInvocation(firstCall).meta.id).toBe(firstCallId);
    expect(firstCallId).toMatch(/^evt_[A-Za-z0-9_-]{43}$/);
  });

  it("keeps identical events unique across logical turns", () => {
    const event = createSessionWaitingEvent();
    const currentTurnId = createEventStamper(turnScope)(event).meta.id;
    const nextTurnId = createEventStamper({ ...turnScope, turnSequence: 5 })(event).meta.id;

    expect(nextTurnId).not.toBe(currentTurnId);
  });

  it("distinguishes repeated identical events and recreates each occurrence on replay", () => {
    const event = createStepStartedEvent({ sequence: 4, stepIndex: 0, turnId: "turn_4" });
    const firstInvocation = createEventStamper(turnScope);
    const replayedInvocation = createEventStamper(turnScope);

    const firstIds = [firstInvocation(event).meta.id, firstInvocation(event).meta.id];
    const replayIds = [replayedInvocation(event).meta.id, replayedInvocation(event).meta.id];

    expect(new Set(firstIds).size).toBe(2);
    expect(replayIds).toEqual(firstIds);
  });

  it("uses canonical object keys and changes identity when event content changes", () => {
    const firstInvocation = createEventStamper(turnScope);
    const replayedInvocation = createEventStamper(turnScope);
    const changedReplay = createEventStamper(turnScope);

    const firstId = firstInvocation(actionEvent("call_1", { city: "New York", units: "celsius" }))
      .meta.id;
    const reorderedId = replayedInvocation(
      actionEvent("call_1", { units: "celsius", city: "New York" }),
    ).meta.id;
    const changedId = changedReplay(actionEvent("call_1", { city: "London", units: "celsius" }))
      .meta.id;

    expect(reorderedId).toBe(firstId);
    expect(changedId).not.toBe(firstId);
  });
});
