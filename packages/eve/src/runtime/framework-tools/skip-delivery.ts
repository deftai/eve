import { jsonSchema, type Tool } from "ai";

/** Stable model-visible name for the optional-delivery terminal tool. */
export const SKIP_DELIVERY_TOOL_NAME = "skip_delivery";

/**
 * Framework terminal tool exposed only when the current turn explicitly
 * allows an empty delivery.
 */
export const SKIP_DELIVERY_TOOL: Tool = {
  description:
    "Finish this turn without sending a channel message. Use only when there is nothing to report.",
  inputSchema: jsonSchema({
    additionalProperties: false,
    properties: {},
    type: "object",
  }),
};
