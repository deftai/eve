import { describe, expect, it, vi } from "vitest";

import { createInMemoryDurabilityBackend } from "#execution/durability/backends/in-memory.js";
import { runTurnDriver } from "#execution/durability/turn-driver.js";
import {
  TURN_WORKFLOW_INPUT_VERSION,
  type TurnWorkflowInput,
} from "#execution/durable-session-migrations/turn-workflow.js";
import type { DurableSessionState } from "#execution/durable-session-store.js";
import { turnStep } from "#execution/workflow-steps.js";

vi.mock("#execution/workflow-steps.js", () => ({
  turnStep: vi.fn(),
}));

vi.mock("#internal/workflow/runtime.js", () => ({
  resumeHook: vi.fn(),
}));

describe("runTurnDriver", () => {
  it("runs a legacy turn without inbox ownership when turnInbox is absent", async () => {
    const sessionState = createSessionState();
    vi.mocked(turnStep).mockResolvedValueOnce({
      action: "done",
      output: "ok",
      serializedContext: { state: "done" },
      sessionState,
    });

    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });

    await runTurnDriver({
      port: binding.port,
      workflowInput: createLegacyInput({ sessionState }),
    });

    expect(turnStep).toHaveBeenCalledOnce();
    await binding.shutdown();
  });
});

function createSessionState(): DurableSessionState {
  return {
    continuationToken: "http:test",
    emissionState: { sequence: 0, sessionStarted: false, stepIndex: 0, turnId: "" },
    hasProxyInputRequests: false,
    sessionId: "sess-1",
    version: 1,
  };
}

function createLegacyInput(input: {
  readonly sessionState: DurableSessionState;
}): TurnWorkflowInput {
  const parentWritable = new WritableStream<Uint8Array>();
  return {
    capabilities: undefined,
    completionToken: "turn-token",
    mode: "task",
    stepInput: {
      input: { kind: "deliver", payloads: [{ message: "hello" }] },
      parentWritable,
      serializedContext: {},
      sessionState: input.sessionState,
    },
    version: TURN_WORKFLOW_INPUT_VERSION,
  };
}
