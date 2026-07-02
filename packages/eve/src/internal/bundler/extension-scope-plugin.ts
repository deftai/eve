import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/**
 * One extension's on-disk source root paired with the namespace its durable
 * state keys and config binding must be scoped to.
 */
export interface ExtensionScope {
  /** Absolute path to the extension's source root. */
  readonly sourceRoot: string;
  /** Package-derived namespace (e.g. `acme-crm`). */
  readonly packageNamespace: string;
}

const VIRTUAL_PREFIX = "\0eve-ext-scope:";

/** Framework module an extension-owned import is redirected through. */
type ScopedFrameworkModule = "eve/context" | "eve/extension";

const SCOPED_FRAMEWORK_MODULES: Record<ScopedFrameworkModule, "context" | "extension"> = {
  "eve/context": "context",
  "eve/extension": "extension",
};

interface CanonicalScope {
  readonly root: string;
  readonly packageNamespace: string;
}

/** The subset of the rolldown/rollup plugin shape this plugin implements. */
export interface ExtensionScopeBundlerPlugin {
  readonly name: string;
  resolveId(source: string, importer: string | undefined): string | undefined;
  load(id: string): { code: string; moduleType: "js" } | undefined;
}

function canonicalize(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Strips a rolldown query suffix (`?v=…`) so containment compares real paths. */
function importerPath(importer: string): string {
  const queryIndex = importer.indexOf("?");
  return canonicalize(queryIndex === -1 ? importer : importer.slice(0, queryIndex));
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function shimSource(kind: "context" | "extension", namespace: string): string {
  const ns = JSON.stringify(namespace);
  if (kind === "context") {
    // `export *` re-exports every other member; the explicit `defineState`
    // shadows the star-exported one per ESM semantics, baking the namespace
    // into the durable key regardless of evaluation order.
    return [
      `export * from "eve/context";`,
      `import { defineState as __eveScopedDefineState } from "eve/context";`,
      `export function defineState(name, initial) {`,
      `  return __eveScopedDefineState(${ns} + "." + name, initial);`,
      `}`,
      "",
    ].join("\n");
  }
  return [
    `export * from "eve/extension";`,
    `import { defineConfig as __eveScopedDefineConfig } from "eve/extension";`,
    `export function defineConfig(schema, namespace) {`,
    `  return __eveScopedDefineConfig(schema, namespace === undefined ? ${ns} : namespace);`,
    `}`,
    "",
  ].join("\n");
}

/**
 * Bundler plugin that scopes an extension's durable state and config to its
 * package namespace at bundle time.
 *
 * Any module physically under an extension's source root has its
 * `eve/context`/`eve/extension` imports redirected to a generated shim that
 * wraps `defineState`/`defineConfig` with the extension's namespace. Because the
 * namespace is baked into the bundled output — not read from ambient global
 * state during evaluation — scoping is independent of module evaluation order,
 * of how the consumer imports extension modules (including eager barrel
 * imports), and of module-instance duplication introduced by source compilation.
 *
 * Returns `null` when there are no extensions, so consumer-only builds carry no
 * extra plugin and their output is byte-identical to a non-extension build.
 */
export function createExtensionScopePlugin(
  scopes: readonly ExtensionScope[],
): ExtensionScopeBundlerPlugin | null {
  if (scopes.length === 0) {
    return null;
  }

  const canonicalScopes: CanonicalScope[] = scopes.map((scope) => ({
    root: canonicalize(scope.sourceRoot),
    packageNamespace: scope.packageNamespace,
  }));

  function namespaceForImporter(importer: string): string | undefined {
    const path = importerPath(importer);
    for (const scope of canonicalScopes) {
      if (isUnder(path, scope.root)) {
        return scope.packageNamespace;
      }
    }
    return undefined;
  }

  return {
    name: "eve-extension-scope",
    resolveId(source: string, importer: string | undefined) {
      const kind = SCOPED_FRAMEWORK_MODULES[source as ScopedFrameworkModule];
      if (kind === undefined || importer === undefined || importer.startsWith("\0")) {
        return undefined;
      }
      const namespace = namespaceForImporter(importer);
      if (namespace === undefined) {
        return undefined;
      }
      return `${VIRTUAL_PREFIX}${kind}:${namespace}`;
    },
    load(id: string) {
      if (!id.startsWith(VIRTUAL_PREFIX)) {
        return undefined;
      }
      const descriptor = id.slice(VIRTUAL_PREFIX.length);
      const separatorIndex = descriptor.indexOf(":");
      const kind = descriptor.slice(0, separatorIndex) as "context" | "extension";
      const namespace = descriptor.slice(separatorIndex + 1);
      return {
        code: shimSource(kind, namespace),
        moduleType: "js" as const,
      };
    },
  };
}
