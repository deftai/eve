/**
 * Marker symbol carrying an extension config handle's bound values when the
 * handle was defined outside an extension scope (no namespace to key by). Kept
 * off the public shape so authored code interacts only through {@link
 * ExtensionConfigHandle.get}.
 */
const BOUND_VALUES = Symbol.for("eve.extension-config-bound-values");

/** Symbol carrying the extension namespace a handle was defined under. */
const CONFIG_NAMESPACE = Symbol.for("eve.extension-config-namespace");

const CONFIG_REGISTRY = Symbol.for("eve.extension-config-registry");

/**
 * Ambient namespace set by the dev/eval loader around a mount module's
 * evaluation. A mount imports its extension package cross-package, so the config
 * handle loads unbundled and the bundler's scope shim never runs on it; reading
 * this ambient value lets the mount still bind under the package namespace. The
 * shim's explicit argument always takes precedence over this fallback.
 */
const EXT_CONFIG_SCOPE = Symbol.for("eve.ext-config-scope");

function ambientConfigScope(): string | undefined {
  const scope = (globalThis as Record<symbol, unknown>)[EXT_CONFIG_SCOPE];
  return typeof scope === "string" && scope.length > 0 ? scope : undefined;
}

function configRegistry(): Map<string, Record<string, unknown>> {
  const container = globalThis as Record<symbol, unknown>;
  let registry = container[CONFIG_REGISTRY] as Map<string, Record<string, unknown>> | undefined;
  if (registry === undefined) {
    registry = new Map();
    container[CONFIG_REGISTRY] = registry;
  }
  return registry;
}

/**
 * Scalar types an extension config field may declare.
 */
export type ExtensionConfigFieldType = "string" | "number" | "boolean";

interface ExtensionConfigFieldBase {
  /** Human-readable description surfaced by `eve add` when prompting. */
  readonly description?: string;
  /** When true, the consumer must supply the field at mount. */
  readonly required?: boolean;
  /** Hint that the value is a secret so tooling stores it in env, not source. */
  readonly secret?: boolean;
}

/** String-typed config field. */
export interface StringConfigField extends ExtensionConfigFieldBase {
  readonly type: "string";
  readonly default?: string;
}

/** Number-typed config field. */
export interface NumberConfigField extends ExtensionConfigFieldBase {
  readonly type: "number";
  readonly default?: number;
}

/** Boolean-typed config field. */
export interface BooleanConfigField extends ExtensionConfigFieldBase {
  readonly type: "boolean";
  readonly default?: boolean;
}

/** One declared config field. */
export type ExtensionConfigField = StringConfigField | NumberConfigField | BooleanConfigField;

/** A map of config field name to its declaration. */
export type ExtensionConfigSchema = Readonly<Record<string, ExtensionConfigField>>;

type FieldValue<F extends ExtensionConfigField> = F extends StringConfigField
  ? string
  : F extends NumberConfigField
    ? number
    : F extends BooleanConfigField
      ? boolean
      : never;

type FieldAlwaysPresent<F extends ExtensionConfigField> = F extends { readonly required: true }
  ? true
  : F extends { readonly default: string | number | boolean }
    ? true
    : false;

/**
 * The resolved config object a tool reads via {@link ExtensionConfigHandle.get}.
 *
 * Required fields and fields with a default are always present; everything else
 * is optional.
 */
export type InferExtensionConfig<S extends ExtensionConfigSchema> = {
  readonly [K in keyof S as FieldAlwaysPresent<S[K]> extends true ? K : never]: FieldValue<S[K]>;
} & {
  readonly [K in keyof S as FieldAlwaysPresent<S[K]> extends true ? never : K]?: FieldValue<S[K]>;
};

type FieldRequired<F extends ExtensionConfigField> = F extends { readonly required: true }
  ? true
  : false;

/**
 * The config a consumer passes at the mount site. Required fields are
 * mandatory; everything else is optional.
 */
export type ExtensionConfigInput<S extends ExtensionConfigSchema> = {
  readonly [K in keyof S as FieldRequired<S[K]> extends true ? K : never]: FieldValue<S[K]>;
} & {
  readonly [K in keyof S as FieldRequired<S[K]> extends true ? never : K]?: FieldValue<S[K]>;
};

/**
 * Marker the consumer's mount file default-exports. The build reads the mount
 * statically for its package specifier; the runtime evaluates it so the call
 * binds config into the extension's scope.
 */
export interface MountedExtension {
  readonly [MOUNTED_EXTENSION]: true;
}

/**
 * Typed handle returned by {@link defineConfig}. It is the mount factory the
 * consumer calls (`crm({ apiKey })`), which binds config; tools read the bound
 * config through {@link get}; and the build reads {@link schema} to record the
 * config in the compiled artifact.
 */
