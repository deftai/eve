---
"eve": patch
---

Stream `actions.requested` as each model tool call arrives. Eligible local tools now begin after their request event instead of waiting for the model call to end, and terminal local results stream as each execution finishes.
