import { createServer, type Server } from "node:http";

import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { jsonSchema, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { createToolLoopHarness } from "#harness/tool-loop.js";
import type { HarnessSession, ToolLoopHarnessConfig } from "#harness/types.js";

const FANOUT_LOCATIONS = [
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
const FETCH_SEARCH_TOOL_NAME = "fetch_search";
const LOOKUP_TOOL_NAME = "lookup_subject";
const FETCH_DETAILS_TOOL_NAME = "fetch_subject_details";

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

function finish(): LanguageModelV4StreamPart {
  return {
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
  };
}

function toolCallChunks(input: {
  readonly callId: string;
  readonly input: Record<string, string>;
  readonly toolName: string;
}): readonly LanguageModelV4StreamPart[] {
  return [
    { id: input.callId, toolName: input.toolName, type: "tool-input-start" },
    { id: input.callId, type: "tool-input-end" },
    {
      input: JSON.stringify(input.input),
      toolCallId: input.callId,
      toolName: input.toolName,
      type: "tool-call",
    },
  ];
}

function createSession(
  tools: readonly { readonly description: string; readonly name: string }[],
): HarnessSession {
  return {
    agent: {
      modelReference: { id: "mock-model" },
      system: "You are a test assistant.",
      tools: tools.map((tool) => ({ ...tool, inputSchema: null })),
    },
    compaction: { recentWindowSize: 10, threshold: 100_000 },
    continuationToken: "http:eager-tool-execution",
    history: [],
    sessionId: "eager-tool-execution",
  };
}

function readStringProperty(input: unknown, property: string): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Expected a tool input object.");
  }

  const value = Reflect.get(input, property);
  if (typeof value !== "string") throw new Error(`Expected tool input.${property} to be a string.`);
  return value;
}

function createDelayedFanoutStream(input: {
  readonly onModelCallEnd: () => void;
  readonly releaseRemainingModelOutput: Promise<void>;
}): ReadableStream<LanguageModelV4StreamPart> {
  const chunks = [
    ...toolCallChunks({
      callId: "call-fetch-0",
      input: { location: FANOUT_LOCATIONS[0] },
      toolName: FETCH_SEARCH_TOOL_NAME,
    }),
    ...FANOUT_LOCATIONS.slice(1).flatMap((location, index) =>
      toolCallChunks({
        callId: `call-fetch-${index + 1}`,
        input: { location },
        toolName: FETCH_SEARCH_TOOL_NAME,
      }),
    ),
    finish(),
  ];
  let chunkIndex = 0;

  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      if (chunkIndex === 3) {
        await input.releaseRemainingModelOutput;
      }

      const chunk = chunks[chunkIndex++];
      if (chunk === undefined) {
        controller.close();
        return;
      }

      if (chunk.type === "finish") input.onModelCallEnd();
      controller.enqueue(chunk);
    },
  });
}

