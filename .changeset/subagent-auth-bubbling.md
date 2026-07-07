---
"eve": patch
---

Bubble subagent `authorization.required` and `authorization.completed` events up to the parent session's channel. Previously a subagent whose connection needed interactive OAuth parked silently — the sign-in link was written only to the child's unconsumed stream and the run hung. The events now proxy up through each delegation hop so the user can complete the sign-in; the OAuth callback still resumes the subagent directly.
