import { describe, expect, it, vi } from "vitest";

import type { HandleMessageStreamEvent } from "#protocol/message.js";
import { emitProxiedAuthorizationEvent } from "#execution/subagent-authorization-proxy.js";

function captureEmit(): {
  emit: (event: HandleMessageStreamEvent) => Promise<void>;
  events: HandleMessageStreamEvent[];
} {
  const events: HandleMessageStreamEvent[] = [];
  return {
    emit: vi.fn(async (event: HandleMessageStreamEvent) => {
      events.push(event);
    }),
    events,
  };
}

describe("emitProxiedAuthorizationEvent", () => {
  it("re-emits a challenge as authorization.required with the child's coordinates", async () => {
    const { emit, events } = captureEmit();

    await emitProxiedAuthorizationEvent({
      emit,
      hookPayload: {
        callId: "call-1",
        childSessionId: "child-session",
        event: {
          authorization: { url: "https://idp.example.com/authorize" },
          description: "Authorization required for linear",
          name: "linear",
          sequence: 3,
          stepIndex: 2,
          turnId: "turn-0",
          webhookUrl: "https://agent.example.com/eve/v1/connections/linear/callback/child:auth",
        },
        kind: "subagent-authorization-request",
        subagentName: "linear",
      },
    });

    expect(events).toEqual([
      {
        data: {
          authorization: { url: "https://idp.example.com/authorize" },
          description: "Authorization required for linear",
          name: "linear",
          sequence: 3,
          stepIndex: 2,
          turnId: "turn-0",
          webhookUrl: "https://agent.example.com/eve/v1/connections/linear/callback/child:auth",
        },
        type: "authorization.required",
      },
    ]);
  });

  it("re-emits an outcome as authorization.completed", async () => {
    const { emit, events } = captureEmit();

    await emitProxiedAuthorizationEvent({
      emit,
      hookPayload: {
        callId: "call-1",
        childSessionId: "child-session",
        event: {
          name: "linear",
          outcome: "authorized",
          sequence: 5,
          stepIndex: 4,
          turnId: "turn-0",
        },
        kind: "subagent-authorization-completed",
        subagentName: "linear",
      },
    });

    expect(events).toEqual([
      {
        data: {
          name: "linear",
          outcome: "authorized",
          sequence: 5,
          stepIndex: 4,
          turnId: "turn-0",
        },
        type: "authorization.completed",
      },
    ]);
  });
});
