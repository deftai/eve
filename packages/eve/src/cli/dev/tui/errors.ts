/**
 * Error classification and display formatting shared by the TUI runner and
 * terminal renderer. One module owns the interrupt sentinel and the
 * failure-event projections so the two sides cannot drift apart.
 */

import type {
  SessionFailedStreamEvent,
  StepFailedStreamEvent,
  TurnFailedStreamEvent,
} from "#client/index.js";
import {
  AI_GATEWAY_ERROR_NAMES,
  AI_GATEWAY_ERROR_TYPES,
  AI_GATEWAY_INTERNAL_ERROR_NAMES,
  AI_SDK_CORE_ERROR_NAMES,
  AI_SDK_PROVIDER_ERROR_NAMES,
  EMPTY_MODEL_RESPONSE_SUMMARY_NAME,
  GATEWAY_AUTH_FAILURE_SUMMARY_NAME,
  GATEWAY_AUTHENTICATION_ERROR_NAME,
  LEGACY_AI_SDK_ERROR_NAMES,
  MODEL_PROVIDER_API_KEY_MISSING_SUMMARY_NAME,
} from "#internal/model-call-error-catalog.js";

/**
 * One of the failure events a session stream can carry. All three share the
 * same `{ code, message, details? }` payload shape — the harness emits them
 * as a cascade (`step.failed` → `turn.failed` → `session.failed` /
 * `session.waiting`) describing a single underlying failure.
 */
export type FailureStreamEvent =
  | StepFailedStreamEvent
  | TurnFailedStreamEvent
  | SessionFailedStreamEvent;

/**
 * Thrown when the user interrupts the TUI (Ctrl+C, or Ctrl+D on an empty
 * prompt). The runner treats it as a clean exit, never as a failure.
 */
export class InterruptedError extends Error {
  constructor() {
    super("Interrupted");
    this.name = "InterruptedError";
  }
}

export function interruptedError(): InterruptedError {
  return new InterruptedError();
}

export function isInterruptedError(error: unknown): boolean {
  return error instanceof InterruptedError;
}

/**
 * Recognizes errors raised by aborting an in-flight fetch/stream (e.g. the
 * subagent child-session pump being cancelled). These are expected shutdown
 * noise, not failures to surface.
 */
export function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || /\babort(?:ed)?\b/iu.test(error.message);
}

/**
 * Stable identity for one failure cascade entry. The harness emits the same
 * `{ code, message }` payload on `step.failed`, `turn.failed`, and (for
 * terminal failures) `session.failed`; keying on both lets the stream
 * translator render the underlying failure exactly once.
 */
export function failureKey(event: FailureStreamEvent): string {
  return `${event.data.code}:${event.data.message}`;
}

/**
 * One-line headline for a failure event: `code: message`, except when the
 * message already carries its own class-name prefix (e.g. a
 * `HookConflictError` whose message starts with `HookConflictError:`), in
 * which case the message stands alone instead of reading `Code: Code: …`.
 */
export function formatFailureMessage(event: FailureStreamEvent): string {
  const { code, message } = event.data;
  if (!code) return message;
  if (message === code || message.startsWith(`${code}:`) || message.startsWith(`${code} `)) {
    return message;
  }
  return `${code}: ${message}`;
}

/**
 * Extracts the diagnostic dump attached to a failure event, if any.
 *
 * `details.detail` is the `util.inspect` rendering (stack trace and cause
 * chain included) that `formatError` attaches to *unrecognized* failures —
 * i.e. code bugs escaping user code. Recognized provider/config failures
 * deliberately ship a curated summary without the dump, so this returns
 * `undefined` for them and the headline stands alone.
 */
export function formatFailureDetail(event: FailureStreamEvent): string | undefined {
  const details: unknown = event.data.details;
  if (details === null || typeof details !== "object") return undefined;
  const detail = (details as { detail?: unknown }).detail;
  if (typeof detail !== "string") return undefined;
  const trimmed = detail.trim();
  if (trimmed.length === 0 || trimmed === event.data.message.trim()) return undefined;
  return trimmed;
}

export interface ModelCallFailureNoticeOptions {
  readonly canConfigureModel?: boolean;
}

