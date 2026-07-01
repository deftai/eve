---
issue: TBD
last_updated: "2026-07-01"
status: proposed
---

# Mounted extensions

## Summary

An extension packages eve concepts — tools, skills, connections, instructions, hooks, schedules,
subagents — as an npm or local package. It is authored as an agent tree without agent config, so a
folder can move from an agent into an extension unchanged. A consumer mounts it with a file in
`agent/extensions/` that calls the extension's factory:

```ts
// agent/extensions/crm.ts   → namespace "crm"
import { crm } from "@acme/crm";
export default crm({ apiKey: process.env.CRM_API_KEY });
```

The extension is compiled once into eve's normal build artifact. The consumer's build composes
that compiled node into its graph, the same way it composes subagents. Nothing is copied; upgrades
go through the package manager.

This works within four constraints: discovery is path-based and never imports authored modules; a
compiled agent graph is already multi-node (root plus one node per subagent); durable state is a
process-wide name-keyed registry; per-session limits are enforced on the session, not per tool.

## Authoring

An extension is an agent-shaped directory without `agent.ts` or `sandbox`. Every other slot works
and uses the same `define*` functions, with names derived from paths.

```
@acme/crm/
  package.json
  ext/
    config.ts
    instructions/policy.md
    tools/search.ts
    tools/create_deal.ts
    connections/api.ts
    skills/triage/SKILL.md
    hooks/audit.ts
    schedules/nightly_sync.ts
    lib/http.ts
```

A tool file is identical to one inside an agent:

