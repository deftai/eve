import { describe, expect, it } from "vitest";

import type { StepFailedStreamEvent } from "#client/index.js";
import {
  AI_GATEWAY_ERROR_NAMES,
  AI_GATEWAY_PUBLIC_ERROR_NAMES,
} from "#internal/model-call-error-catalog.js";

import {
  formatGatewayAuthFailureNotice,
  formatModelCallFailureNotice,
  isGatewayAuthFailure,
} from "./errors.js";

function stepFailed(
  details?: Record<string, unknown>,
  message = "model call failed",
): StepFailedStreamEvent {
  const data: Record<string, unknown> = {
    code: "MODEL_CALL_FAILED",
    message,
    sequence: 0,
    stepIndex: 0,
    turnId: "t0",
  };
  if (details !== undefined) data.details = details;
  return { type: "step.failed", data } as StepFailedStreamEvent;
}

describe("isGatewayAuthFailure", () => {
  it("matches the machine-readable gatewayName the harness merges into details", () => {
    expect(isGatewayAuthFailure(stepFailed({ gatewayName: "GatewayAuthenticationError" }))).toBe(
      true,
    );
  });

  it("falls back to the config-summary name", () => {
    expect(isGatewayAuthFailure(stepFailed({ name: "AI Gateway authentication failed" }))).toBe(
      true,
    );
  });

  it("rejects other gateway errors and missing details", () => {
    expect(isGatewayAuthFailure(stepFailed({ gatewayName: "GatewayRateLimitError" }))).toBe(false);
    expect(isGatewayAuthFailure(stepFailed({ name: "Model provider API key missing" }))).toBe(
      false,
    );
    expect(isGatewayAuthFailure(stepFailed())).toBe(false);
  });
});

describe("formatGatewayAuthFailureNotice", () => {
  it("points a rejected API key at /model or the env file", () => {
    const notice = formatGatewayAuthFailureNotice(
      stepFailed({}, "AI Gateway rejected the provided API key. Update or unset…"),
    );
    expect(notice).toContain("rejected your AI_GATEWAY_API_KEY");
    expect(notice).toContain("/model");
  });

  it("points a rejected OIDC token at /model", () => {
    const notice = formatGatewayAuthFailureNotice(
      stepFailed({}, "AI Gateway rejected the OIDC token. Run `eve link`…"),
    );
    expect(notice).toContain("OIDC token");
    expect(notice).toContain("/model");
  });

  it("defaults to the missing-credentials line", () => {
    const notice = formatGatewayAuthFailureNotice(
      stepFailed({}, "AI Gateway received no credentials…"),
    );
    expect(notice).toBe(
      "There is no AI_GATEWAY_API_KEY set. Run /model to connect this to a project and refresh AI Gateway credentials, or set it manually in .env.local.",
    );
  });
});

describe("formatModelCallFailureNotice", () => {
  it("keeps gateway auth compact and local to /model when model config is available", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed(
        { gatewayName: "GatewayAuthenticationError" },
        "AI Gateway rejected the provided API key. Update or unset…",
      ),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "AI Gateway rejected your AI_GATEWAY_API_KEY. Run /model to refresh credentials, or update it in .env.local (a stale shell export can shadow it).",
    );
  });

  it("formats gateway invalid requests from structured upstream fields", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed(
        {
          gatewayName: "GatewayInvalidRequestError",
          gatewayType: "invalid_request_error",
          statusCode: 400,
          upstreamMessage: "tool type 'web_search_20250305' is not supported for this model",
          upstreamStatusCode: 400,
          upstreamType: "invalid_request_error",
        },
        "AI Gateway rejected the model request before the agent produced a response.",
      ),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "AI Gateway rejected the model request: tool type 'web_search_20250305' is not supported for this model. Check the model, tools, and provider options, then retry.",
    );
  });

  it("maps direct AI SDK API credential failures", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed({ name: "AI_APICallError", statusCode: 401 }, "Unauthorized"),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "The model provider rejected credentials. Update the provider API key in .env.local, then retry.",
    );
  });

  it("maps provider rate limits without requiring gateway fields", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed({ name: "AI_APICallError", statusCode: 429 }, "Too Many Requests"),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "The model provider rate limited the request. Wait and retry, or choose another model with /model.",
    );
  });

  it("does not mention /model when model config is unavailable", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed({ gatewayType: "model_not_found", statusCode: 404 }, "not found"),
      { canConfigureModel: false },
    );

    expect(notice).toBe("AI Gateway could not find this model. Update the model id and retry.");
  });

  it("maps Gateway failed dependency errors to provider configuration", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed(
        {
          gatewayName: "GatewayFailedDependencyError",
          gatewayType: "failed_dependency",
          statusCode: 424,
          upstreamMessage: "BYOK credentials cannot use this provider tool",
        },
        "failed dependency",
      ),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "AI Gateway could not fulfill the request with the selected provider credentials: BYOK credentials cannot use this provider tool. Check provider options and tools, or choose another model with /model.",
    );
  });

  it("maps Gateway policy rejections without calling them credential failures", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed({
        gatewayName: "GatewayForbiddenError",
        gatewayType: "forbidden",
        statusCode: 403,
      }),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "AI Gateway rejected the request by policy. Check project access, routing policy, or model access, then retry.",
    );
  });

  it("maps provider access denials without calling them credential failures", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed({ name: "AI_APICallError", statusCode: 403 }, "Forbidden"),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "The model provider rejected access to the request. Check the provider API key and model access, then retry.",
    );
  });

  it("maps invalid provider responses to a retryable compact message", () => {
    const notice = formatModelCallFailureNotice(
      stepFailed({ gatewayName: "GatewayResponseError", gatewayType: "response_error" }),
      { canConfigureModel: true },
    );

    expect(notice).toBe(
      "AI Gateway or the model provider returned a server error. Retry in a moment, or choose another model with /model if it keeps happening.",
    );
  });

  it("maps every public AI Gateway error name to compact text", () => {
    const cases = [
      [AI_GATEWAY_ERROR_NAMES.authentication, 401],
      [AI_GATEWAY_ERROR_NAMES.failedDependency, 424],
      [AI_GATEWAY_ERROR_NAMES.forbidden, 403],
      [AI_GATEWAY_ERROR_NAMES.internalServer, 500],
      [AI_GATEWAY_ERROR_NAMES.invalidRequest, 400],
      [AI_GATEWAY_ERROR_NAMES.modelNotFound, 404],
      [AI_GATEWAY_ERROR_NAMES.rateLimit, 429],
      [AI_GATEWAY_ERROR_NAMES.response, 502],
    ] as const;

    expect(cases.map(([gatewayName]) => gatewayName).toSorted()).toEqual(
      AI_GATEWAY_PUBLIC_ERROR_NAMES.toSorted(),
    );
    for (const [gatewayName, statusCode] of cases) {
      const notice = formatModelCallFailureNotice(
        stepFailed({ gatewayName, statusCode }, `${gatewayName} failed`),
        { canConfigureModel: true },
      );
      expect(notice).toBeTypeOf("string");
      expect(notice).not.toContain("MODEL_CALL_FAILED");
    }
  });

  it("returns undefined for non-model failures so diagnostic details still render", () => {
    expect(
      formatModelCallFailureNotice({
        type: "step.failed",
        data: {
          code: "TOOL_FAILED",
          details: { name: "AI_APICallError", statusCode: 400 },
          message: "tool exploded",
          sequence: 0,
          stepIndex: 0,
          turnId: "t0",
        },
      } as StepFailedStreamEvent),
    ).toBeUndefined();
  });
});