interface ModelCallFailureDetails {
  readonly gatewayName?: string;
  readonly gatewayType?: string;
  readonly name?: string;
  readonly statusCode?: number;
  readonly upstreamMessage?: string;
  readonly upstreamStatusCode?: number;
  readonly upstreamType?: string;
}

interface ModelCallFailureMappingInput {
  readonly canConfigureModel: boolean;
  readonly details: ModelCallFailureDetails;
  readonly event: FailureStreamEvent;
}

interface ModelCallFailureMapping {
  readonly matches: (input: ModelCallFailureMappingInput) => boolean;
  readonly format: (input: ModelCallFailureMappingInput) => string;
}

const MODEL_CALL_FAILURE_MAPPINGS: readonly ModelCallFailureMapping[] = [
  {
    matches: ({ event }) => isGatewayAuthFailure(event),
    format: ({ canConfigureModel, event }) =>
      formatGatewayAuthFailureNotice(event, { canConfigureModel }),
  },
  {
    matches: ({ details, event }) =>
      details.name === MODEL_PROVIDER_API_KEY_MISSING_SUMMARY_NAME ||
      details.name === LEGACY_AI_SDK_ERROR_NAMES.loadApiKey ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.loadApiKey ||
      /api key is missing/i.test(event.data.message),
    format: ({ canConfigureModel }) =>
      canConfigureModel
        ? "The model provider could not find an API key. Add it in .env.local or switch providers with /model."
        : "The model provider could not find an API key. Add the provider API key and retry.",
  },
  {
    matches: ({ details, event }) =>
      details.name === EMPTY_MODEL_RESPONSE_SUMMARY_NAME ||
      details.name === AI_SDK_CORE_ERROR_NAMES.noOutputGenerated ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.noContentGenerated ||
      /model did not return a response|no (?:output|content) generated/i.test(event.data.message),
    format: ({ canConfigureModel }) =>
      canConfigureModel
        ? "The model returned no content. Retry. If it repeats, choose another model with /model."
        : "The model returned no content. Retry. If it repeats, choose another model.",
  },
  {
    matches: ({ details, event }) =>
      textMatches(
        [details.upstreamMessage, event.data.message],
        /context|maximum token|too many tokens/i,
      ),
    format: ({ canConfigureModel }) =>
      canConfigureModel
        ? "The prompt is too large for this model. Reduce context, or choose a larger context model with /model."
        : "The prompt is too large for this model. Reduce context, or choose a larger context model.",
  },
  {
    matches: ({ details }) =>
      details.gatewayName === AI_GATEWAY_ERROR_NAMES.modelNotFound ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.modelNotFound ||
      details.upstreamType === AI_GATEWAY_ERROR_TYPES.modelNotFound ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.noSuchModel ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.noSuchProviderReference ||
      hasAnyStatus(details, 404),
    format: ({ canConfigureModel, details }) => {
      const subject = isGatewayDetails(details) ? "AI Gateway" : "The model provider";
      return canConfigureModel
        ? `${subject} could not find this model. Choose another model with /model, or update the model id in agent.ts.`
        : `${subject} could not find this model. Update the model id and retry.`;
    },
  },
  {
    matches: ({ details }) =>
      details.gatewayName === AI_GATEWAY_ERROR_NAMES.rateLimit ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.rateLimit ||
      details.upstreamType === AI_GATEWAY_ERROR_TYPES.rateLimit ||
      hasAnyStatus(details, 429),
    format: ({ canConfigureModel }) =>
      canConfigureModel
        ? "The model provider rate limited the request. Wait and retry, or choose another model with /model."
        : "The model provider rate limited the request. Wait and retry, or choose another model.",
  },
  {
    matches: ({ details, event }) =>
      details.gatewayName === AI_GATEWAY_INTERNAL_ERROR_NAMES.timeout ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.timeout ||
      details.upstreamType === AI_GATEWAY_ERROR_TYPES.timeout ||
      hasAnyStatus(details, 408, 504) ||
      /\btimeout|timed out\b/i.test(event.data.message),
    format: ({ canConfigureModel }) =>
      canConfigureModel
        ? "The model request timed out. Retry, or choose another model with /model if it keeps happening."
        : "The model request timed out. Retry, or choose another model if it keeps happening.",
  },
  {
    matches: ({ details }) =>
      details.gatewayName === AI_GATEWAY_ERROR_NAMES.forbidden ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.forbidden,
    format: () =>
      "AI Gateway rejected the request by policy. Check project access, routing policy, or model access, then retry.",
  },
  {
    matches: ({ details }) =>
      details.gatewayName === AI_GATEWAY_ERROR_NAMES.failedDependency ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.failedDependency ||
      hasAnyStatus(details, 424),
    format: ({ canConfigureModel, details }) => {
      const reason = formatUpstreamReason(details.upstreamMessage);
      return canConfigureModel
        ? `AI Gateway could not fulfill the request with the selected provider credentials${reason}. Check provider options and tools, or choose another model with /model.`
        : `AI Gateway could not fulfill the request with the selected provider credentials${reason}. Check provider options, tools, or model configuration.`;
    },
  },
  {
    matches: ({ details }) =>
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.authentication ||
      details.upstreamType === AI_GATEWAY_ERROR_TYPES.authentication ||
      hasAnyStatus(details, 401),
    format: ({ details }) =>
      isGatewayDetails(details)
        ? "AI Gateway rejected the credentials. Update AI Gateway credentials and retry."
        : "The model provider rejected credentials. Update the provider API key in .env.local, then retry.",
  },
  {
    matches: ({ details }) => hasAnyStatus(details, 403),
    format: ({ details }) =>
      isGatewayDetails(details)
        ? "AI Gateway rejected access to the request. Check project access, routing policy, or model access, then retry."
        : "The model provider rejected access to the request. Check the provider API key and model access, then retry.",
  },
  {
    matches: ({ details }) =>
      details.gatewayName === AI_GATEWAY_ERROR_NAMES.invalidRequest ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.invalidRequest ||
      details.upstreamType === AI_GATEWAY_ERROR_TYPES.invalidRequest ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.invalidArgument ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.invalidPrompt ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.unsupportedFunctionality ||
      details.name === AI_SDK_CORE_ERROR_NAMES.unsupportedModelVersion ||
      hasAnyStatus(details, 400, 413, 422),
    format: ({ details }) => {
      const subject = isGatewayDetails(details) ? "AI Gateway" : "The model provider";
      const reason = formatUpstreamReason(details.upstreamMessage);
      return `${subject} rejected the model request${reason}. Check the model, tools, and provider options, then retry.`;
    },
  },
  {
    matches: ({ details }) =>
      details.gatewayName === AI_GATEWAY_ERROR_NAMES.internalServer ||
      details.gatewayName === AI_GATEWAY_ERROR_NAMES.response ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.internalServer ||
      details.gatewayType === AI_GATEWAY_ERROR_TYPES.response ||
      details.upstreamType === AI_GATEWAY_ERROR_TYPES.internalServer ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.emptyResponseBody ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.invalidResponseData ||
      details.name === AI_SDK_PROVIDER_ERROR_NAMES.jsonParse ||
      statusAtLeast(details, 500),
    format: ({ canConfigureModel }) =>
      canConfigureModel
        ? "AI Gateway or the model provider returned a server error. Retry in a moment, or choose another model with /model if it keeps happening."
        : "AI Gateway or the model provider returned a server error. Retry in a moment, or choose another model if it keeps happening.",
  },
];

