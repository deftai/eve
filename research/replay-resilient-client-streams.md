---
issue: https://github.com/vercel/workflow/issues/2376
last_updated: "2026-06-26"
status: implemented
---

# Replay-resilient client streams

## Summary

Workflow provides at-least-once execution. A completed or concurrent replay can append another copy
of a turn's events to the session stream even though the logical turn already completed. eve should
keep that physical append log for durability and diagnostics, but the TypeScript client should expose
one logical event stream.

The server must give each event a stable logical identity and attach turn coordinates to every
turn-bound event, including `session.waiting`, `session.completed`, and turn-scoped failures. The
client then consumes every physical event, advances its raw stream cursor for every event, and emits
only the first occurrence of each logical event from a not-yet-settled turn.

This is an observable-delivery guarantee, not an execution guarantee. Tools, hooks, callbacks, and
other external effects can still execute more than once and must retain their domain idempotency
requirements.

## Failure model

The durable stream's `startIndex` is a physical append offset. Today the client also treats it as a
logical turn cursor and stops at the first session boundary it reads. That fails in two ways:

- a concurrent replay interleaves duplicate events with the original execution;
- a late replay appends a completed turn after the client consumed the original, so the next
  `send()` immediately reads the stale `session.waiting` and returns the previous answer.

The referenced workflow stress run shows the second shape directly: sequential turns normally took
hundreds of milliseconds, then a turn returned in roughly 50 ms with the correct session id and the
wrong message. The same run also failed a concurrent session on Vercel. Hook ownership narrows which
executions do work, but cannot close the Workflow admission and post-completion windows tracked by
the upstream issue.

```text
physical stream                         logical client stream

turn 10 start  -----------------------> turn 10 start
turn 10 message ----------------------> turn 10 message
turn 10 complete ---------------------> turn 10 complete
session waiting ----------------------> session waiting
turn 10 start (late replay) ----------> drop: settled turn
turn 10 message (late replay) --------> drop: settled turn
session waiting (late replay) --------> drop: settled turn
turn 11 start  -----------------------> turn 11 start
...
```

## Wire contract

Extend event metadata additively:

```ts
interface HandleMessageStreamEventMeta {
  readonly at: string;
  readonly eventId: string;
  readonly turn?: {
    readonly id: string;
    readonly sequence: number;
  };
}
```

`eventId` is scoped to a session and identifies one logical event occurrence. A replay of the same
emission must reuse it; two legitimate emissions with identical payloads must have different IDs.
The ID must not be derived by serializing event data or `meta.at`.

eve owns event identity at emission sites. `HarnessEmissionState` carries the next durable event
position, and every durable step starts from that persisted position. Replaying the same step
therefore reuses event IDs, while sequential legitimate emissions advance the position. A terminal
failure outside the normal harness uses a fixed session-scoped identity.

All events emitted while a turn is active carry `meta.turn`. In particular, session boundary events
must no longer be anonymous. `session.started` remains session-scoped. A terminal infrastructure
failure that occurs before any turn starts may also remain session-scoped.

Bump the eve stream version. New clients normalize events when identity and turn metadata are
present. For legacy events, they use existing turn coordinates where available and otherwise pass
events through rather than guessing with payload hashes. Older clients ignore the additive metadata.

## Client semantics

`ClientSession`, `MessageResponse`, `ClientSession.stream()`, `EveAgentStore`, and evals all consume
the same normalizing iterator. No higher layer implements its own deduplication.

The serializable `SessionState` retains:

```ts
interface SessionState {
  readonly continuationToken?: string;
  readonly sessionId?: string;
  readonly streamIndex: number; // next physical append offset
  readonly eventCursor?: {
    readonly version: 1;
    readonly activeTurn?: { readonly id: string; readonly sequence: number };
    readonly physicalTurn?: { readonly id: string; readonly sequence: number };
    readonly settledTurnSequence?: number;
    readonly seenEventIds?: readonly string[]; // active turn only
    readonly sawSessionStarted?: boolean;
  };
}
```

For each raw event, the normalizer:

1. advances `streamIndex`, even when the event will be hidden;
2. drops session-start replay after the session start was already observed;
3. drops every event whose turn sequence is already settled;
4. drops an `eventId` already seen in the active turn;
5. emits the event and records its ID otherwise;
6. settles the turn only for a boundary carrying the active turn's coordinates.

Only active-turn IDs need retention. Once a boundary settles turn `N`, its ID set is discarded and
the sequence watermark rejects any later replay of turn `N` or an older turn. State remains bounded
by the largest active turn, and an abort or disconnect can serialize enough state to reconnect
without exposing the same events again.

`MessageResponse.result()` and iteration return normalized events. Store callbacks and public event
arrays also receive normalized events; `streamIndex` remains the only physical-log concept exposed
in session state. The default message reducer continues to upsert text, reasoning, actions, input
requests, and subagent state by their domain identities as defense in depth.

If the same `eventId` arrives with a different type or payload, the first observation wins. This
preserves deterministic client state without claiming that two nondeterministic executions produced
equivalent effects.

When a restored cursor predates `eventCursor`, or an attached stream starts at a nonzero physical
index without one, the client must first consume the prefix through that index without exposing it to
reconstruct the settled-turn watermark. It must not guess that the first event after an opaque raw
offset belongs to the requested turn.

Payload hashing is not a fallback identity scheme. Timestamps and property order make equivalent
events differ, while legitimate repeated chunks can have equal payloads. Likewise, hook-conflict
detection remains useful for reducing duplicate work but is not part of the client correctness
contract: a replay can arrive after the original hook owner has completed.

## Invariants

- Every physical event advances the physical cursor exactly once.
- A logical event is exposed at most once per restored client cursor.
- A settled turn can never terminate a later `send()`.
- Identical payloads with different event IDs are preserved.
- Reconnect, attached streams, `MessageResponse`, stores, and evals apply identical normalization.
- Memory is bounded by one active turn, independent of session length.
- Filtering never makes external side effects exactly-once.

## Delivery and verification

The implementation keeps allocation in the protocol and durable execution boundary, and keeps all
filtering in one client normalizer. Synthetic stream tests cover interleaved copies, late full-turn
replays, physical cursor advancement, reconnect restoration, equal payloads with distinct IDs, and
one-time reconstruction from a pre-v17 history. The existing sequential and concurrent Workflow
stress evals exercise the behavior in CI, where end-to-end Workflow replay is available.

Protocol and client documentation and a patch changeset ship with the implementation. Local
verification includes the full unit suite, typechecking, invariants, docs checks, and the narrow
client and workflow-entry integration suites.
