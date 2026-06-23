import type { StandardJSONSchemaV1 } from "#compiled/@standard-schema/spec/index.js";

import { parseJsonObject, type JsonObject } from "#shared/json.js";

const STANDARD_JSON_SCHEMA_TARGET: StandardJSONSchemaV1.Target = "draft-07";

type JsonSchemaDirection = "input" | "output";

/** Schema input accepted by eve public APIs that request structured output. */
export type OutputSchemaDefinition<TOutput = unknown> =
  | StandardJSONSchemaV1<unknown, TOutput>
  | JsonObject;

/**
 * Normalizes one Standard Schema or JSON Schema definition into plain JSON
 * Schema data that can cross eve runtime and client boundaries.
 */
export function normalizeJsonSchemaDefinition(
  value: StandardJSONSchemaV1 | Record<string, unknown> | unknown,
  direction: JsonSchemaDirection = "input",
): JsonObject {
  if (isStandardSchema(value)) {
    return parseJsonObject(
      value["~standard"].jsonSchema[direction]({
        target: STANDARD_JSON_SCHEMA_TARGET,
      }),
    );
  }

  return parseJsonObject(value);
}

/** Normalizes an optional output schema into durable, wire-safe JSON data. */
export function normalizeOutputSchemaDefinition<TOutput>(
  value: OutputSchemaDefinition<TOutput> | undefined,
): JsonObject | undefined {
  return value === undefined ? undefined : normalizeJsonSchemaDefinition(value, "output");
}

function isStandardSchema(value: unknown): value is StandardJSONSchemaV1 {
  return value !== null && typeof value === "object" && "~standard" in value;
}
