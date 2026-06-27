---
"eve": patch
---

The TypeScript client now reconnects idle message streams after 30 seconds by default, resuming from the last consumed event index instead of waiting for the platform to close the stream. The default reconnect budget now tolerates more than five minutes of silent stream time, and a new `streamIdleTimeoutMs` option tunes or disables idle reconnects for `Client`, `send`, `stream`, and frontend bindings.
