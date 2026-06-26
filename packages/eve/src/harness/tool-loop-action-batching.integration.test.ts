import { createServer, type Server } from "node:http";

import { jsonSchema, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { createToolLoopHarness } from "#harness/tool-loop.js";
import type { HarnessSession, ToolLoopHarnessConfig } from "#harness/types.js";
import type { HandleMessageStreamEvent } from "#protocol/message.js";

const TRISTATE_LOCATIONS = [
  "New York City, NY",
  "Brooklyn, NY",
  "Queens, NY",
  "Newark, NJ",
  "Jersey City, NJ",
  "Stamford, CT",
  "Bridgeport, CT",
  "Yonkers, NY",
  "Long Island, NY",
  "Hoboken, NJ",
] as const;
const TOOL_NAME = "fetch_search";

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

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

function readLocation(input: unknown): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`Expected ${TOOL_NAME} input to be an object.`);
  }

  const location = Reflect.get(input, "location");
  if (typeof location !== "string")
    throw new Error(`Expected ${TOOL_NAME} input.location to be a string.`);
  return location;
}

function createSession(): HarnessSession {
  return {
    agent: {
      modelReference: { id: "mock-model" },
      system: "You are a test assistant.",
      tools: [
        {
          description: "Fetches one search response for a location.",
          inputSchema: null,
          name: TOOL_NAME,
        },
      ],
    },
    compaction: { recentWindowSize: 10, threshold: 100_000 },
    continuationToken: "http:tool-batching",
    history: [],
    sessionId: "tool-batching",
  };
}

describe("batched tool execution", () => {
  it("streams an authored fetch result while the other nine requests are still open", async () => {
    const releaseRemainingSearches = createDeferred();
    const startedLocations = new Set<string>();
    const arrivedLocations = new Set<string>();
    const events: HandleMessageStreamEvent[] = [];
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const location = requestUrl.searchParams.get("location");
      if (location === null) {
        response.writeHead(400);
        response.end("location is required");
        return;
      }

      arrivedLocations.add(location);
      const respond = () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ location }));
      };

      if (location === TRISTATE_LOCATIONS[0]) {
        respond();
      } else {
        void releaseRemainingSearches.promise.then(respond);
      }
    });
    const serverUrl = await listen(server);

    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            ...TRISTATE_LOCATIONS.map((location, index) => ({
              input: JSON.stringify({ location }),
              toolCallId: `call-fetch-${index}`,
              toolName: TOOL_NAME,
              type: "tool-call" as const,
            })),
            {
              finishReason: { raw: undefined, unified: "tool-calls" },
              type: "finish" as const,
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
                  total: TRISTATE_LOCATIONS.length,
                },
              },
            },
          ],
        }),
      }),
    });
    const config: ToolLoopHarnessConfig = {
      handleEvent: async (event) => {
        events.push(event);
      },
      mode: "conversation",
      resolveModel: async () => model,
      tools: new Map([
        [
          TOOL_NAME,
          {
            description: "Fetches one search response for a location.",
            execute: async (input) => {
              const location = readLocation(input);
              startedLocations.add(location);
              const response = await fetch(
                `${serverUrl}/search?${new URLSearchParams({ location }).toString()}`,
              );
              if (!response.ok) throw new Error(`Search request failed with ${response.status}.`);
              return await response.json();
            },
            inputSchema: jsonSchema({
              additionalProperties: false,
              properties: { location: { type: "string" } },
              required: ["location"],
              type: "object",
            }),
            name: TOOL_NAME,
          },
        ],
      ]),
    };

    const run = createToolLoopHarness(config)(createSession(), {
      message: "Fan out authored fetch searches across the tristate area.",
    });

    try {
      await vi.waitFor(() => expect(startedLocations).toEqual(new Set(TRISTATE_LOCATIONS)), {
        timeout: 1_000,
      });
      await vi.waitFor(() => expect(arrivedLocations).toEqual(new Set(TRISTATE_LOCATIONS)), {
        timeout: 1_000,
      });
      await vi.waitFor(
        () =>
          expect(
            events.some(
              (event) =>
                event.type === "action.result" &&
                event.data.result.kind === "tool-result" &&
                event.data.result.callId === "call-fetch-0",
            ),
          ).toBe(true),
        { timeout: 250 },
      );
      const firstResultIndex = events.findIndex((event) => event.type === "action.result");
      const requestedCallIds = events.flatMap((event) => {
        if (event.type !== "actions.requested") return [];
        return event.data.actions.flatMap((action) =>
          action.kind === "tool-call" && action.toolName === TOOL_NAME ? [action.callId] : [],
        );
      });
      expect(firstResultIndex).toBeGreaterThanOrEqual(0);
      expect(new Set(requestedCallIds)).toEqual(
        new Set(TRISTATE_LOCATIONS.map((_, index) => `call-fetch-${index}`)),
      );
      expect(
        events
          .map((event, index) => ({ event, index }))
          .filter(({ event }) => event.type === "actions.requested")
          .every(({ index }) => index < firstResultIndex),
      ).toBe(true);
      expect(events.filter((event) => event.type === "action.result")).toHaveLength(1);
    } finally {
      releaseRemainingSearches.resolve();
      await run;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
