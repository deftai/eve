# DurabilityBackend v1 — PRD

**Status:** Draft — awaiting approval before SPECIFICATION  
**Repo:** deftai/eve (`deft/durability-backend`)  
**Date:** 2026-07-07

## Problem statement

eve's durable execution (sessions, turns, HITL, subagent child runs, schedules) is wired directly to `@workflow/core` and Vercel-oriented build output. `experimental.workflow.world` swaps **storage** for the Workflow SDK, not the **execution engine**. The fork needs a `DurabilityBackend` seam—analogous to `SandboxBackend`—so orchestration can be tested and eventually swapped without touching the harness or `agent/` authoring model.

## Goals

1. Define **DurabilityPort** covering the full session driver surface: checkpoints, inboxes, event log, child turn jobs, schedule trigger hook.
2. Implement **vercelWorkflow()** adapter with **zero observable behavior change** vs upstream eve today.
3. Implement **inMemory()** for dev/tests via `experimental.durability.backend` in `agent.ts`.
4. Extract **SessionDriver / TurnDriver** as runtime-agnostic orchestration over the port.
5. Keep **all existing test tiers green** and add tests for new port/adapters.

## Non-goals (v1)

- `rivet()` or agentOS actors/workflows/cron
- Public author API beyond experimental field
- Replacing `experimental.workflow.world`, Nitro, channels, or sandbox backends
- Nested agentOS/Pi agents inside eve turns
- Required upstream merge to vercel/eve

## Locked decisions (interview)

| Topic              | Decision                                                    |
| ------------------ | ----------------------------------------------------------- |
| Process            | Full path → this PRD → SPECIFICATION                        |
| v1 scope           | Seam only                                                   |
| Production default | `vercelWorkflow()`                                          |
| Dev/test opt-in    | `experimental.durability.backend: inMemory()` in `agent.ts` |
| inMemory in prod   | Warn; allow with env override                               |
| Port breadth       | Full session driver primitives                              |
| Parity             | Unit + integration + scenario green; new port tests         |
| `workflow.world`   | Coexists; vercel adapter uses active world                  |
| Upstream           | Fork-first on deftai/eve                                    |

## Functional requirements

- **FR-1:** `DurabilityBackend` exposes session lifecycle, checkpoints, inboxes, event stream, child jobs, schedule hook—enough to replace direct `@workflow/core` usage in `execution/`.
- **FR-2:** `vercelWorkflow()` preserves hook conflicts, continuation tokens, `NextDriverAction`, `DurableSessionState` migrations, deployment routing, stream ordering.
- **FR-3:** `experimental.durability.backend` defaults to vercel; accepts `inMemory()`.
- **FR-4:** `inMemory()` runs in vitest unit/integration without Workflow bundler.
- **FR-5:** Public `Runtime` API unchanged.
- **FR-6:** Workflow bundle + `"use workflow"` transforms stay inside vercel adapter.

## Non-functional requirements

- **NFR-1:** No author-visible semantic change on vercel path.
- **NFR-2:** Existing unit/integration/scenario tests pass.
- **NFR-3:** Follow eve AGENTS.md (wrap deps, test public APIs, small modules).
- **NFR-4:** Production warning when `inMemory()` selected.
- **NFR-5:** No new runtime deps in `packages/eve` (nitro only).

## Success metrics

- `pnpm test:unit`, `test:integration`, `test:scenario` green
- New inMemory tests: checkpoint, inbox deliver, event stream
- vercelWorkflow parity tests on session/turn fixtures
- Docs for `experimental.durability.backend` + world coexistence
- `research/durability-backend.md` drafted for optional upstream PR

## Open questions (spec phase)

- Export path and compile manifest wiring for `experimental.durability.backend`
- Env var name for production inMemory override
- Schedule hook: full abstraction vs thin delegate to Nitro cron
- File layout under `packages/eve/src`

## Approval

Reply **approved** (or list revisions) to proceed to **SPECIFICATION** (`xbrief/specification.xbrief.json` + implementation stories).