/**
 * Maps AI SDK and AI Gateway model-call failures into compact TUI recovery text.
 * The mapping keys off structured `details` fields produced by the harness, not
 * the large SDK inspector dump.
 */
export function formatModelCallFailureNotice(
  event: FailureStreamEvent,
  options: ModelCallFailureNoticeOptions = {},
): string | undefined {
  if (event.data.code !== "MODEL_CALL_FAILED") return undefined;
  const details = readModelCallFailureDetails(event.data.details);
  if (details === undefined) return undefined;

  const input: ModelCallFailureMappingInput = {
    canConfigureModel: options.canConfigureModel === true,
    details,
    event,
  };

  return MODEL_CALL_FAILURE_MAPPINGS.find((mapping) => mapping.matches(input))?.format(input);
}

/**
 * Minimal TUI rendering for a gateway-auth failure when `/model` is available
 * locally. Replaces the harness's full summary — whose remediation names CLI
 * commands and dashboard URLs — with one actionable line; the caller drops
 * the diagnostic detail along with it. The variant is picked off the summary
 * message the harness wrote, so a stale key, an expired OIDC token, and
 * missing credentials each get the fix that actually applies.
 */
export function formatGatewayAuthFailureNotice(
  event: FailureStreamEvent,
  options: ModelCallFailureNoticeOptions = {},
): string {
  const message = event.data.message;
  const canConfigureModel = options.canConfigureModel !== false;
  if (/rejected the provided API key|Invalid API key/i.test(message)) {
    return canConfigureModel
      ? "AI Gateway rejected your AI_GATEWAY_API_KEY. Run /model to refresh credentials, or update it in .env.local (a stale shell export can shadow it)."
      : "AI Gateway rejected your AI_GATEWAY_API_KEY. Update credentials and retry.";
  }
  if (/rejected the OIDC token|Invalid OIDC token/i.test(message)) {
    return canConfigureModel
      ? "Your AI Gateway OIDC token is invalid or expired. Run /model to refresh it, or set AI_GATEWAY_API_KEY in .env.local."
      : "AI Gateway rejected the OIDC token. Refresh Vercel project credentials, or set AI_GATEWAY_API_KEY.";
  }
  return canConfigureModel
    ? "There is no AI_GATEWAY_API_KEY set. Run /model to connect this to a project and refresh AI Gateway credentials, or set it manually in .env.local."
    : "AI Gateway received no credentials. Link a Vercel project or set AI_GATEWAY_API_KEY, then retry.";
}

