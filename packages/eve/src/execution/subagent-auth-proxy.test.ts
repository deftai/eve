import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChannelAdapter } from "#channel/adapter.js";
import type { SubagentAuthorizationEventHookPayload } from "#channel/types.js";
import { ContextContainer } from "#context/container.js";
import { AuthKey, ContinuationTokenKey, ModeKey, SessionIdKey } from "#context/keys.js";
import { BundleKey, ChannelKey } from "#runtime/sessions/runtime-context-keys.js";
import { serializeContext } from "#context/serialize.js";
import type { HarnessSession } from "#harness/types.js";
import { createEmptyHookRegistry } from "#runtime/hooks/registry.js";
import { getCompiledRuntimeAgentBundle } from "#runtime/sessions/compiled-agent-cache.js";
import {
  createDurableSessionState,
  DURABLE_SESSION_VERSION,
  type DurableSessionState,
  projectSessionState,
  readDurableSession,
} from "#execution/durable-session-store.js";
import { projectToDurableSession } from "#execution/session.js";
import { runProxyAuthorizationEventStep } from "#execution/subagent-auth-proxy.js";

vi.mock("./durable-session-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./durable-session-store.js")>();
  return {
    ...actual,
    createDurableSessionState: vi.fn(),
    readDurableSession: vi.fn(),
  };
});

vi.mock("../runtime/sessions/compiled-agent-cache.js", () => ({
  getCompiledRuntimeAgentBundle: vi.fn(),
}));

const TestTurnAgent = {
  id: "test-agent",
  instructions: ["You are a test agent."],
  model: { id: "test-model" },
  skills: [],
  tools: [],
  workspaceSpec: {} as never,
};

const DEFAULT_WORKFLOW_STREAM_NAMESPACE = "__default__";
const workflowWritesByNamespace = new Map<string, unknown[]>();

function createTestWritable(
  namespace = DEFAULT_WORKFLOW_STREAM_NAMESPACE,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      const existing = workflowWritesByNamespace.get(namespace) ?? [];
      existing.push(chunk);
      workflowWritesByNamespace.set(namespace, existing);
    },
  });
}

function installSessionStoreMocks(session: HarnessSession): void {
  vi.mocked(readDurableSession).mockResolvedValue(session);
  vi.mocked(createDurableSessionState).mockImplementation(({ session: nextSession }) => {
    return {
      ...projectSessionState({ session: nextSession }),
      snapshot: {
        session: projectToDurableSession(nextSession),
        version: DURABLE_SESSION_VERSION,
      },
    };
  });
}

function createStubSession(): HarnessSession {
  return {
    agent: { modelReference: { id: "test" }, system: "", tools: [] },
    compaction: { recentWindowSize: 10, threshold: 100_000 },
    continuationToken: "http:proxy-test",
    history: [],
    sessionId: "parent-session",
  };
}

function createStubSessionState(): DurableSessionState {
  return {
    continuationToken: "http:proxy-test",
    emissionState: { sequence: 0, sessionStarted: false, stepIndex: 0, turnId: "" },
    hasProxyInputRequests: false,
    sessionId: "parent-session",
    version: 1,
  };
}

function buildSerializedContextForAdapter(adapter: ChannelAdapter): Record<string, unknown> {
  const bundle = {
    adapterRegistry: {
      adaptersByKind: new Map([[adapter.kind, adapter]]),
    },
    compiledArtifactsSource: {} as never,
    graph: {
      nodesByNodeId: new Map(),
      root: {
        sandboxRegistry: { sandbox: null },
        turnAgent: TestTurnAgent,
      },
    },
    hookRegistry: createEmptyHookRegistry(),
    resolvedAgent: { config: {} },
    subagentRegistry: {},
    toolRegistry: {},
    turnAgent: TestTurnAgent,
  } as never;

  vi.mocked(getCompiledRuntimeAgentBundle).mockResolvedValue(bundle);

  const ctx = new ContextContainer();
  ctx.set(AuthKey, null);
  ctx.set(BundleKey, bundle);
  ctx.set(ChannelKey, adapter);
  ctx.set(ContinuationTokenKey, "http:proxy-test");
  ctx.set(ModeKey, "conversation");
  ctx.set(SessionIdKey, "parent-session");
  return serializeContext(ctx);
}

