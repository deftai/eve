---
title: "Extensions"
description: "Package tools, connections, skills, hooks, and schedules as a reusable npm package and mount it into an agent with one file."
---

An extension packages eve concepts — tools, connections, skills, instructions, hooks, schedules — as a reusable npm or local package. You author it as an agent-shaped directory, and a consumer mounts it with a single file under `agent/extensions/`. The consumer's build composes the extension's contributions into the agent under a namespace derived from the mount filename. Nothing is copied; upgrades come through the package manager.

## Authoring

An extension is an agent-shaped directory without `agent.ts` or `sandbox` — those belong to the consuming agent. Every other slot works the same as inside an agent, with names derived from paths.

```
@acme/crm/
  package.json
  ext/
    config.ts
    tools/search.ts
    connections/api.ts
    skills/triage/SKILL.md
    hooks/audit.ts
```

A tool is identical to one authored inside an agent:

```ts title="ext/tools/search.ts"
import { defineTool } from "eve/tools";
import config from "../config.js";

export default defineTool({
  description: "Search the CRM.",
  inputSchema: {
    /* ... */
  },
  async execute({ query }) {
    const { apiKey } = config.get();
    /* ... */
  },
});
```

Name tools and connections for what they do (`search`, not `crm_search`); the consumer's mount filename supplies the namespace.

### Configuration

Declare per-consumer settings once with `defineConfig`. The returned handle is both the mount factory the consumer calls and the accessor tools read through.

```ts title="ext/config.ts"
import { defineConfig } from "eve/extension";

export default defineConfig({
  apiKey: { type: "string", secret: true, required: true },
  baseUrl: { type: "string", default: "https://api.acme.example" },
});
```

Read it from any tool, hook, or connection by importing the handle and calling `config.get()`. The result is typed from the schema — required fields and fields with a default are always present, the rest optional — and declared defaults are already applied.

```ts title="ext/tools/search.ts"
import config from "../config.js";

// inside execute():
const { apiKey, baseUrl } = config.get(); // baseUrl falls back to its default
```

Config is bound once when the extension mounts and constant for the session; `config.get()` throws if called outside a mounted extension. Values that vary per caller belong in connection auth.

### State

`defineState` names are prefixed with the extension's package namespace automatically, so an extension's durable state never collides with the consumer's or another extension's. Author it exactly as in an agent — `defineState("budget", …)` — and eve scopes the key. State is keyed to the package (not the mount filename), so renaming the mount file never orphans persisted state. The scope is baked in at build time, so it holds no matter how the consumer imports the extension's modules — including an override that eagerly imports the extension's tools barrel.

## Publishing

The mount calls the extension's factory, so the package exports one. `eve build` generates it — you never hand-write it. Wire `package.json` once:

```jsonc title="package.json"
{
  "name": "@acme/crm",
  "type": "module",
  "eve": { "extension": "./ext" },
  "exports": {
    ".": "./dist/index.js",
    "./tools": "./dist/tools/index.js",
  },
  "peerDependencies": { "eve": "^x" },
  "scripts": { "build": "eve build", "prepare": "eve build" },
}
```

`eve build` emits the factory (re-exporting the config handle as `default` and the extension's short name) and named tool exports for consumer overrides. Local and workspace packages work without publishing.

## Mounting

Mount an extension with one file under `agent/extensions/`. The filename is the namespace.

```ts title="agent/extensions/crm.ts"
import { crm } from "@acme/crm";

export default crm({ apiKey: process.env.CRM_API_KEY });
```

The build resolves the package from the import, composes its contributions into the agent, and namespaces them by the mount filename: the `search` tool becomes `crm__search`, the `api` connection becomes `crm__api`. Instruction fragments append after the agent's own instructions.

### Overrides

A consumer file shadows a mounted contribution of the same name. To change one field, import the base from the extension and re-define it — its `execute` still reads the extension's scoped config:

```ts title="agent/tools/crm__search.ts"
import { search } from "@acme/crm/tools";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";

export default defineTool({ ...search, approval: always() });
```

## Limits

Per-session limits (token budgets, subagent depth) are the consuming agent's to own and are enforced on the session, so an extension's tools and schedules run within them. An extension cannot declare limits, a sandbox, or agent config.
