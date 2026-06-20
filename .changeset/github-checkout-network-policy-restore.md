---
"eve": patch
---

GitHub checkout now scopes its broker network policy to the fetch window and restores the session's prior policy afterward. `SandboxSession` exposes `getNetworkPolicy()` so callers can read the effective policy tracked by the session handle.
