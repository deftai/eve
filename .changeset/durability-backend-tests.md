---
"eve": patch
---

Add unit tests for durability compile wiring, session driver orchestration, and manifest-driven `createAgentRuntime()`. Split workflow-step runtime creation from HTTP boot so Nitro honors `experimental.durability.backend`.