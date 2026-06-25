---
last_updated: "2026-06-25"
status: proposed
---

# MCP session continuity for stateful servers

## Summary

Some MCP servers store working context in the MCP session itself. Render's MCP server is one example:
the user first selects a Render workspace, and later tool calls operate against that selected
workspace. In eve today, that state can be lost between tool-loop iterations because MCP clients are
live step-local objects.

eve should support stateful Streamable HTTP MCP servers by preserving MCP session identity across
durable step boundaries when the server provides one, and by adding a replay layer for setup state
that must survive MCP session expiry.

The spec-native path is:

1. Capture the server's `MCP-Session-Id` from the initialization response.
2. Persist it in eve durable session state, scoped to the eve session, connection, and principal.
3. Recreate future MCP clients with that session id so subsequent HTTP requests continue the same
   MCP session.
4. If the server reports the session expired, clear the stored id, initialize a new MCP session, and
   replay durable setup state before dependent tool calls.

## Current behavior

The connection registry is stored as virtual context. It is rebuilt for each managed step because it
holds live client instances that cannot be serialized. That is correct for eve's durable execution
model, but it means the `MCPClient` created by `@ai-sdk/mcp` is not retained across durable
continuation steps.

For a normal stateless MCP server this is fine:

```text
step 0: initialize -> call tool A -> close/rebuild later
step 1: initialize -> call tool B
```

For a stateful MCP server this breaks:

```text
step 0: initialize -> set_workspace("Acme") -> result tells the model it succeeded
step 1: initialize -> list_services() -> server has no selected workspace
```

The model generally cannot call `set_workspace` and every dependent operation in the same model
step, because it needs to see tool results before deciding what to do next. Prompting the model to
"set the workspace first" therefore does not reliably fix the issue.

## Spec background

Streamable HTTP MCP defines an explicit session mechanism:

- A server may assign an `MCP-Session-Id` in the HTTP response containing the `InitializeResult`.
- If present, the client must include that header on all subsequent HTTP requests for the MCP
  session.
- If a request with a session id receives `404`, the client must start a new session without that
  session id.
- Clients that no longer need a session should send `DELETE` with the `MCP-Session-Id`, best effort.

That mechanism is the right native bridge between eve's durable session and a stateful MCP server's
own session.

## Design goals

- Preserve stateful MCP behavior across eve durable step boundaries.
- Keep live MCP clients step-local; do not try to serialize transport objects, sockets, timers, or
  pending requests.
- Scope MCP session continuity narrowly enough to avoid leaking state across conversations, users,
  or connection definitions.
- Recover cleanly when an MCP session expires or a process restarts without a live transport.
- Keep the public connection API protocol-owned; do not expose `@ai-sdk/mcp` internals.
- Make the common stateful-server case work without customer-managed MCP proxies.

## Non-goals

- Keep one physical HTTP/SSE connection open for the lifetime of an eve session.
- Support durable session ids for legacy HTTP+SSE transport, which does not provide the same
  `MCP-Session-Id` mechanism.
- Add Render-specific behavior to the generic MCP client.
- Share MCP server session state globally for app-scoped credentials. Stateful MCP sessions are
  conversation-local working context, even when the bearer token is shared.

## Durable state model

Persist MCP session state on the eve session, keyed by:

```text
connectionName + principalKey + transportKind + normalizedUrl
```

Proposed state:

```ts
interface DurableMcpSessionState {
  readonly transport: "http";
  readonly url: string;
  readonly principalKey: string;
  readonly sessionId?: string;
  readonly protocolVersion?: string;
  readonly initializedAt: number;
  readonly lastUsedAt: number;
  readonly generation: number;
}
```

`principalKey` should reuse the connection auth principal keying logic so user-scoped connections do
not collide. Even for `principalType: "app"`, the stored MCP session state should remain per eve
session so one conversation's selected workspace cannot affect another.

The state belongs in framework-owned session state, not authored `defineState`, because the runtime
must update it while creating and tearing down MCP clients.

## Runtime shape

`ConnectionRegistryImpl` can remain virtual and step-local. It should construct `McpConnectionClient`
with a durable session-state adapter:

```ts
new McpConnectionClient(connection, {
  loadSessionState(key),
  saveSessionState(key, patch),
  clearSessionState(key),
});
```

`McpConnectionClient` then creates a resumable HTTP transport that:

- accepts an optional initial `sessionId` and negotiated `protocolVersion`;
- writes the stored `MCP-Session-Id` header on every non-initialize HTTP request;
- observes the `MCP-Session-Id` returned by initialize and persists it;
- observes negotiated protocol version and persists it;
- marks `lastUsedAt` whenever a request succeeds;
- reports `404` from a request carrying `MCP-Session-Id` as session expiry.

The current `@ai-sdk/mcp` HTTP transport already tracks `mcp-session-id` internally, but that value
is private to the transport. We need one of:

