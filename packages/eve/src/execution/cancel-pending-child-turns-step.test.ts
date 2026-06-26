import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelPendingChildTurnsStep } from "#execution/cancel-pending-child-turns-step.js";
import { readDurableSession } from "#execution/durable-session-store.js";
import { sendTurnCancellationStep } from "#execution/turn-control-protocol.js";
import {
  recordPendingSubagentChildToken,
  setPendingRuntimeActionBatch,
} from "#harness/runtime-actions.js";
import type { HarnessSession } from "#harness/types.js";

vi.mock("./durable-session-store.js", () => ({
  readDurableSession: vi.fn(),
}));

vi.mock("./turn-control-protocol.js", () => ({
  sendTurnCancellationStep: vi.fn(),
}));

describe("cancelPendingChildTurnsStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cascades cancellation to a pending local child turn inbox", async () => {
    const session = recordPendingSubagentChildToken({
      callId: "call-child",
      childContinuationToken: "subagent:parent:call-child",
      childTurnInboxToken: "child-session:turn-control:0:inbox",
      session: setPendingRuntimeActionBatch({
        actions: [
          {
            callId: "call-child",
            description: "Delegate",
            input: { message: "investigate" },
            kind: "subagent-call",
            name: "delegate",
            nodeId: "subagents/delegate",
            subagentName: "delegate",
          },
        ],
        event: { sequence: 0, stepIndex: 0, turnId: "turn_0" },
        responseMessages: [],
        session: createSession(),
      }),
    });
    vi.mocked(readDurableSession).mockResolvedValue(session);

    await cancelPendingChildTurnsStep({
      sessionState: {
        continuationToken: "eve:parent",
        emissionState: { sequence: 0, sessionStarted: true, stepIndex: 0, turnId: "turn_0" },
        hasProxyInputRequests: false,
        sessionId: "parent-session",
        version: 1,
      },
    });

    expect(sendTurnCancellationStep).toHaveBeenCalledWith({
      inboxToken: "child-session:turn-control:0:inbox",
    });
  });
});

function createSession(): HarnessSession {
  return {
    agent: { modelReference: { id: "mock/test" }, system: "", tools: [] },
    compaction: { recentWindowSize: 10, threshold: 100_000 },
    continuationToken: "eve:parent",
    history: [],
    sessionId: "parent-session",
  };
}
