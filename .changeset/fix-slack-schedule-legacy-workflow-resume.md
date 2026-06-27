---
"eve": patch
---

Resume parked sessions created before eve's agent-scoped Workflow queues by issuing a legacy queue wake-up when the target deployment does not consume the current namespace. This restores follow-up handling for Slack threads started by scheduled runs before the queue namespace change.
