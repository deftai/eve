---
issue: TBD
status: implemented
last_updated: "2026-07-07"
---

# DurabilityBackend — runtime-agnostic execution seam

## Summary

eve couples durable sessions, turns, HITL, and subagent child runs to `@workflow/core`
(`"use workflow"`, `"use step"`, hooks, writables) in `packages/eve/src/execution/` and
`internal/workflow-bundle/`. `experimental.workflow.world` swaps Workflow SDK **storage** only.

This plan introduces **DurabilityBackend** — parallel to **SandboxBackend** — with a
**DurabilityPort** (checkpoints, inboxes, event log, child turns, schedule hook). v1 ships
**vercelWorkflow()** (zero behavior change on the production path) and compiles
**inMemory()** behind `experimental.durability.backend`. **SessionDriver** and **TurnDriver**
hold orchestration; adapters stay thin.

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

`experimental.workflow.world` coexists unchanged on the `vercelWorkflow()` path.

## Architecture

```
Runtime → createAgentRuntime()
              ├── vercelWorkflow() → @workflow/core + workflow-bundle
              └── inMemory()       → port + drivers (channel Runtime deferred)
SessionDriver / TurnDriver → DurabilityPort
```

## DurabilityPort primitives

| Primitive                           | Today                                    |
| ----------------------------------- | ---------------------------------------- |
| `startSession`                      | `workflowEntry` + `start()`              |
| `checkpoint`                        | `"use step"` / `turnStep`                |
| `createInbox` / `resumeInbox`       | hooks                                    |
| `appendEvent` / `readEventStream`   | writables / NDJSON                       |
| `startChildTurn` / `awaitChildTurn` | `turnWorkflow`                           |
| Schedule hook                       | v1 delegates to existing Nitro cron path |

## Implementation phases

| Phase | Scope                                                                    | Status                 |
| ----- | ------------------------------------------------------------------------ | ---------------------- |
| 0     | Types, `inMemory()` port, unit tests                                     | Done                   |
| 1     | Extract SessionDriver / TurnDriver; workflow shells delegate             | Done                   |
| 2     | `createRuntimeFromDurabilityBackend`; export `vercelWorkflow()`          | Done                   |
| 3     | Compile `experimental.durability.backend`; prod warning; manifest wiring | Done                   |
| 4     | Published docs + this research doc                                       | Done                   |
| —     | In-process channel `Runtime` for `inMemory()`                            | **Deferred** (post–v1) |

## Deferred: in-memory channel Runtime

`inMemory()` implements **DurabilityPort** and passes driver-level unit tests, but v1 does
not connect it to the channel `Runtime` (`run`, `deliver`, `getEventStream`). Authors who
compile `inMemory()` for HTTP-serving agents hit a boot-time error; production logs a
one-time warning unless `EVE_ALLOW_INMEMORY_DURABILITY=1` is set.

Follow-up work: implement `createInMemoryRuntime()`, flip the `runtime-factory` branch, and
add a scenario test that boots an agent with `inMemory()` and exercises the public session API
without the Workflow bundler.

## Invariants

- Public `Runtime` API unchanged on the `vercelWorkflow()` path
- `NextDriverAction`, `DurableSessionState` unchanged on vercel path
- No new runtime deps in `packages/eve`
- All unit/integration/scenario tiers green + new port tests

## Non-goals (v1)

- Rivet/agentOS actors/workflows/cron adapter
- Public author API beyond experimental field
- Replacing Nitro, channels, sandbox backends
- In-memory channel `Runtime`

## Related

- `docs/concepts/execution-model-and-durability.md`
- `docs/agent-config.md` (durability backend section)
- `shared/sandbox-backend.ts` (precedent)
- `experimental.workflow.world` (storage axis)
