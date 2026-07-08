---
"eve": patch
---

Add the DurabilityBackend seam (types, DurabilityPort, and in-memory adapter) as Phase 0 of execution portability. Exports `inMemory()` from `eve/durability` for dev and tests; no runtime wiring yet — the Vercel workflow path is unchanged.
