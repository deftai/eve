---
"eve": patch
---

Wire `createWorkflowRuntime` through `createRuntimeFromDurabilityBackend` with `vercelWorkflow()` as the default backend. Export `vercelWorkflow()` from `eve/durability`; in-memory runtime wiring remains Phase 3.