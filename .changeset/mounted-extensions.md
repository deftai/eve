---
"eve": patch
---

feat(eve): mounted extensions — discovery, authoring API, and compiler composition

Adds the `agent/extensions/` discovery slot (each file mounts a package under a namespace derived from its filename), the `eve/extension` authoring subpath with `defineConfig` for typed extension configuration, and compiler composition that resolves each mount to its package's agent-shaped source tree and merges the contributions into the consuming agent under `<namespace>__` names. Runtime config binding, build-time state scoping, and the generated mount factory land in follow-ups.
