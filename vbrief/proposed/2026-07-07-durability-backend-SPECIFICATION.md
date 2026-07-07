# DurabilityBackend v1 — SPECIFICATION

**Status:** Approved (PRD approved 2026-07-07)  
**Repo:** deftai/eve · branch `deft/durability-backend`  
**Source vBRIEF:** `vbrief/specification.vbrief.json`

## Overview

Add **DurabilityBackend** — a pluggable durability engine parallel to **SandboxBackend**. v1 introduces a **DurabilityPort**, implements **vercelWorkflow()** (zero behavior change) and **inMemory()** (dev/tests), and extracts **SessionDriver** / **TurnDriver** from `workflow-entry` / `turn-workflow`. Public `Runtime` API is unchanged.

## Architecture

```
Routes / channels
       │
       ▼
  Runtime (unchanged public API)
       │
       ▼
 createRuntimeFromDurabilityBackend()
       │
       ├── vercelWorkflow()  ──► @workflow/core + workflow-bundle + World
       └── inMemory()        ──► process-local (experimental opt-in)

SessionDriver  ──► DurabilityPort
TurnDriver     ──► DurabilityPort
```

`experimental.workflow.world` **coexists**: it still selects Workflow SDK storage; `vercelWorkflow()` uses the installed World. `experimental.durability.backend` selects the engine adapter.

## DurabilityPort (eve-owned)

| Primitive | Maps from today |
|-----------|-----------------|
| `startSession` | `workflowEntry` + `start()` |
| `checkpoint` | `"use step"` boundaries / `turnStep` |
| `createInbox` / `resumeInbox` | `createHook` / `resumeHook` |
| `appendEvent` / `readEventStream` | `getWritable` / stream APIs |
| `startChildTurn` / `awaitChildTurn` | `turnWorkflow` child runs |
| `registerScheduleHandler` | v1: thin delegate — Nitro cron still hits vercel path |

## DurabilityBackend interface

```ts
interface DurabilityBackend {
  readonly name: string;
  createRuntimeBinding(input: DurabilityBackendCreateInput): DurabilityBackendBinding;
}
```

Factories: `vercelWorkflow()` (default), `inMemory(opts?)`. No sandbox-style `prewarm` — durability is session-scoped.

## Authoring API (v1)

```ts
// agent/agent.ts (root only)
import { defineAgent } from "eve";
import { inMemory } from "eve/durability";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  experimental: {
    durability: { backend: inMemory() }, // dev/tests only
    workflow: { world: "@workflow/world-local" }, // optional; coexists
  },
});
```

- Omitted → `vercelWorkflow()`
- Production + `inMemory()` → **warn** at boot unless `EVE_ALLOW_INMEMORY_DURABILITY=1`

## Module layout

| Path | Responsibility |
|------|----------------|
| `shared/durability-backend.ts` | Backend interface |
| `shared/durability-port.ts` | Port types |
| `execution/durability/session-driver.ts` | `workflow-entry` logic |
| `execution/durability/turn-driver.ts` | `turn-workflow` logic |
| `execution/durability/backends/vercel-workflow.ts` | Production adapter |
| `execution/durability/backends/in-memory.ts` | Test/dev adapter |
| `execution/durability/runtime-factory.ts` | `createRuntimeFromDurabilityBackend` |
| `public/durability/` | `inMemory()` export |

`internal/workflow-bundle/` stays; **only** `vercel-workflow.ts` imports it.

## Implementation phases

### Phase 0 — Types + inMemory + tests
- Port/backend types
- `inMemory()` with checkpoint, inbox, event log tests
- No production wiring

### Phase 1 — Extract drivers
- `SessionDriver` / `TurnDriver` as plain TypeScript
- `workflow-entry.ts` / `turn-workflow.ts` remain `"use workflow"` shells delegating to drivers with `VercelDurabilityPort`

### Phase 2 — Runtime wire-up
- `createWorkflowRuntime` → `createRuntimeFromDurabilityBackend(vercelWorkflow())`
- `pnpm test:scenario` green

### Phase 3 — Experimental author hook
- Compile `experimental.durability.backend` into manifest
- Boot warning for inMemory in production
- Export `inMemory` from `eve/durability`

### Phase 4 — Docs
- `research/durability-backend.md`
- Update `docs/concepts/execution-model-and-durability.md`
- `pnpm docs:check`

## Testing requirements

- **Existing:** unit + integration + scenario — all green, no assertion churn
- **New:** `in-memory` port tests (checkpoint, inbox conflict, stream `startIndex`)
- **New:** vercel parity integration test (`NextDriverAction` sequence on fixture)
- Always use `vitest.<tier>.config.ts`

## Invariants

- `Runtime` public API unchanged
- `STABLE_WORKFLOW_NAMES` unchanged on vercel path
- `NextDriverAction` / `DurableSessionState` wire formats unchanged
- No new `packages/eve` runtime dependencies (nitro only)
- `pnpm guard:invariants` passes

## Out of scope (v1)

- `rivet()` adapter
- Public `defineDurability` / author factories beyond experimental
- Replacing `experimental.workflow.world`
- Schedule cron transport swap

## Next step (implementation)

Promote scope: `deft scope:promote` → `deft scope:activate` on Phase 0 story, then implement with explicit **build** directive per Deft gates.