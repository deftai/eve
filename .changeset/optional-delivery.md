---
"eve": patch
---

Add opt-in empty channel delivery through `allowEmptyDelivery`. Opted-in turns buffer their final delivery decision, remaining silent when there is nothing to report while emitting a durable `delivery.skipped` event.
