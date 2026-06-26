import { asSchema, type JSONValue, type ToolSet, tool } from "ai";

import type { SessionCapabilities } from "#channel/types.js";
import type { RuntimeModelReference } from "#runtime/agent/bootstrap.js";
import { ASK_QUESTION_TOOL_NAME } from "#runtime/framework-tools/ask-question.js";
import { WEB_SEARCH_TOOL_DEFINITION } from "#runtime/framework-tools/web-search.js";
import { isObject } from "#shared/guards.js";
import { parseJsonValue, type JsonValue } from "#shared/json.js";
import type { HarnessToolDefinition } from "#harness/execute-tool.js";
import type { EagerToolExecutionGate } from "#harness/eager-tool-execution-gate.js";
import { resolveWebSearchBackend, resolveWebSearchProviderTool } from "#harness/provider-tools.js";
import type { HarnessToolMap } from "#harness/types.js";
import { loadContext } from "#context/container.js";
import {
  authorizationPendingModelText,
  isAuthorizationPendingModelOutput,
  isAuthorizationSignal,
  modelFacingAuthorizationOutput,
} from "#harness/authorization.js";
import { stashToolInterrupt } from "#harness/tool-interrupts.js";
import { withToolOutputSerializationError } from "#harness/tool-output-serialization.js";

type ToolModelOutputValue =
  | { readonly type: "json"; readonly value: JSONValue }
  | { readonly type: "text"; readonly value: string };

/**
 * Builds an AI SDK `ToolSet` from unified harness tool definitions.
 *
 * Tools without `execute` are surfaced to the model as client-side tools
 * (no server execution).
 *
 * The framework's `ask_question` tool is only exposed to the model when
 * {@link SessionCapabilities.requestInput} is `true`. Sessions without
 * the HITL capability (scheduled task roots and any subagent chain
 * descending from one) never see the tool.
 *
 * Entries listed in `disabledProviderTools` are skipped entirely. Used
 * by the harness recovery path when a gateway fallback provider has
 * rejected a provider-specific tool — the tool is dropped for the
 * retry call so the request can proceed without it.
 */
export function buildToolSet(input: {
  readonly approvedTools?: ReadonlySet<string>;
  readonly capabilities?: SessionCapabilities;
  readonly disabledProviderTools?: ReadonlySet<string>;
  readonly eagerToolExecutionGate?: EagerToolExecutionGate;
  readonly tools: HarnessToolMap;
}): ToolSet {
  const tools: Record<string, ToolSet[string]> = {};
  const canRequestInput = input.capabilities?.requestInput === true;
  const disabled = input.disabledProviderTools;

  for (const definition of input.tools.values()) {
    if (definition.name === ASK_QUESTION_TOOL_NAME && !canRequestInput) {
      continue;
    }

    if (disabled?.has(definition.name)) {
      continue;
    }

    const authorToModelOutput = definition.toModelOutput;
    const execute = wrapToolExecute(definition);
    const needsApproval = buildNeedsApprovalFn(definition, input);
    const eagerExecution =
      execute === undefined
        ? undefined
        : createEagerLocalToolExecution({
            execute,
            eagerToolExecutionGate: input.eagerToolExecutionGate,
            inputSchema: definition.inputSchema,
            needsApproval,
          });
    tools[definition.name] = tool({
      description: definition.description,
      execute: eagerExecution?.execute,
      inputSchema: definition.inputSchema,
      needsApproval: eagerExecution?.needsApproval ?? needsApproval,
      ...(eagerExecution === undefined
        ? {}
        : { onInputAvailable: eagerExecution.onInputAvailable }),
      outputSchema: definition.outputSchema,
      ...(definition.execute !== undefined
        ? {
            toModelOutput: async ({
              output,
              toolCallId,
            }: {
              readonly output: unknown;
              readonly toolCallId?: string;
            }) => {
              if (isAuthorizationPendingModelOutput(output)) {
                return {
                  type: "text" as const,
                  value: authorizationPendingModelText(output.connections),
                };
              }
              if (authorToModelOutput !== undefined) {
                return normalizeToolModelOutput({
                  output: await authorToModelOutput(output),
                  toolCallId,
                  toolName: definition.name,
                });
              }
              if (typeof output === "string") {
                return { type: "text" as const, value: output };
              }
              return normalizeToolModelOutput({
                output: { type: "json" as const, value: output ?? null },
                toolCallId,
                toolName: definition.name,
              });
            },
          }
        : authorToModelOutput !== undefined
          ? {
              toModelOutput: async ({
                output,
                toolCallId,
              }: {
                readonly output: unknown;
                readonly toolCallId?: string;
              }) =>
                normalizeToolModelOutput({
                  output: await authorToModelOutput(output),
                  toolCallId,
                  toolName: definition.name,
                }),
            }
          : {}),
    });
  }

  return tools as ToolSet;
}

