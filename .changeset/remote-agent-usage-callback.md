---
"eve": patch
---

Remote agents now report their token usage back to the caller. When a `defineRemoteAgent` task completes, the terminal callback carries the run's token totals, and the caller emits a local `invoke_agent` span (`gen_ai.operation.name=invoke_agent`, `gen_ai.agent.name`, `gen_ai.usage.*`) so caller-side observability can attribute a remote agent's tokens. Usage is best-effort and optional, so older callees keep working unchanged. Both the calling agent and the remote agent must run this version for remote usage to appear.
