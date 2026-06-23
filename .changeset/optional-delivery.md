---
"eve": patch
---

Add opt-in empty channel delivery through `allowEmptyDelivery` and the model-visible `skip_delivery` tool. Skipped turns remain silent while emitting a durable `delivery.skipped` event.