/**
 * Builds a ToolSet from an ordered list of harness definitions.
 *
 * The first definition for a name wins, matching the dynamic-tool scope
 * ordering where step tools override turn/session tools.
 */
export function buildToolSetFromDefinitions(input: {
  readonly approvedTools?: ReadonlySet<string>;
  readonly capabilities?: SessionCapabilities;
  readonly disabledProviderTools?: ReadonlySet<string>;
  readonly eagerToolExecutionGate?: EagerToolExecutionGate;
  readonly tools: readonly HarnessToolDefinition[];
}): ToolSet {
  const tools = new Map<string, HarnessToolDefinition>();
  for (const definition of input.tools) {
    if (!tools.has(definition.name)) {
      tools.set(definition.name, definition);
    }
  }
  return buildToolSet({
    approvedTools: input.approvedTools,
    capabilities: input.capabilities,
    disabledProviderTools: input.disabledProviderTools,
    eagerToolExecutionGate: input.eagerToolExecutionGate,
    tools,
  });
}

/**
 * Wraps a tool's `execute` so a returned {@link AuthorizationSignal} is
 * stashed out-of-band ({@link stashToolInterrupt}) for the park detector while
 * the AI SDK records an opaque {@link AuthorizationPendingModelOutput} that
 * omits OAuth URLs, user codes, and hook URLs from model-facing history.
 * Returns `undefined` for client-side tools (no `execute`).
 */
export function wrapToolExecute(
  definition: HarnessToolDefinition,
): ((input: any, options: { readonly toolCallId: string }) => Promise<any>) | undefined {
  const execute = definition.execute;
  if (execute === undefined) return undefined;
  return async (input, options) => {
    const output = await execute(input);
    if (isAuthorizationSignal(output)) {
      stashToolInterrupt(loadContext(), options.toolCallId, output);
      return modelFacingAuthorizationOutput(output);
    }
    return normalizeToolJsonOutput({
      boundary: "execute",
      output,
      toolCallId: options.toolCallId,
      toolName: definition.name,
    });
  };
}

type LocalToolExecute = NonNullable<ReturnType<typeof wrapToolExecute>>;

type EagerToolExecutionResult =
  | { readonly status: "fulfilled"; readonly value: unknown }
  | { readonly error: unknown; readonly status: "rejected" };

/**
 * Starts an auto-approved local tool when the model has supplied its complete
 * input, then lets the AI SDK await the same execution at model-call end.
 *
 * AI SDK invokes `onInputAvailable` before its normal execution transform.
 * The cached outcome gives that transform its usual result or error without
 * running the local executor twice. Approval is evaluated through the same
 * memoized function in both phases, so a gated tool never starts early.
 */
function createEagerLocalToolExecution(input: {
  readonly execute: LocalToolExecute;
  readonly eagerToolExecutionGate?: EagerToolExecutionGate;
  readonly inputSchema: HarnessToolDefinition["inputSchema"];
  readonly needsApproval: (toolInput: unknown) => Promise<boolean>;
}): {
  readonly execute: LocalToolExecute;
  readonly needsApproval: (toolInput: unknown) => Promise<boolean>;
  readonly onInputAvailable: (options: {
    readonly input: unknown;
    readonly toolCallId: string;
  }) => Promise<void>;
} {
  const approvalsByInput = new Map<unknown, Promise<boolean>>();
  const executionsByCallId = new Map<string, Promise<EagerToolExecutionResult>>();

  const needsApproval = (toolInput: unknown): Promise<boolean> => {
    const cachedApproval = approvalsByInput.get(toolInput);
    if (cachedApproval !== undefined) return cachedApproval;

    const approval = input.needsApproval(toolInput);
    approvalsByInput.set(toolInput, approval);
    return approval;
  };

  const startExecution = (toolInput: unknown, toolCallId: string) => {
    const cachedExecution = executionsByCallId.get(toolCallId);
    if (cachedExecution !== undefined) return cachedExecution;

    const execution = input.execute(toolInput, { toolCallId }).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );
    executionsByCallId.set(toolCallId, execution);
    return execution;
  };

  const waitForActionRequest = async (toolCallId: string): Promise<void> => {
    await input.eagerToolExecutionGate?.waitForActionRequest(toolCallId);
  };

  return {
    async execute(toolInput, options) {
      await waitForActionRequest(options.toolCallId);
      const result = await startExecution(toolInput, options.toolCallId);
      if (result.status === "rejected") throw result.error;
      return result.value;
    },
    needsApproval,
    async onInputAvailable({ input: toolInput, toolCallId }) {
      if (!(await hasValidEagerToolInput(toolInput, input.inputSchema))) return;
      if (await needsApproval(toolInput)) return;

      void waitForActionRequest(toolCallId).then(() => startExecution(toolInput, toolCallId));
    },
  };
}