describe("eager local tool execution", () => {
  it("starts independent fetches before the model call ends and retains same-step fanout", async () => {
    const releaseRemainingModelOutput = createDeferred();
    const releaseNetworkResponses = createDeferred();
    const executionStarts: string[] = [];
    const arrivedLocations = new Set<string>();
    let firstActionRequested = false;
    let firstExecutionStartedBeforeModelCallEnd = false;
    let firstExecutionStartedAfterActionRequest = false;
    let modelCallEnded = false;
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const location = requestUrl.searchParams.get("location");
      if (location === null) {
        response.writeHead(400);
        response.end("location is required");
        return;
      }

      arrivedLocations.add(location);
      void releaseNetworkResponses.promise.then(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ location }));
      });
    });
    const serverUrl = await listen(server);
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: createDelayedFanoutStream({
          onModelCallEnd() {
            modelCallEnded = true;
          },
          releaseRemainingModelOutput: releaseRemainingModelOutput.promise,
        }),
      }),
    });
    const config: ToolLoopHarnessConfig = {
      handleEvent: async (event) => {
        if (event.type !== "actions.requested") return;
        firstActionRequested ||= event.data.actions.some(
          (action) => action.kind === "tool-call" && action.callId === "call-fetch-0",
        );
      },
      mode: "conversation",
      resolveModel: async () => model,
      tools: new Map([
        [
          FETCH_SEARCH_TOOL_NAME,
          {
            description: "Fetches one search response for a location.",
            execute: async (input: unknown) => {
              const location = readStringProperty(input, "location");
              executionStarts.push(location);
              if (location === FANOUT_LOCATIONS[0]) {
                firstExecutionStartedBeforeModelCallEnd = !modelCallEnded;
                firstExecutionStartedAfterActionRequest = firstActionRequested;
              }
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
            name: FETCH_SEARCH_TOOL_NAME,
          },
        ],
      ]),
    };
    const run = createToolLoopHarness(config)(
      createSession([
        {
          description: "Fetches one search response for a location.",
          name: FETCH_SEARCH_TOOL_NAME,
        },
      ]),
      { message: "Fan out ten independent search requests." },
    );

    try {
      await vi.waitFor(() => expect(firstExecutionStartedBeforeModelCallEnd).toBe(true), {
        timeout: 500,
      });
      expect(firstExecutionStartedAfterActionRequest).toBe(true);
      await vi.waitFor(() => expect(arrivedLocations).toEqual(new Set([FANOUT_LOCATIONS[0]])), {
        timeout: 500,
      });
      expect(modelCallEnded).toBe(false);

      releaseRemainingModelOutput.resolve();
      await vi.waitFor(() => expect(arrivedLocations).toEqual(new Set(FANOUT_LOCATIONS)), {
        timeout: 500,
      });
    } finally {
      releaseRemainingModelOutput.resolve();
      releaseNetworkResponses.resolve();
      await run;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(executionStarts).toHaveLength(FANOUT_LOCATIONS.length);
  });

  it("keeps a dependent tool in the next model step after its prerequisite result", async () => {
    const executionOrder: string[] = [];
    const executionStartedAfterActionRequest: boolean[] = [];
    const requestedCallIds = new Set<string>();
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              ...toolCallChunks({
                callId: "call-lookup",
                input: { query: "eve" },
                toolName: LOOKUP_TOOL_NAME,
              }),
              finish(),
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              ...toolCallChunks({
                callId: "call-fetch-details",
                input: { subjectId: "subject-42" },
                toolName: FETCH_DETAILS_TOOL_NAME,
              }),
              finish(),
            ],
          }),
        },
      ],
    });
    const config: ToolLoopHarnessConfig = {
      handleEvent: async (event) => {
        if (event.type !== "actions.requested") return;
        for (const action of event.data.actions) {
          if (action.kind === "tool-call") requestedCallIds.add(action.callId);
        }
      },
      mode: "conversation",
      resolveModel: async () => model,
      tools: new Map([
        [
          LOOKUP_TOOL_NAME,
          {
            description: "Looks up a subject ID.",
            execute: async () => {
              executionStartedAfterActionRequest.push(requestedCallIds.has("call-lookup"));
              executionOrder.push(LOOKUP_TOOL_NAME);
              return { subjectId: "subject-42" };
            },
            inputSchema: jsonSchema({
              additionalProperties: false,
              properties: { query: { type: "string" } },
              required: ["query"],
              type: "object",
            }),
            name: LOOKUP_TOOL_NAME,
          },
        ],
        [
          FETCH_DETAILS_TOOL_NAME,
          {
            description: "Fetches details for a subject ID.",
            execute: async (input: unknown) => {
              executionStartedAfterActionRequest.push(requestedCallIds.has("call-fetch-details"));
              executionOrder.push(FETCH_DETAILS_TOOL_NAME);
              return { detail: `details for ${readStringProperty(input, "subjectId")}` };
            },
            inputSchema: jsonSchema({
              additionalProperties: false,
              properties: { subjectId: { type: "string" } },
              required: ["subjectId"],
              type: "object",
            }),
            name: FETCH_DETAILS_TOOL_NAME,
          },
        ],
      ]),
    };
    const session = createSession([
      { description: "Looks up a subject ID.", name: LOOKUP_TOOL_NAME },
      { description: "Fetches details for a subject ID.", name: FETCH_DETAILS_TOOL_NAME },
    ]);

    const firstResult = await createToolLoopHarness(config)(session, {
      message: "Look up eve, then fetch its details.",
    });

    expect(executionOrder).toEqual([LOOKUP_TOOL_NAME]);
    expect(typeof firstResult.next).toBe("function");

    await createToolLoopHarness(config)(firstResult.session);

    expect(executionOrder).toEqual([LOOKUP_TOOL_NAME, FETCH_DETAILS_TOOL_NAME]);
    expect(executionStartedAfterActionRequest).toEqual([true, true]);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("subject-42");
  });
});
