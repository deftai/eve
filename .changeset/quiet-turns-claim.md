---
"eve": patch
---

Prevent replayed turn workflow starts from emitting duplicate prior-turn events by requiring each turn to claim execution from its session driver before running. Explicit eve session continuations now fail instead of silently starting a replacement session when delivery loses its active owner.