async function hasValidEagerToolInput(
  toolInput: unknown,
  inputSchema: HarnessToolDefinition["inputSchema"],
): Promise<boolean> {
  // The SDK invokes `onInputAvailable` even for an invalid tool-call part.
  // Object-only eager dispatch is deliberately conservative: it preserves the
  // normal executor for exotic primitive/array schemas rather than risking an
  // execution the SDK would reject.
  if (!isObject(toolInput)) return false;

  const validate = asSchema(inputSchema).validate;
  if (validate === undefined) return true;

  try {
    return (await validate(toolInput)).success;
  } catch {
    return false;
  }
}

function normalizeToolJsonOutput(input: {
  readonly boundary: "execute" | "toModelOutput";
  readonly output: unknown;
  readonly toolCallId?: string;
  readonly toolName: string;
}): JsonValue {
  const candidate = input.output === undefined ? null : input.output;

  return withToolOutputSerializationError(input, () => {
    parseJsonValue(candidate);
    return candidate as JsonValue;
  });
}

function normalizeToolModelOutput(input: {
  readonly output: unknown;
  readonly toolCallId?: string;
  readonly toolName: string;
}): ToolModelOutputValue {
  return withToolOutputSerializationError(
    {
      boundary: "toModelOutput",
      toolCallId: input.toolCallId,
      toolName: input.toolName,
    },
    () => {
      if (input.output === null || typeof input.output !== "object") {
        throw new TypeError("Expected a tool model output object.");
      }

      const output = input.output as { readonly type?: unknown; readonly value?: unknown };

      if (output.type === "text") {
        if (typeof output.value !== "string") {
          throw new TypeError('Expected text model output to include a string "value".');
        }

        return { type: "text", value: output.value };
      }

      if (output.type === "json") {
        return {
          type: "json",
          value: normalizeToolJsonOutput({
            boundary: "toModelOutput",
            output: output.value,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
          }) as JSONValue,
        };
      }

      throw new TypeError('Expected tool model output type to be "text" or "json".');
    },
  );
}

/**
 * Builds the AI SDK ToolSet for one harness step.
 *
 * Most tools have local executors and are assembled by {@link buildToolSet}.
 * Provider-managed tools (e.g. web_search) have no local `execute` — the
 * execution layer intentionally omits it. This function detects the gap and
 * injects the real AI SDK provider tool in their place.
 * If the current model cannot supply that provider tool, the framework
 * sentinel is removed instead of being exposed as an unexecutable tool.
 *
 * When a user overrides a provider-managed tool via `defineTool()`, their
 * tool has a real executor and flows through the normal path — no
 * replacement occurs.
 *
 * Tool names listed in `disabledProviderTools` are skipped entirely —
 * both the framework definition and the injected provider tool are
 * omitted from the returned set. Used by the harness recovery path when
 * a gateway fallback provider has rejected a provider-specific tool.
 */
export async function buildToolSetWithProviderTools(input: {
  readonly approvedTools?: ReadonlySet<string>;
  readonly capabilities?: SessionCapabilities;
  readonly disabledProviderTools?: ReadonlySet<string>;
  readonly eagerToolExecutionGate?: EagerToolExecutionGate;
  readonly modelReference: RuntimeModelReference;
  readonly tools: HarnessToolMap;
}): Promise<ToolSet> {
  const disabled = input.disabledProviderTools;
  const tools: ToolSet = {
    ...buildToolSet({
      approvedTools: input.approvedTools,
      capabilities: input.capabilities,
      disabledProviderTools: disabled,
      eagerToolExecutionGate: input.eagerToolExecutionGate,
      tools: input.tools,
    }),
  };

  // Inject the real provider tool for web_search when the definition has
  // no local execute (i.e. the framework definition uses the provider sentinel).
  if (!disabled?.has(WEB_SEARCH_TOOL_DEFINITION.name)) {
    const webSearchTool = input.tools.get(WEB_SEARCH_TOOL_DEFINITION.name);
    if (webSearchTool !== undefined && webSearchTool.execute === undefined) {
      const backend = resolveWebSearchBackend(input.modelReference);
      if (backend === null) {
        delete tools[WEB_SEARCH_TOOL_DEFINITION.name];
      } else {
        tools[WEB_SEARCH_TOOL_DEFINITION.name] = await resolveWebSearchProviderTool(backend);
      }
    }
  }

  return tools;
}

function buildNeedsApprovalFn(
  definition: HarnessToolDefinition,
  input: { readonly approvedTools?: ReadonlySet<string> },
): (toolInput: unknown) => Promise<boolean> {
  return async (toolInput: unknown) => {
    if (definition.needsApproval === undefined) return false;

    const toolInputRecord = isObject(toolInput) ? toolInput : undefined;

    return definition.needsApproval({
      approvedTools: input.approvedTools ?? new Set(),
      toolInput: toolInputRecord,
      toolName: definition.name,
    });
  };
}
