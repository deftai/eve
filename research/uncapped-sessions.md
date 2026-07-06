---
issue: https://github.com/vercel/eve/issues/551
last_updated: "2026-07-02"
status: proposed
---

# Uncapped sessions and caller-scoped run budgets

## Summary

Sessions are uncapped by default. No framework-chosen constant may terminate a
durable session: not cumulative tokens, not model-call counts. Durability is
eve's differentiator, and a monotonic counter ending in `session.failed` gives
every long-lived session a built-in expiration date that destroys exactly the
accumulated context durability exists to preserve.

Limits still exist, but they change shape along three axes:

- **chosen by the caller** who has context to price the work, never defaulted
  by the framework;
- **scoped to a run** (one turn, one scheduled run, one delegated task), never
  to the session;
- **recoverable** where a human can continue, terminal only for the run.

Removed: `limits.maxInputTokensPerSession`, `limits.maxOutputTokensPerSession`,
their 40M/5M defaults, and the `SESSION_TOKEN_LIMIT_REACHED` failure path.
Kept: `limits.maxSubagentDepth` (recursion depth is structural, not a workload
guess). Added: an opt-in `budget` on `send()`, schedule definitions, and
subagent definitions.

## Why the token limit fails every job

- **Runaway breaker:** a stuck tool loop at ~180k tokens per call makes ~220
  calls before tripping 40M. Hours of spend before the framework reacts.
- **Cost cap:** output tokens cost ~5x input and are uncapped by default;
  cache reads count at full weight; a user routes around the whole thing with
  a new session.
- **Lifecycle policy:** it contradicts the product. The politeness fix in
  #527 (a final chat message at the wall) is a symptom: a wall that needs a
  goodbye message is a wall legitimate users hit.

A per-turn step cap (`maxModelCallsPerTurn`, the control other harnesses ship)
fails the same test. Any N is too low for a legitimate 300-call deep-agent turn
and too high to catch an agent re-calling the same tool since call 5. Runaway
is not "many calls"; it is "calls without progress", and count is a poor proxy.

## Authoring API

### Budget shape

```ts
interface RunBudget {
  /** Provider-reported cost this run may spend, in USD. */
  readonly maxCostUsd?: number;
  /** Active execution time for this run. Parked waits do not count. */
  readonly maxDurationMs?: number;
}
```

Cost is the primary unit because it is the actual harm and is now measurable
per call from AI Gateway cost metadata (#511). Tokens and call counts are not
budget units; both are proxies the caller cannot ground.

### Attachment points

The budget attaches where intent lives, and only restricts, so it needs no
authorization beyond the caller's existing auth:

- **`send()` / HTTP send:** `budget` option; applies to the turn this send
  starts.
- **Schedule definitions:** `budget` field; applies to each scheduled run.
- **Subagent definitions:** `budget` field; applies to each delegated task
  run (the whole child session).

A parent's budget does not subdivide automatically across children. A
delegated child runs under its own authored budget if one exists; the parent's
meter still counts the child's cost against the parent's run, because the
parent paid for the delegation.

### Agent config

`defineAgent({ limits })` keeps only `maxSubagentDepth`. The token fields are
removed with no fallback; persisted sessions carrying old `limits` drop them on
hydration (pre-1.0, no legacy path).

## Semantics

### Metering

The turn-usage accumulator already tracks per-turn `costUsd` from gateway
metadata. The budget check runs where the token-limit check runs today: at the
step boundary, before the next model call. The call that crosses the budget is
allowed to finish, because providers report exact cost only after a call
completes. Delegated child cost reaches the parent's meter through the
existing subagent result path.

When a model call reports no cost (direct provider, no gateway), the meter
emits one warning event for the run and keeps enforcing on whatever cost is
reported. A budget on a wholly cost-blind model is documented as unenforced.

### Exhaustion

```text
send({ budget }) ─ starts turn T
schedule run    ─ starts task run R        exhaustion check: each step boundary
subagent call   ─ starts child task run C

conversation turn T over budget
`-- emit message.completed  ("This request reached its budget. Send a
|                             follow-up to continue.")
`-- step.failed -> turn.failed   code: RUN_BUDGET_EXHAUSTED
`-- session.waiting              session lives; next send gets its own budget

task run R / C over budget
`-- step.failed -> turn.failed -> session.failed   (task session is the run)
`-- isError output to the caller carrying the budget message
```

The #527 pattern generalizes and becomes an invariant: any budget or limit
stop must emit one chat-visible message before its failure cascade. Surfaces
that render only `message.*` events never end silently.

Exhaustion is cooperative, like cancellation (#494): in-flight tool calls and
sandbox work settle at the boundary; nothing rolls back completed side
effects.

### What protects an unbudgeted session

Removing defaults means an agent with no authored budgets is bounded only by:

- the **gateway/key budget**, the one cap a new session cannot route around,
  and where cross-session spend actually aggregates;
- **cancellation** (#494) for watched runs;
- **cost observability** (`$eve.cost_usd` span attributes, stream events) so a
  runaway is visible before it is expensive.

This trade is accepted deliberately. Between "a bug can spend the whole
gateway budget overnight" and "durable sessions have a built-in expiration
date", the current framework chooses the second; this proposal chooses the
first and makes the gateway budget a documented setup requirement.

## Out of scope

- **Non-progress detection** (same tool, same input, same result N times) is
  the honest in-harness runaway guard because its constant describes sameness,
  not workload scale. It deserves its own proposal.
- Cross-session or per-principal budget aggregation inside eve. That is the
  gateway's job.

## Delivery and verification

Remove the token-limit config, defaults, check, and failure path; add the
budget plumbing behind the three attachment points; carry budget state on the
run, not the session. Update `docs/agent-config.md` (uncapped sessions as a
stated property, gateway budget as the backstop) and the schedules/subagents
docs for the new field. Minor changeset: this breaks the public `limits` API.

Tests: unit coverage for the meter and exhaustion boundaries; scenario
coverage for a budgeted `send()` ending in `session.waiting` with the chat
message; an e2e eval on a fixture schedule with a deliberately tiny budget
proving the run fails with `RUN_BUDGET_EXHAUSTED` while the agent stays
deployable and a follow-up conversation session remains usable.
