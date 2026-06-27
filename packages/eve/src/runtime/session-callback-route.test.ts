import { beforeEach, describe, expect, it, vi } from "vitest";

import { EVE_CALLBACK_ROUTE_PATTERN } from "#protocol/routes.js";
import type { RouteContext } from "#public/definitions/channel.js";
import {
  getSessionCallbackChannelDefinitions,
  getSessionCallbackChannelNames,
  handleSessionCallbackRequest,
  HTTP_SESSION_CALLBACK_CHANNEL_NAME_PREFIX,
} from "#runtime/session-callback-route.js";

const resumeHookMock = vi.fn();

vi.mock("#compiled/@workflow/core/runtime.js", () => ({
  resumeHook: (token: string, payload: unknown) => resumeHookMock(token, payload),
}));

const startSpanMock = vi.fn();
const endSpanMock = vi.fn();

vi.mock("#compiled/@opentelemetry/api/index.js", () => ({
  trace: {
    getTracer: () => ({
      startSpan: (name: string, options: unknown) => {
        startSpanMock(name, options);
        return { end: endSpanMock };
      },
    }),
  },
}));

describe("session callback route", () => {
  beforeEach(() => {
    resumeHookMock.mockReset();
    startSpanMock.mockReset();
    endSpanMock.mockReset();
  });

  it("registers the POST framework callback route", () => {
    expect(getSessionCallbackChannelDefinitions()).toEqual([
      expect.objectContaining({
        method: "POST",
        name: `${HTTP_SESSION_CALLBACK_CHANNEL_NAME_PREFIX}/post`,
        urlPath: EVE_CALLBACK_ROUTE_PATTERN,
      }),
    ]);
  });

  it("uses route-aligned logical names for disableRoute", () => {
    const names = getSessionCallbackChannelNames();
    expect(names).toEqual(new Set([`${HTTP_SESSION_CALLBACK_CHANNEL_NAME_PREFIX}/post`]));
    expect([...names].some((name) => name.startsWith(".well-known/"))).toBe(false);
  });

  it("resumes a completed remote-agent result", async () => {
    resumeHookMock.mockResolvedValue(undefined);

    const response = await handleSessionCallbackRequest(
      new Request("https://app.example.com/eve/v1/callback/tok123", {
        body: JSON.stringify({
          callId: "call-1",
          kind: "session.completed",
          output: "done",
          sessionId: "remote-session",
          subagentName: "research",
        }),
        method: "POST",
      }),
      createRouteContext({ token: "tok123" }),
    );

    expect(response.status).toBe(202);
    expect(resumeHookMock).toHaveBeenCalledWith("tok123", {
      kind: "runtime-action-result",
      results: [
        {
          callId: "call-1",
          kind: "subagent-result",
          output: "done",
          subagentName: "research",
        },
      ],
    });
    expect(startSpanMock).not.toHaveBeenCalled();
  });

  it("emits an invoke_agent usage span when a completed callback reports usage", async () => {
    resumeHookMock.mockResolvedValue(undefined);

    const response = await handleSessionCallbackRequest(
      new Request("https://app.example.com/eve/v1/callback/tok123", {
        body: JSON.stringify({
          callId: "call-1",
          kind: "session.completed",
          output: "done",
          sessionId: "remote-session",
          subagentName: "research",
          usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
        }),
        method: "POST",
      }),
      createRouteContext({ token: "tok123" }),
    );

    expect(response.status).toBe(202);
    expect(startSpanMock).toHaveBeenCalledWith("invoke_agent research", {
      attributes: {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": "research",
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 50,
        "gen_ai.usage.cache_read.input_tokens": 10,
      },
    });
    expect(endSpanMock).toHaveBeenCalledTimes(1);
    expect(resumeHookMock).toHaveBeenCalledWith("tok123", {
      kind: "runtime-action-result",
      results: [
        { callId: "call-1", kind: "subagent-result", output: "done", subagentName: "research" },
      ],
    });
  });

  it("does not emit a usage span for a malformed usage payload", async () => {
    resumeHookMock.mockResolvedValue(undefined);

    const response = await handleSessionCallbackRequest(
      new Request("https://app.example.com/eve/v1/callback/tok123", {
        body: JSON.stringify({
          callId: "call-1",
          kind: "session.completed",
          output: "done",
          sessionId: "remote-session",
          subagentName: "research",
          usage: { inputTokens: "lots", outputTokens: 50, cacheReadTokens: 10 },
        }),
        method: "POST",
      }),
      createRouteContext({ token: "tok123" }),
    );

    expect(response.status).toBe(202);
    expect(startSpanMock).not.toHaveBeenCalled();
  });

  it("does not emit a usage span for a failed callback", async () => {
    resumeHookMock.mockResolvedValue(undefined);

    const response = await handleSessionCallbackRequest(
      new Request("https://app.example.com/eve/v1/callback/tok123", {
        body: JSON.stringify({
          callId: "call-1",
          error: { code: "SESSION_FAILED", message: "boom" },
          kind: "session.failed",
          sessionId: "remote-session",
          subagentName: "research",
        }),
        method: "POST",
      }),
      createRouteContext({ token: "tok123" }),
    );

    expect(response.status).toBe(202);
    expect(startSpanMock).not.toHaveBeenCalled();
  });
});

function createRouteContext(params: Record<string, string>): RouteContext {
  return {
    agent: {
      async deliver() {
        throw new Error("unexpected deliver");
      },
      async getEventStream() {
        throw new Error("unexpected getEventStream");
      },
      async run() {
        throw new Error("unexpected run");
      },
    },
    params,
    requestIp: null,
    waitUntil() {},
  };
}
