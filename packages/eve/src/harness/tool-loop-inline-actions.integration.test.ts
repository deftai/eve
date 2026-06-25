import { jsonSchema, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import type { HandleMessageStreamEvent } from "#protocol/message.js";
import { createToolLoopHarness } from "#harness/tool-loop.js";
import type { HarnessSession, ToolLoopHarnessConfig } from "#harness/types.js";

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve() {
      if (resolvePromise === undefined) {
        throw new Error("Deferred promise resolver was not initialized.");
      }
      resolvePromise();
    },
  };
}

function createSession(): HarnessSession {
  return {
    agent: {
      modelReference: { id: "mock-model" },
      system: "You are a test assistant.",
      tools: [{ description: "Runs slowly.", inputSchema: { type: "object" }, name: "slow" }],
    },
    compaction: { recentWindowSize: 10, threshold: 100_000 },
    continuationToken: "http:inline-actions",
    history: [],
    sessionId: "inline-actions",
  };
}

describe("inline tool action lifecycle", () => {
  it("emits actions.requested before a local tool execution starts", async () => {
    const executionStarted = createDeferred();
    const releaseExecution = createDeferred();
    const events: HandleMessageStreamEvent[] = [];
    let actionRequestedBeforeExecution = false;
    let requestedAction: unknown;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              input: "{}",
              toolCallId: "call-slow",
              toolName: "slow",
              type: "tool-call",
            },
            {
              finishReason: { raw: undefined, unified: "tool-calls" },
              type: "finish",
              usage: {
                inputTokens: {
                  cacheRead: undefined,
                  cacheWrite: undefined,
                  noCache: 1,
                  total: 1,
                },
                outputTokens: {
                  reasoning: undefined,
                  text: 0,
                  total: 1,
                },
              },
            },
          ],
        }),
      }),
    });
    const config: ToolLoopHarnessConfig = {
      codeMode: false,
      handleEvent: async (event) => {
        events.push(event);
      },
      mode: "conversation",
      resolveModel: async () => model,
      tools: new Map([
        [
          "slow",
          {
            description: "Runs slowly.",
            execute: async () => {
              const requestEvent = events.find((event) => event.type === "actions.requested");
              if (requestEvent?.type === "actions.requested") {
                actionRequestedBeforeExecution = true;
                requestedAction = requestEvent.data.actions[0];
              }
              executionStarted.resolve();
              await releaseExecution.promise;
              return { ok: true };
            },
            inputSchema: jsonSchema({ type: "object" }),
            name: "slow",
          },
        ],
      ]),
    };

    const run = createToolLoopHarness(config)(createSession(), { message: "Run the slow tool." });
    await executionStarted.promise;

    try {
      expect(actionRequestedBeforeExecution).toBe(true);
      expect(requestedAction).toEqual({
        callId: "call-slow",
        input: {},
        kind: "tool-call",
        toolName: "slow",
      });
    } finally {
      releaseExecution.resolve();
      await run;
    }
  });
});
