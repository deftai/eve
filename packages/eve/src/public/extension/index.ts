/**
 * Authoring helpers for eve extensions — reusable packages mounted into an
 * agent through `agent/extensions/`.
 *
 * @example
 * ```ts
 * import { defineConfig } from "eve/extension";
 * ```
 */

export {
  defineConfig,
  type BooleanConfigField,
  type ExtensionConfigField,
  type ExtensionConfigFieldType,
  type ExtensionConfigHandle,
  type ExtensionConfigSchema,
  type InferExtensionConfig,
  type NumberConfigField,
  type StringConfigField,
} from "#public/definitions/extension.js";
