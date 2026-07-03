---
"eve": patch
---

Connection authorization events now bubble from delegated subagents to the parent channel. When a connection declared inside a subagent needs interactive sign-in, the parent channel renders the challenge (for example, Slack's ephemeral sign-in button) and resolves it on completion, instead of the events being dropped by the subagent adapter.
