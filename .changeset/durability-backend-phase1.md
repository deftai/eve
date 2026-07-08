---
"eve": patch
---

Extract SessionDriver and TurnDriver as plain orchestration modules backed by DurabilityPort, with a Vercel Workflow adapter and thin `workflowEntry` / `turnWorkflow` entrypoints. No runtime factory wiring yet — Vercel path behavior is unchanged.
