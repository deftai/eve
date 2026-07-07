---
issue: TBD
status: draft
last_updated: "2026-07-07"
---

# DurabilityBackend — runtime-agnostic execution seam

## Summary

eve couples durable sessions, turns, HITL, and subagent child runs to `@workflow/core`
(`"use workflow"`, `"use step"`, hooks, writables) in `packages/eve/src/execution/` and
`internal/workflow-bundle/`. `experimental.workflow.world` swaps Workflow SDK **storage** only.

This plan introduces **DurabilityBackend** — parallel to **SandboxBackend** — with a
**DurabilityPort** (checkpoints, inboxes, event log, child turns, schedule hook). v1 ships
**vercelWorkflow()** (zero behavior change) and **inMemory()** (dev/tests via
`experimental.durability.backend`). **SessionDriver** and **TurnDriver** hold orchestration;
adapters stay thin.

Fork implementation: deftai/eve `deft/durability-backend`. Upstream PR optional after parity proof.

## Authoring API (v1)

```ts
import { defineAgent } from "eve";
import { inMemory } from "eve/durability";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  experimental: {
    durability: { backend: inMemory() }, // optional; default vercelWorkflow()
  },
});
```

`experimental.workflow.world` coexists unchanged.

## Architecture

```
Runtime → createRuntimeFromDurabilityBackend()
              ├── vercelWorkflow() → @workflow/core + workflow-bundle
              └── inMemory()       → process-local maps/queues
SessionDriver / TurnDriver → DurabilityPort
```

## DurabilityPort primitives

| Primitive | Today |
|-----------|-------|
| `startSession` | `workflowEntry` + `start()` |
| `checkpoint` | `"use step"` / `turnStep` |
| `createInbox` / `resumeInbox` | hooks |
| `appendEvent` / `readEventStream` | writables / NDJSON |
| `startChildTurn` / `awaitChildTurn` | `turnWorkflow` |
| Schedule hook | v1 delegates to existing Nitro cron path |

## Implementation phases

1. **Types + inMemory + unit tests**
2. **Extract SessionDriver / TurnDriver**; workflow files delegate
3. **Wire runtime factory**; scenario tests green
4. **`experimental.durability.backend`** compile + prod warning
5. **Docs** + this research doc

## Invariants

- Public `Runtime` API unchanged
- `NextDriverAction`, `DurableSessionState` unchanged on vercel path
- No new runtime deps in `packages/eve`
- All unit/integration/scenario tiers green + new port tests

## Non-goals (v1)

- Rivet/agentOS actors/workflows/cron adapter
- Public author API beyond experimental field
- Replacing Nitro, channels, sandbox backends

## Related

- `docs/concepts/execution-model-and-durability.md`
- `shared/sandbox-backend.ts` (precedent)
- `experimental.workflow.world` (storage axis)