import { describe, expect, it } from "vitest";

import type { ChannelAdapter, ChannelAdapterContext } from "#channel/adapter.js";
import { buildAdapterContext } from "#channel/adapter-context.js";
import { callAdapterEventHandler } from "#channel/adapter.js";
import type { SubagentAuthorizationEventHookPayload } from "#channel/types.js";
import { ContextContainer } from "#context/container.js";
import type { CompiledBundle } from "#runtime/sessions/runtime-context-keys.js";
import { BundleKey, ChannelKey } from "#runtime/sessions/runtime-context-keys.js";
import { serializeContext } from "#context/serialize.js";
import type { HandleMessageStreamEvent } from "#protocol/message.js";
import { createRuntimeAdapterRegistry } from "#runtime/channels/registry.js";
import type { RuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { createEmptyHookRegistry } from "#runtime/hooks/registry.js";
import type { ResolvedChannelDefinition } from "#runtime/types.js";
import { SUBAGENT_ADAPTER_KIND } from "#execution/subagent-adapter.js";

/**
 * Integration coverage for subagent authorization-event proxying: the
 * upward-only pipeline that renders a child's `authorization.required` /
 * `authorization.completed` events on the parent's channel.
 *
 * Unlike the HITL proxy there is no downward routing — the challenge's
 * webhook URL targets the child's own auth hook, so the authorization
 * callback resumes the child directly. These tests pin the seam the
 * `runProxyAuthorizationEventStep` workflow step drives: the parent
 * adapter's `authorization.*` handlers observing and mutating adapter
 * state across a serialize/rehydrate boundary. Hop-by-hop forwarding
 * (subagent adapter → parent inbox → proxy step) is unit-tested in
 * `subagent-adapter.test.ts`, `workflow-steps.test.ts`, and
 * `turn-workflow.test.ts`.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Minimal synthetic bundle satisfying the runtime's `ChannelKey` codec:
 * the codec pulls `adapterRegistry` off the bundle in context and
 * rehydrates the adapter by `kind`. Every other bundle field is unused
 * by the proxy path under test.
 */
function buildMockBundle(adapters: readonly ChannelAdapter[]): CompiledBundle {
  const channels: readonly ResolvedChannelDefinition[] = adapters.map((adapter, index) => ({
    adapter,
    fetch: async () => new Response(null),
    logicalPath: `channels/mock-${index}.ts`,
    method: "POST",
    name: `mock-${index}`,
    sourceId: `channels/mock-${index}`,
    sourceKind: "module",
    urlPath: `/eve/mock-${index}`,
  }));

  return {
    adapterRegistry: createRuntimeAdapterRegistry({ channels }),
    compiledArtifactsSource: {} as RuntimeCompiledArtifactsSource,
    graph: {} as CompiledBundle["graph"],
    hookRegistry: createEmptyHookRegistry(),
    moduleMap: {} as CompiledBundle["moduleMap"],
    resolvedAgent: {} as CompiledBundle["resolvedAgent"],
    subagentRegistry: {} as CompiledBundle["subagentRegistry"],
    toolRegistry: {} as CompiledBundle["toolRegistry"],
    turnAgent: {} as CompiledBundle["turnAgent"],
  };
}

/**
 * Slack-shaped adapter for the pending-auth message lifecycle: the
 * `authorization.required` handler records a pending message marker
 * per connection name on adapter state, and `authorization.completed`
 * resolves it — mirroring how the real Slack channel edits its public
 * "waiting for sign-in" message on completion.
 */
interface AuthishState extends Record<string, unknown> {
  pendingAuthMessageTs?: Record<string, string>;
  resolvedAuthMessages?: Record<string, string>;
}

type AuthishCtx = ChannelAdapterContext<AuthishState>;

const AUTHISH_ADAPTER_KIND = "authish-mock";

function buildAuthishAdapter(): ChannelAdapter<AuthishCtx> {
  return {
    kind: AUTHISH_ADAPTER_KIND,
    "authorization.required"(data, ctx) {
      ctx.state.pendingAuthMessageTs = {
        ...ctx.state.pendingAuthMessageTs,
        [data.name]: `msg-for-${data.name}`,
      };
    },
    "authorization.completed"(data, ctx) {
      const pending = ctx.state.pendingAuthMessageTs?.[data.name];
      if (pending === undefined) {
        return;
      }
      const { [data.name]: _, ...rest } = ctx.state.pendingAuthMessageTs ?? {};
      ctx.state.pendingAuthMessageTs = rest;
      ctx.state.resolvedAuthMessages = {
        ...ctx.state.resolvedAuthMessages,
        [data.name]: `${pending}:${data.outcome}`,
      };
    },
  };
}

function buildRequiredEvent(): SubagentAuthorizationEventHookPayload["event"] {
  return {
    type: "authorization.required",
    data: {
      authorization: { displayName: "Linear", url: "https://idp.example.com/sign-in" },
      description: "Sign in to Linear",
      name: "linear",
      sequence: 3,
      stepIndex: 1,
      turnId: "child-turn",
      webhookUrl: "https://agent.example.com/.eve/connections/linear/sess-child:auth",
    },
  };
}

function buildCompletedEvent(): SubagentAuthorizationEventHookPayload["event"] {
  return {
    type: "authorization.completed",
    data: {
      name: "linear",
      outcome: "authorized",
      sequence: 7,
      stepIndex: 2,
      turnId: "child-turn",
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — pending-auth adapter-state lifecycle across a serialize boundary
// ---------------------------------------------------------------------------

describe("subagent auth proxy → adapter-state lifecycle across a serialize boundary", () => {
  it("lets the authorization.completed hop observe state written by the authorization.required hop", async () => {
    const authishAdapter = buildAuthishAdapter();
    const bundle = buildMockBundle([authishAdapter as ChannelAdapter]);

    const ctx = new ContextContainer();
    ctx.set(BundleKey, bundle);
    ctx.set(ChannelKey, authishAdapter as ChannelAdapter);

    // Hop 1: the parent renders the child's proxied
    // `authorization.required`. This is the exact emit shape
    // `runProxyAuthorizationEventStep` drives on the workflow runtime.
    const events: HandleMessageStreamEvent[] = [];
    {
      const adapter = ctx.require(ChannelKey);
      const adapterCtx = buildAdapterContext(adapter, ctx);
      events.push(await callAdapterEventHandler(adapter, buildRequiredEvent(), adapterCtx));
      // The workflow step's post-emit persistence: pin handler state
      // mutations back onto the context before serialization.
      ctx.set(ChannelKey, { ...adapter, state: { ...adapterCtx.state } });
    }

    // The serialized adapter state carries the pending marker across
    // the step boundary.
    const serialized = serializeContext(ctx);
    const serializedChannel = serialized[ChannelKey.name] as {
      readonly kind: string;
      readonly state: AuthishState;
    };
    expect(serializedChannel.kind).toBe(AUTHISH_ADAPTER_KIND);
    expect(serializedChannel.state.pendingAuthMessageTs).toEqual({ linear: "msg-for-linear" });

    // Hop 2: a fresh context rehydrated from the serialized wire shape
    // (behavior from the registry by kind, state from the wire) handles
    // the child's `authorization.completed` and must observe the marker
    // written on hop 1.
    const rehydratedAdapter: ChannelAdapter = {
      ...(authishAdapter as ChannelAdapter),
      state: serializedChannel.state,
    };
    const rehydratedCtx = new ContextContainer();
    rehydratedCtx.set(BundleKey, bundle);
    rehydratedCtx.set(ChannelKey, rehydratedAdapter);

    {
      const adapter = rehydratedCtx.require(ChannelKey);
      const adapterCtx = buildAdapterContext<AuthishCtx>(
        adapter as ChannelAdapter<AuthishCtx>,
        rehydratedCtx,
      );
      events.push(
        await callAdapterEventHandler(adapter, buildCompletedEvent(), adapterCtx as never),
      );
      expect(adapterCtx.state.pendingAuthMessageTs).toEqual({});
      expect(adapterCtx.state.resolvedAuthMessages).toEqual({
        linear: "msg-for-linear:authorized",
      });
    }

    // Both events pass through the adapter dispatch verbatim: the
    // child's turn coordinates and child-scoped webhook URL are
    // untouched, so the authorization callback still resumes the child
    // directly.
    expect(events.map((event) => event.type)).toEqual([
      "authorization.required",
      "authorization.completed",
    ]);
    const [required, completed] = events as Array<{ data: Record<string, unknown> }>;
    expect(required!.data).toMatchObject({
      name: "linear",
      turnId: "child-turn",
      webhookUrl: "https://agent.example.com/.eve/connections/linear/sess-child:auth",
    });
    expect(completed!.data).toMatchObject({
      name: "linear",
      outcome: "authorized",
      turnId: "child-turn",
    });
  });

  it("passes authorization events through unchanged when the adapter declares no auth handlers", async () => {
    // A bare adapter (no authorization.* handlers) must not block the
    // event from reaching the parent stream — `callAdapterEventHandler`
    // returns it unchanged.
    const bareAdapter: ChannelAdapter = { kind: "bare-mock" };
    const bundle = buildMockBundle([bareAdapter]);

    const ctx = new ContextContainer();
    ctx.set(BundleKey, bundle);
    ctx.set(ChannelKey, bareAdapter);

    const adapterCtx = buildAdapterContext(bareAdapter, ctx);
    const event = buildRequiredEvent();
    const transformed = await callAdapterEventHandler(bareAdapter, event, adapterCtx);

    expect(transformed).toBe(event);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — framework registry keeps the subagent adapter rehydratable
// ---------------------------------------------------------------------------

describe("subagent auth proxy → nested delegation prerequisites", () => {
  it("registers the subagent adapter kind as a framework adapter so middle hops rehydrate by kind", () => {
    // Nested chains rely on a middle child's ChannelKey rehydrating to
    // the framework subagent adapter after a step boundary: its
    // `authorization.*` handlers are what forward the event another hop
    // up (unit-tested in subagent-adapter.test.ts). If the framework
    // registration disappears, the recursion silently breaks.
    const bundle = buildMockBundle([]);
    const registered = bundle.adapterRegistry.adaptersByKind.get(SUBAGENT_ADAPTER_KIND);

    expect(registered).toBeDefined();
    expect(registered?.["authorization.required"]).toBeTypeOf("function");
    expect(registered?.["authorization.completed"]).toBeTypeOf("function");
    expect(registered?.["input.requested"]).toBeTypeOf("function");
  });
});
