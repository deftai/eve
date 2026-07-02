import { describe, expect, it } from "vitest";

import {
  createExtensionScopePlugin,
  type ExtensionScopeBundlerPlugin,
} from "#internal/bundler/extension-scope-plugin.js";

const SCOPES = [{ sourceRoot: "/pkg/crm/ext", packageNamespace: "acme-crm" }];

function plugin(): ExtensionScopeBundlerPlugin {
  const created = createExtensionScopePlugin(SCOPES);
  if (created === null) {
    throw new Error("expected a plugin for a non-empty scope set");
  }
  return created;
}

describe("createExtensionScopePlugin", () => {
  it("returns null when there are no extensions so non-extension builds are untouched", () => {
    expect(createExtensionScopePlugin([])).toBeNull();
  });

  it("redirects eve/context to a namespaced shim for extension-owned importers", () => {
    const id = plugin().resolveId("eve/context", "/pkg/crm/ext/tools/budget.ts");
    expect(id).toBe("\0eve-ext-scope:context:acme-crm");
  });

  it("redirects eve/extension to a namespaced shim for extension-owned importers", () => {
    const id = plugin().resolveId("eve/extension", "/pkg/crm/ext/config.ts");
    expect(id).toBe("\0eve-ext-scope:extension:acme-crm");
  });

  it("ignores importers outside every extension source root", () => {
    expect(plugin().resolveId("eve/context", "/app/agent/tools/local.ts")).toBeUndefined();
  });

  it("does not redirect a sibling directory that shares the source-root prefix", () => {
    expect(plugin().resolveId("eve/context", "/pkg/crm/extras/tool.ts")).toBeUndefined();
  });

  it("only intercepts the scoped framework modules", () => {
    expect(plugin().resolveId("eve/tools", "/pkg/crm/ext/tools/budget.ts")).toBeUndefined();
    expect(plugin().resolveId("zod", "/pkg/crm/ext/tools/budget.ts")).toBeUndefined();
  });

  it("never re-enters through virtual shim importers", () => {
    expect(plugin().resolveId("eve/context", "\0eve-ext-scope:context:acme-crm")).toBeUndefined();
  });

  it("bakes the namespace into the defineState shim", () => {
    const shim = plugin().load("\0eve-ext-scope:context:acme-crm");
    expect(shim?.code).toContain(`export * from "eve/context"`);
    expect(shim?.code).toContain(`__eveScopedDefineState("acme-crm" + "." + name, initial)`);
  });

  it("bakes the namespace into the defineConfig shim", () => {
    const shim = plugin().load("\0eve-ext-scope:extension:acme-crm");
    expect(shim?.code).toContain(`export * from "eve/extension"`);
    expect(shim?.code).toContain(`namespace === undefined ? "acme-crm" : namespace`);
  });

  it("passes through non-shim ids in load", () => {
    expect(plugin().load("/pkg/crm/ext/tools/budget.ts")).toBeUndefined();
  });
});
