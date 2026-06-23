---
"eve": patch
---

Add an `onEmpty` delivery policy to the Slack channel's `receive(slack, { target })`. A proactive (e.g. scheduled) run that finishes with no deliverable now suppresses by default, posts a built-in heartbeat line with `onEmpty: "heartbeat"`, or posts a custom line with `onEmpty: { heartbeat: "…" }` — so scheduled "check" tasks can stay quiet on a no-op run while still offering an opt-in liveness signal, without hand-rolling a sentinel string. Whitespace-only final messages are now also treated as empty.