/**
 * Recognizes a model-call failure caused by AI Gateway authentication. The
 * primary signal is the machine-readable `gatewayName` the harness merges
 * into every model-call failure's details (`extractModelCallErrorDetails`);
 * the summary name is the fallback for payloads whose gateway error was not
 * preserved on the cause chain. Both identifiers are imported from the
 * harness module that writes them, so the two sides cannot drift.
 */
export function isGatewayAuthFailure(event: FailureStreamEvent): boolean {
  const details = readModelCallFailureDetails(event.data.details);
  if (details === undefined) return false;
  return (
    details.gatewayName === GATEWAY_AUTHENTICATION_ERROR_NAME ||
    details.name === GATEWAY_AUTH_FAILURE_SUMMARY_NAME
  );
}

function readModelCallFailureDetails(details: unknown): ModelCallFailureDetails | undefined {
  if (details === null || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;
  return {
    gatewayName: readString(record, "gatewayName"),
    gatewayType: readString(record, "gatewayType"),
    name: readString(record, "name"),
    statusCode: readNumber(record, "statusCode"),
    upstreamMessage: readString(record, "upstreamMessage"),
    upstreamStatusCode: readNumber(record, "upstreamStatusCode"),
    upstreamType: readString(record, "upstreamType"),
  };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function textMatches(values: readonly (string | undefined)[], pattern: RegExp): boolean {
  return values.some((value) => value !== undefined && pattern.test(value));
}

function hasAnyStatus(details: ModelCallFailureDetails, ...statuses: readonly number[]): boolean {
  return statuses.some(
    (status) => details.statusCode === status || details.upstreamStatusCode === status,
  );
}

function statusAtLeast(details: ModelCallFailureDetails, floor: number): boolean {
  return (
    (details.statusCode !== undefined && details.statusCode >= floor) ||
    (details.upstreamStatusCode !== undefined && details.upstreamStatusCode >= floor)
  );
}

function isGatewayDetails(details: ModelCallFailureDetails): boolean {
  return details.gatewayName !== undefined || details.gatewayType !== undefined;
}

function formatUpstreamReason(message: string | undefined): string {
  if (message === undefined) return "";
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || /^bad request$/i.test(normalized)) return "";
  const truncated = normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
  return `: ${truncated.replace(/[.!?]+$/u, "")}`;
}
