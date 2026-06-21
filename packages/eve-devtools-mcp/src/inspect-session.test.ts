import { describe, expect, it } from "vitest";

import type { DevToolsClient } from "./devtools-client.js";
import { inspectSession } from "./inspect-session.js";

describe("inspectSession", () => {
  it("correlates a failed tool call, session logs, and authored source", async () => {
    const client: DevToolsClient = {
      async continueRun() {
        throw new Error("Not used");
      },
      async createRun() {
        throw new Error("Not used");
      },
      async getRun(sessionId) {
        return {
          createdAt: "2026-06-21T10:00:00.000Z",
          eventCount: 2,
          retainedEventCount: 2,
          sessionId,
          status: "failed",
          title: "What is the weather in Munich?",
          updatedAt: "2026-06-21T10:00:01.000Z",
        };
      },
      async getRunEvents(sessionId) {
        return [
          {
            cursor: "1",
            event: {
              data: {
                actions: [
                  {
                    callId: "call-1",
                    input: { city: "Munich" },
                    kind: "tool-call",
                    toolName: "get_weather",
                  },
                ],
              },
              type: "actions.requested",
            },
            sessionId,
          },
          {
            cursor: "2",
            event: {
              data: {
                error: { code: "tool_error", message: "Munich lookup failed" },
                result: {
                  callId: "call-1",
                  isError: true,
                  kind: "tool-result",
                  output: "Munich lookup failed",
                  toolName: "get_weather",
                },
                status: "failed",
              },
              type: "action.result",
            },
            sessionId,
          },
        ];
      },
      async listLogs() {
        return [
          {
            cursor: "3",
            fields: { coordinates: { session: "another-session" } },
            level: "error",
            message: "Unrelated",
            stream: "console",
            timestamp: "2026-06-21T10:00:00.000Z",
          },
          {
            cursor: "4",
            fields: { coordinates: { session: "session-1", turn: "turn-1" } },
            level: "error",
            message: "Weather lookup failed for Munich",
            source: { line: 14, path: "agent/tools/get_weather.ts" },
            stream: "console",
            timestamp: "2026-06-21T10:00:01.000Z",
          },
        ];
      },
      async listRuns() {
        return [];
      },
      async listSources() {
        return [
          {
            id: "agent/tools/get_weather.ts",
            kind: "authored",
            loaded: true,
            path: "agent/tools/get_weather.ts",
          },
        ];
      },
    };

    const inspection = await inspectSession(client, "session-1");

    expect(inspection.toolCalls).toEqual([
      expect.objectContaining({
        input: { city: "Munich" },
        status: "failed",
        toolName: "get_weather",
      }),
    ]);
    expect(inspection.failures).toEqual([
      expect.objectContaining({ message: "Munich lookup failed", type: "action.result" }),
    ]);
    expect(inspection.logs).toHaveLength(1);
    expect(inspection.source).toEqual({
      location: { line: 14, path: "agent/tools/get_weather.ts" },
      path: "agent/tools/get_weather.ts",
      sourceId: "agent/tools/get_weather.ts",
    });
  });
});
