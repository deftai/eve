---
"eve": patch
---

Turn cancellation now propagates through active local and remote subagents, allowing parent turns to settle cleanly after descendant work is cancelled. Evals can start a cancellable turn with `startTurn()` and observe its settled result.
