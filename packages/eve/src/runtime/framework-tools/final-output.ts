import { jsonSchema, type Tool } from "ai";

import type { JsonObject } from "#shared/json.js";

/**
 * Stable model-visible name for the framework structured-output tool.
 */
export const FINAL_OUTPUT_TOOL_NAME = "final_output";

const FINAL_OUTPUT_TOOL_DESCRIPTION =
  "Deliver your final answer in the required structure by calling this tool. " +
  "Call it exactly once, when you are done; do not answer in prose.";

const OPTIONAL_DELIVERY_TOOL_DESCRIPTION =
  "Finish this turn by deciding whether to deliver a channel message. " +
  "Call this tool exactly once after completing the investigation. " +
  "Set `message` to the complete response to deliver. " +
  "Set `message` to null or an empty string when there is nothing worth reporting and no " +
  "channel message should be sent. Do not answer in prose outside this tool.";

const OPTIONAL_DELIVERY_OUTPUT_SCHEMA: JsonObject = {
  additionalProperties: false,
  properties: {
    message: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description:
        "The complete channel message to deliver, or null or an empty string to deliver nothing.",
    },
  },
  required: ["message"],
  type: "object",
};

/**
 * Builds the model-facing `final_output` tool from a lowered output schema.
 *
 * The tool has no `execute`: calling it is the terminal signal the harness
 * intercepts to surface the structured result. Its input is provider-constrained
 * to the schema during generation, exactly like every other eve tool input.
 */
export function buildFinalOutputTool(schema: JsonObject): Tool {
  return {
    description: FINAL_OUTPUT_TOOL_DESCRIPTION,
    inputSchema: jsonSchema(schema),
    outputSchema: jsonSchema(schema),
  };
}

/** Builds `final_output` as the terminal delivery decision for an opted-in turn. */
export function buildOptionalDeliveryOutputTool(): Tool {
  return {
    description: OPTIONAL_DELIVERY_TOOL_DESCRIPTION,
    inputSchema: jsonSchema(OPTIONAL_DELIVERY_OUTPUT_SCHEMA),
    outputSchema: jsonSchema(OPTIONAL_DELIVERY_OUTPUT_SCHEMA),
  };
}