```ts
// ext/tools/search.ts
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

Rules that differ from authoring in an agent:

- Names are plain; the mount namespaces them. Write `search`, not `crm_search` — the consumer's
  mount filename supplies the namespace (see Importing). Reference other contributions through
  imports, not string names, so they survive namespacing.
- Config is typed and declared once in `config.ts`:

  ```ts
  import { defineConfig } from "eve/extension";
  export default defineConfig({
    apiKey: { type: "string", secret: true, required: true },
    baseUrl: { type: "string", default: "https://api.acme.example" },
  });
  ```

  `eve build` generates the factory from this and records it so `eve add` can prompt. Tools read
  config with `config.get()`. Config is bound once at mount and constant for the session;
  per-caller values belong in connection auth.

- State is auto-scoped. `defineState` names are global, so `eve build` prefixes each one in the
  extension with the package namespace (`@acme/crm` → `acme-crm.budget`). The author writes plain
  `defineState("budget", …)`. See State.
- Instructions are fragments, appended in a defined order (see Importing) or shipped as skills. An
  extension cannot own the root prompt.
- No `agent.ts`, `sandbox`, or limits. Those belong to the consuming agent; discovery rejects them
  in an extension.

Dynamic tools need nothing special: a `defineDynamic` resolver is a normal module and composes
like any other contribution.

## Publishing

The mount calls a factory, so the package exports one. `eve build` runs the same discovery and
compile an agent uses and emits eve's standard artifacts; authors don't hand-write them.

`package.json`:

```jsonc
{
  "name": "@acme/crm",
  "type": "module",
  "eve": { "extension": "./ext" },
  "exports": {
    ".": "./dist/index.js",
    "./tools": "./dist/tools/index.js",
  },
  "files": ["dist"],
  "peerDependencies": { "eve": "^x" },
  "scripts": { "build": "eve build", "prepare": "eve build" },
}
```

`eve build` emits:

- The factory (`dist/index.js`, as `default` and the extension's short name): validates config,
  binds it, returns the compiled node. Zero-config extensions take no args.
- Named tool exports (`@acme/crm/tools`) so a consumer can import a base tool and override fields.
- The compiled node: eve's normal `CompiledAgentManifest` plus module-map entries, the same format
  eve emits for any agent or subagent. There is no separate extension manifest format. Dynamic
  tools are module-backed entries here, so they compose like static ones.

Notes:

- `eve` is a peer dependency; the artifact records the supported range and mounting warns on
  mismatch.
- `eve.extension` is required. It names the source root `eve build` walks and marks the package as
  an extension.
- Local and workspace packages work without publishing; `prepare` or dev watch keeps `dist` fresh.

## Importing

```ts
// agent/extensions/crm.ts
import { crm } from "@acme/crm";
export default crm({ apiKey: process.env.CRM_API_KEY });
```

`eve add @acme/crm` installs the dependency, writes this file, and prompts for the declared config.
It also accepts a local path. Otherwise write the file yourself.

The consumer's build:

1. Reads the mount file's import specifier statically (never runs the factory) and resolves the
   package.
2. Composes the package's compiled node into the graph.
3. Namespaces every contribution by the mount filename: `crm__search`, the `crm__api` connection
   and its `crm__api__<tool>` tools, and so on. Instruction fragments join the ordered merge.
4. At runtime, runs the factory with the consumer's config and loads code through the composed
   module map.

Semantics:

- Namespacing prevents collisions. Two extensions exposing `search` become `crm__search` and
  `tavily__search`.
- A consumer file shadows a contribution of the same name. To override fields, import the base and
  re-define it; `execute` still reads the extension's scoped config:

  ```ts
  // agent/tools/crm__search.ts
  import { search } from "@acme/crm/tools";
  import { defineTool } from "eve/tools";
  import { always } from "eve/tools/approval";
  export default defineTool({ ...search, approval: always() });
  ```

  Remove a contribution with the `disableTool()` sentinel.

- Instruction order: the consumer's instructions, then extensions by sorted mount filename, then
  each extension's own order.
- Upgrades are a package-manager bump.

## Naming and type narrowing

Namespacing by filename is safe for types because `toolResultFrom(result, tool)` matches on the
definition object, not a name string: `defineTool` stamps a key, the resolver registers it against
the resolved runtime name, and the output type comes from the tool's inferred type. A consumer
holding the tool object gets a narrowed result regardless of the namespace:

```ts
import { search } from "@acme/crm/tools";
const r = toolResultFrom(actionResult, search); // matches "crm__search"
if (r) r.output; // narrowed
```

The connection path matches the `__` prefix, so `crm__api` matches `crm__api__list`.

## State

Extension tools run in the consumer's session and share its context container, which is keyed by
name. Unlike a subagent (a separate session with its own container), an extension gets no free
isolation, so a bare `defineState("budget")` would collide with the consumer's. `eve build`
prefixes each extension `defineState` with the package namespace, baked into the compiled output.
Package-derived, not mount-filename, because the name must be fixed at build for durability and
renaming a mount file must not orphan state. Mounting the same package twice shares one namespace
between instances; per-instance isolation would be a later opt-in.

## Limits and safety

Per-session limits are enforced on the session and its tree, not per tool: token budgets before
each model call, delegation depth on subagent and remote-agent calls. Extension contributions run
in the consumer's session, so they fall under these limits.

- Limits come only from the root agent's config. The compose step ignores limit config on an
  extension node; extensions have no `agent.ts` and cannot declare limits.
- Extension model calls count against the session budget; extension subagents count toward depth.
- Extension schedules spawn sessions under the consumer's limits, not fresh root budgets.

eve's token accounting covers eve-mediated model calls. A tool that calls an external LLM directly
is outside it, extension or not; route model work through eve primitives to keep it accounted.

## Non-goals (v1)

- Transitive mounting (an extension mounting another). An extension that builds on another uses an
  ordinary library dependency and re-exports under its own names. Addable later, since the node
  graph already nests.

## Open questions

1. Confirm the compose step can strip limit/sandbox/agent config from an extension node and report
   a clear error when present.
2. Confirm the build-time `defineState` prefix binding composes with Nitro bundling and leaves
   author source untouched.
3. Confirm schedule-started sessions inherit the consuming agent's limits.
4. Decide whether to warn when an extension's always-on instructions exceed a size threshold.