export interface ExtensionConfigHandle<S extends ExtensionConfigSchema = ExtensionConfigSchema> {
  (values?: ExtensionConfigInput<S>): MountedExtension;
  readonly schema: S;
  /**
   * Returns the config bound when the extension was mounted, with declared
   * defaults applied. Throws when read outside a mounted extension.
   */
  get(): InferExtensionConfig<S>;
}

const MOUNTED_EXTENSION = Symbol.for("eve.mounted-extension");

type InternalConfigHandle<S extends ExtensionConfigSchema> = ExtensionConfigHandle<S> & {
  [BOUND_VALUES]?: Record<string, unknown>;
  [CONFIG_NAMESPACE]?: string;
};

function readBoundValues<S extends ExtensionConfigSchema>(
  handle: InternalConfigHandle<S>,
): Record<string, unknown> | undefined {
  const namespace = handle[CONFIG_NAMESPACE];
  return namespace === undefined ? handle[BOUND_VALUES] : configRegistry().get(namespace);
}

function validateSchema(schema: ExtensionConfigSchema): void {
  for (const [name, field] of Object.entries(schema)) {
    if (field.type !== "string" && field.type !== "number" && field.type !== "boolean") {
      throw new Error(
        `defineConfig field "${name}" has unsupported type "${String((field as { type: unknown }).type)}". Expected "string", "number", or "boolean".`,
      );
    }
    if (field.required === true && field.default !== undefined) {
      throw new Error(
        `defineConfig field "${name}" is both required and has a default. A required field must be supplied by the consumer, so a default is meaningless — drop one.`,
      );
    }
  }
}

/**
 * Declares an extension's typed, consumer-supplied configuration.
 *
 * Author it once at `ext/config.ts` and read it from any tool with
 * `config.get()`. `eve build` turns the schema into the factory a consumer
 * calls at mount (`crm({ apiKey })`) and records it so `eve add` can prompt.
 *
 * ```ts
 * import { defineConfig } from "eve/extension";
 * export default defineConfig({
 *   apiKey: { type: "string", secret: true, required: true },
 *   baseUrl: { type: "string", default: "https://api.acme.example" },
 * });
 * ```
 */
export function defineConfig<const S extends ExtensionConfigSchema>(
  schema: S,
  namespace?: string,
): ExtensionConfigHandle<S> {
  validateSchema(schema);

  // The extension-scope bundler plugin rewrites an extension's `eve/extension`
  // import to a shim that passes the extension's package-derived namespace here,
  // so a bundled config handle keys its binding by that namespace regardless of
  // evaluation order. A mount's config handle loads unbundled (cross-package
  // import) and so has no shim; there the dev loader sets an ambient scope we
  // fall back to. Absent both, binding falls back to the handle instance.
  const resolvedNamespace = namespace ?? ambientConfigScope();

  const handle = ((values?: ExtensionConfigInput<S>): MountedExtension => {
    bindExtensionConfig(handle, (values ?? {}) as Record<string, unknown>);
    return { [MOUNTED_EXTENSION]: true };
  }) as InternalConfigHandle<S>;

  Object.defineProperty(handle, "schema", { value: schema, enumerable: true });
  if (resolvedNamespace !== undefined && resolvedNamespace.length > 0) {
    handle[CONFIG_NAMESPACE] = resolvedNamespace;
  }
  handle.get = (): InferExtensionConfig<S> => {
    const bound = readBoundValues(handle);
    if (bound === undefined) {
      throw new Error(
        "Extension config is not bound. config.get() only works inside a mounted extension; ensure the extension was mounted through agent/extensions/.",
      );
    }
    return applyDefaults(schema, bound) as InferExtensionConfig<S>;
  };

  return handle;
}

function applyDefaults(
  schema: ExtensionConfigSchema,
  bound: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema)) {
    if (bound[name] !== undefined) {
      resolved[name] = bound[name];
    } else if (field.default !== undefined) {
      resolved[name] = field.default;
    }
  }
  return resolved;
}

/**
 * Binds consumer-supplied config into a handle at mount. Internal: the runtime
 * calls this once per mounted extension. Validates required fields and types
 * before binding.
 */
export function bindExtensionConfig<S extends ExtensionConfigSchema>(
  handle: ExtensionConfigHandle<S>,
  values: Record<string, unknown>,
): void {
  const schema = handle.schema;
  for (const [name, field] of Object.entries(schema)) {
    const value = values[name];
    if (value === undefined) {
      if (field.required === true) {
        throw new Error(`Extension config is missing required field "${name}".`);
      }
      continue;
    }
    if (typeof value !== field.type) {
      throw new Error(
        `Extension config field "${name}" expected ${field.type} but received ${typeof value}.`,
      );
    }
  }
  const internal = handle as InternalConfigHandle<ExtensionConfigSchema>;
  const namespace = internal[CONFIG_NAMESPACE];
  if (namespace === undefined) {
    internal[BOUND_VALUES] = values;
  } else {
    configRegistry().set(namespace, values);
  }
}
