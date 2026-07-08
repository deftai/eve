---
"eve": patch
---

Compile `experimental.durability.backend` into the agent manifest as `backendName`, resolve it at runtime via `createAgentRuntime()`, and emit a one-time production warning when `inMemory()` is selected unless `EVE_ALLOW_INMEMORY_DURABILITY=1` is set. Subagents cannot configure durability backends.