1. upstream `@ai-sdk/mcp` support for `initialSessionId`, `initialProtocolVersion`,
   `onSessionIdChange`, and `onSessionExpired`; or
2. an eve-owned custom transport that implements the MCP transport interface and delegates as much
   behavior as possible to stable protocol-level primitives.

Prefer the upstream hook if it can land quickly. If not, use an eve-owned transport wrapper so eve's
runtime behavior is not blocked by private fields.

## Expiry and retry behavior

When a request using a stored MCP session id receives `404`:

1. Clear the stored MCP session id for that connection state key.
2. Close the current MCP client.
3. Create a fresh client without `MCP-Session-Id`.
4. Re-run initialize and store any new `MCP-Session-Id`.
5. Retry only operations that are safe to retry.

Safe retries:

- `tools/list`
- setup replay tools declared as idempotent by the connection replay layer

Do not automatically retry arbitrary user-requested tools after session expiry. A mutating call may
have partially executed before the transport failure surfaced. Surface a tool error unless the
runtime can prove the request did not run.

## Setup replay layer

Persisting `MCP-Session-Id` is not enough by itself. Servers can expire sessions at any time, and
eve may have to initialize a fresh MCP session after a crash or redeploy. Stateful servers need a
way to re-establish required setup state.

Add a generic connection-level replay API:

```ts
defineMcpClientConnection({
  url,
  description,
  stateful: {
    observeToolResult(ctx) {
      if (ctx.toolName === "set_workspace" && ctx.ok) {
        ctx.state.update({ workspaceName: ctx.input.workspaceName });
      }
    },
    async replay(ctx) {
      const state = ctx.state.get();
      if (state.workspaceName !== undefined) {
        await ctx.callTool("set_workspace", { workspaceName: state.workspaceName });
      }
    },
  },
});
```

The exact API should be narrower than this sketch, but it needs these semantics:

- The replay state is JSON-serializable and session-scoped.
- The runtime invokes replay after a fresh MCP session is initialized and before dependent tool
  calls.
- Replay can call only explicitly allowed setup tools for that same connection.
- Replay runs before model-visible tool execution and should not emit duplicate model-facing tool
  results.
- Replay failures surface as connection/tool failures with enough detail to tell the user how to
  recover.

For Render, the replay state would record the selected workspace and replay the workspace selection
after MCP session creation or expiry.

## Outside-framework workaround

Customers can work around the issue today with a proxy MCP server:

1. eve connects to the proxy instead of the upstream stateful MCP server.
2. The proxy stores setup state in its own database/cache.
3. eve sends a stable per-session header to the proxy.
4. The proxy replays setup state or translates stateful operations into stateless upstream API
   calls.

Example connection-side keying:

```ts
// agent/lib/render-proxy-key.ts
import { defineState } from "eve/context";

export const renderProxyKey = defineState("render.proxyKey", () => crypto.randomUUID());
```

```ts
// agent/connections/render.ts
import { defineMcpClientConnection } from "eve/connections";
import { renderProxyKey } from "../lib/render-proxy-key";

export default defineMcpClientConnection({
  url: process.env.RENDER_PROXY_MCP_URL!,
  description: "Render infrastructure tools.",
  headers: () => ({
    "x-eve-session-key": renderProxyKey.get(),
  }),
});
```

This is useful as a customer unblock, but it pushes framework-level protocol behavior into every
app. eve should own the generic MCP session continuity path.

## Test plan

Unit and integration coverage should include:

- captures `MCP-Session-Id` from initialize and persists it in session state;
- sends the stored `MCP-Session-Id` on the next durable continuation step;
- separates state by eve session, connection name, URL, transport, and principal;
- does not share app-scoped MCP session state across conversations;
- clears stored session state after a `404` response for a request that carried `MCP-Session-Id`;
- starts a fresh session without `MCP-Session-Id` after expiry;
- does not retry arbitrary mutating tool calls after expiry;
- replays declared setup state after fresh initialization;
- does not emit replay tool calls as normal model-visible `action.result` events;
- sends best-effort `DELETE` for the active Streamable HTTP session when the live client is closed;
- keeps legacy HTTP+SSE behavior unchanged.

Scenario coverage should include a fake stateful MCP server whose `list_items` tool fails until
`set_workspace` has been called in the current MCP session. The scenario should verify:

1. `set_workspace` in one model step;
2. `list_items` in a later tool-loop step;
3. same `MCP-Session-Id` observed by the server;
4. `404` expiry triggers a fresh initialize and replay before the later call.

## Rollout

1. Add the internal durable MCP session-state primitives behind no public API.
2. Add resumable Streamable HTTP transport support.
3. Add session-expiry handling for `tools/list` only.
4. Add the public replay API as experimental or behind an `experimental` field on MCP connections.
5. Document stateful MCP server behavior and the proxy workaround.
6. Promote the API once at least one real stateful MCP server, such as Render, works without a proxy.
