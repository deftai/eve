---
"eve": patch
---

feat(eve): mounted extensions — discovery, authoring API, and compiler composition

Adds the `agent/extensions/` discovery slot (each file mounts a package under a namespace derived from its filename), the `eve/extension` authoring subpath with `defineConfig` for typed extension configuration, and compiler composition that resolves each mount to its package's agent-shaped source tree and merges the contributions into the consuming agent under `<namespace>__` names. An extension's `defineState` keys and config binding are scoped to its package namespace at build time, so identically-named state never collides across extensions and the scope holds however the consumer imports the extension's modules. Tools produced by an extension's `defineDynamic` resolver are namespaced like its static tools.