function buildRequiredPayload(): SubagentAuthorizationEventHookPayload {
  return {
    callId: "call-1",
    childSessionId: "child-session",
    event: {
      type: "authorization.required",
      data: {
        authorization: { url: "https://idp.example.com/sign-in" },
        description: "Sign in to Linear",
        name: "linear",
        sequence: 3,
        stepIndex: 1,
        turnId: "child-turn",
        webhookUrl: "https://agent.example.com/.eve/connections/linear/child-session:auth",
      },
    },
    kind: "subagent-authorization-event",
    subagentName: "linear",
  };
}

afterEach(() => {
  workflowWritesByNamespace.clear();
  vi.restoreAllMocks();
});

describe("runProxyAuthorizationEventStep", () => {
  it("re-emits the child's event verbatim and persists adapter-state mutations", async () => {
    // The stub adapter mirrors Slack's contract: `authorization.required`
    // records a pending-auth marker on adapter state that the later
    // `authorization.completed` hop must observe across the serialized
    // context boundary.
    const handled: unknown[] = [];
    const cachingAdapter: ChannelAdapter = {
      kind: "thread-context",
      async "authorization.required"(data, adapterCtx) {
        handled.push(data);
        adapterCtx.state.pendingAuthMessageTs = { [data.name]: "123.456" };
      },
    };

    installSessionStoreMocks(createStubSession());

    const hookPayload = buildRequiredPayload();
    const result = await runProxyAuthorizationEventStep({
      hookPayload,
      parentWritable: createTestWritable(),
      serializedContext: buildSerializedContextForAdapter(cachingAdapter),
      sessionState: createStubSessionState(),
    });

    // Verbatim: the parent adapter sees the child's original event data,
    // including the child-scoped webhook URL and turn coordinates.
    expect(handled).toEqual([hookPayload.event.data]);

    const channel = result.serializedContext[ChannelKey.name] as {
      kind: string;
      state: { pendingAuthMessageTs?: Record<string, string> };
    };
    expect(channel.kind).toBe("thread-context");
    expect(channel.state.pendingAuthMessageTs).toEqual({ linear: "123.456" });

    // Auth needs no downward routing, so no proxy-entry map is recorded.
    expect(result.sessionState.hasProxyInputRequests).toBe(false);

    // Exactly one stream write even in conversation mode: unlike the HITL
    // proxy there is no `turn.completed` + `session.waiting` epilogue —
    // the parent turn is still awaiting the subagent result and the child
    // resumes autonomously after the authorization callback.
    const writes = workflowWritesByNamespace.get(DEFAULT_WORKFLOW_STREAM_NAMESPACE) ?? [];
    expect(writes).toHaveLength(1);
  });

  it("forwards authorization.completed to the adapter handler", async () => {
    const handled: Array<{ type: string; data: unknown }> = [];
    const adapter: ChannelAdapter = {
      kind: "thread-context",
      async "authorization.completed"(data) {
        handled.push({ type: "authorization.completed", data });
      },
    };

    installSessionStoreMocks(createStubSession());

    const result = await runProxyAuthorizationEventStep({
      hookPayload: {
        callId: "call-1",
        childSessionId: "child-session",
        event: {
          type: "authorization.completed",
          data: {
            name: "linear",
            outcome: "authorized",
            sequence: 7,
            stepIndex: 2,
            turnId: "child-turn",
          },
        },
        kind: "subagent-authorization-event",
        subagentName: "linear",
      },
      parentWritable: createTestWritable(),
      serializedContext: buildSerializedContextForAdapter(adapter),
      sessionState: createStubSessionState(),
    });

    expect(handled).toEqual([
      {
        type: "authorization.completed",
        data: expect.objectContaining({ name: "linear", outcome: "authorized" }),
      },
    ]);
    expect(result.sessionState.hasProxyInputRequests).toBe(false);
  });
});
