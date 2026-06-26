---
"eve": patch
---

Make the TypeScript client suppress duplicate and late replayed Workflow stream events while preserving the physical reconnect cursor. Stream events now carry stable logical identity and turn metadata so clients can correlate at-least-once deliveries without comparing payloads.
