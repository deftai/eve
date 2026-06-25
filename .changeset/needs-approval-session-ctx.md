---
"eve": patch
---

`needsApproval` now receives `session` alongside `toolName`, `toolInput`, and `approvedTools`. Use `session.auth.current` to skip approval for schedule-triggered runs (`principalId: "eve:app"`) while still prompting when a person triggers the same tool.
