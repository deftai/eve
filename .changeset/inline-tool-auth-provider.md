---
"eve": patch
---

Add inline tool auth provider overloads so tools can call `ctx.getToken(provider)` and `ctx.requireAuth(provider)` without declaring a single top-level `auth`. The existing top-level tool `auth` field and no-argument tool auth accessors remain supported for compatibility, but are now deprecated in favor of inline providers.
