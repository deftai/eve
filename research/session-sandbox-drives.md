---
issue: https://github.com/vercel/eve/issues/508
last_updated: "2026-07-02"
status: proposed
---

# Session drives: session-owned filesystem state that survives deploys

## Summary

On the Vercel backend, session sandbox names embed the deployment id. A session that resumes on a
newer deployment derives a new sandbox name, misses the lookup, and gets a fresh sandbox built from
the template. Everything the session wrote to `/workspace` is orphaned, staged attachments first
among it (#276). In the `v` project, 55 of 1221 sessions crossed a deploy boundary this way.

The deployment scoping is correct for the sandbox itself: a deployment ships a specific template,
and resuming an old filesystem under new bootstrap output has no migration story. The fix is to
split lifetimes, not to re-scope the sandbox. Session-owned data moves onto a Vercel Sandbox drive:
named persistent storage, unique per Vercel project, mounted into a sandbox at an absolute path,
alive until explicitly deleted. The drive name derives from the session, never the deployment, so
every sandbox that serves the session mounts the same bytes.

Phase one mounts a drive at `/workspace/attachments` (`ATTACHMENTS_ROOT`). That directory is
framework-owned and append-only, so it needs no reconciliation with template seed content. A full
`/workspace` mount would make the docs' durability claim unconditionally true but requires a seed
sync policy with the template; it is a follow-up, not part of this plan.

## Authoring API

One option on the Vercel backend factory:

```ts
// agent/sandbox/sandbox.ts
import { vercel } from "eve/sandbox";

export default vercel({
  sessionDrive: "attachments", // default: false while drives are in beta
});
```

- `false` (default): today's behavior.
- `"attachments"`: mount a session-scoped drive at `/workspace/attachments`.
- `"workspace"` is reserved for the follow-up and rejected for now at compile time.

No other authored surface changes. Attachment staging already writes to `ATTACHMENTS_ROOT`, so the
pipeline gains durability without touching staging, refs, or hydration. The option is Vercel-only:
Docker and just-bash scope session state by app root, which already survives deploys, so the
backend contract does not change.

## Semantics

Drive names derive from stable session identity only:

```text
eve-vol-<sessionId>-<nodeId>
```

sanitized like sandbox session keys. Session ids are unique ULIDs, and drive names are unique per
Vercel project, so no environment or deployment component is needed. Subagents get their own drives
through `nodeId`, matching their separate sandboxes.

```text
deploy A                                 deploy B (any later deploy)

turn 1                                   turn 2 (same durable session)
`-- sandbox eve-sbx-ses-…-hash(A)-S1     `-- Sandbox.get(eve-sbx-ses-…-hash(B)-S1) -> 404
    |-- mount drive eve-vol-S1 at            `-- create from template snapshot(B)
    |   /workspace/attachments                   |-- mount drive eve-vol-S1 at
    `-- stage crayon.png onto the drive          |   /workspace/attachments
                                                 `-- hydration reads crayon.png: present
```

On sandbox create, the backend get-or-creates the drive by name and passes it in the create call's
`mounts`. A resumed sandbox keeps its mounts, so the resume path (`Sandbox.get`) needs nothing.

### Single writer

Drives are single reader, single writer. The previous deployment's sandbox can still hold the
attachment when a new deployment takes a turn:

1. Attach fails on create. The drives API lists the holding sandbox; eve stops it and retries once.
   Stopping is safe: the holder belongs to the same durable session, and one session runs one turn
   at a time.
2. If the conflict persists, eve creates the sandbox without the mount and logs a warning. The turn
   runs; missing historical bytes degrade to the text notice from #507.

### Availability

Two gates, both external:

- Drives are in private beta (Pro/Enterprise, per-team enrollment). If `sessionDrive` is configured
  but the API returns 403, eve warns once and proceeds unmounted.
- SDK support exists only in `@vercel/sandbox@2.2.0-beta.0`; eve vendors stable 2.3.0. Implementation
  waits for drives in a stable release, then the vendoring pipeline picks up the `Drive` class and
  the `mounts` create param. Vendoring the beta would drop the 2.2.x–2.3.0 fixes.

In every unavailable case the behavior is exactly today's, including the #507 degrade, so enabling
the option can never make a session worse.

### Lifecycle and cleanup

Drives persist until deleted; there is no expiration analogous to snapshot TTLs. During the beta,
storage is free and the exposure is bounded by attachment volume, so production drives are not
garbage collected in phase one. `eve dev` prunes drives tagged with its run id the same way it
prunes Docker template images. A retention policy for production drives (delete on session
termination, or prefix-scan pruning by last-attach time) is an open question tracked on #508 and
must land before `"workspace"` mounts, where drives grow unbounded.

## Non-goals

- Re-scoping session sandbox names. Deployment scoping stays.
- Preserving the source URL in `eve-sandbox:` refs and re-fetching from the channel on a hydration
  miss. Drives make that a fallback for a rarer failure (deleted drive), not the primary fix.
- `"workspace"` mounts and template seed reconciliation.

## Delivery and verification

- Unit: drive-name derivation, sanitation, and length limits; option validation.
- Integration: a mocked Vercel module asserting get-or-create plus `mounts` on session create, the
  attach-conflict stop-and-retry path, the 403 warn-once fallback, and that a second create for the
  same session passes the same drive name.
- E2E: blocked on beta enrollment for the shared Vercel project; when enrolled, extend the weather
  fixture with an eval that stages an attachment, redeploys (or simulates the deployment id change),
  and asserts the follow-up turn reads the file.
- Docs: `docs/sandbox.mdx` gains the option and corrects the durability paragraph, which today
  overpromises ("resumes as if nothing happened, even days later") without mentioning deploys.
- Changeset: patch, when the implementation lands.
