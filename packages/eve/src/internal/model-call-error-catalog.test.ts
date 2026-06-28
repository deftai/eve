import * as gatewayExports from "@ai-sdk/gateway";
import {
  APICallError,
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError,
  LoadAPIKeyError,
  LoadSettingError,
  NoContentGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  NoSuchModelError,
  NoSuchProviderReferenceError,
  RetryError,
  TooManyEmbeddingValuesForCallError,
  TypeValidationError,
  UnsupportedFunctionalityError,
  UnsupportedModelVersionError,
} from "ai";
import { describe, expect, it } from "vitest";

import {
  AI_GATEWAY_ERROR_NAMES,
  AI_GATEWAY_ERROR_TYPES,
  AI_GATEWAY_PUBLIC_ERROR_NAMES,
  AI_SDK_CORE_ERROR_NAMES,
  AI_SDK_PROVIDER_ERROR_NAMES,
} from "./model-call-error-catalog.js";

interface GatewayErrorConstructor {
  new (...args: never[]): Error & { readonly type: string };
}

const CONCRETE_GATEWAY_ERROR_EXPORT_RE = /^Gateway(?!Error$).*Error$/;

function concreteGatewayErrorExports(): Map<string, GatewayErrorConstructor> {
  return new Map(
    (Object.entries(gatewayExports) as Array<[string, unknown]>)
      .filter(
        ([name, value]) =>
          CONCRETE_GATEWAY_ERROR_EXPORT_RE.test(name) && typeof value === "function",
      )
      .map(([name, value]): [string, GatewayErrorConstructor] => [
        name,
        value as GatewayErrorConstructor,
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function instantiateGatewayError(
  name: keyof typeof AI_GATEWAY_ERROR_NAMES,
  ErrorConstructor: GatewayErrorConstructor,
): Error & { readonly type: string } {
  if (name === "modelNotFound") {
    return new gatewayExports.GatewayModelNotFoundError({ modelId: "anthropic/example" });
  }
  return new ErrorConstructor();
}

describe("model-call error catalog", () => {
  it("covers every concrete public AI Gateway error class exported by @ai-sdk/gateway", () => {
    const sourceErrorClasses = concreteGatewayErrorExports();

    expect(AI_GATEWAY_PUBLIC_ERROR_NAMES.toSorted()).toEqual(
      [...sourceErrorClasses.keys()].toSorted(),
    );

    for (const [key, name] of Object.entries(AI_GATEWAY_ERROR_NAMES) as Array<
      [
        keyof typeof AI_GATEWAY_ERROR_NAMES,
        (typeof AI_GATEWAY_ERROR_NAMES)[keyof typeof AI_GATEWAY_ERROR_NAMES],
      ]
    >) {
      const ErrorConstructor = sourceErrorClasses.get(name);
      expect(ErrorConstructor).toBeTypeOf("function");
      if (ErrorConstructor === undefined) continue;

      const error = instantiateGatewayError(key, ErrorConstructor);
      expect(AI_GATEWAY_ERROR_NAMES[key]).toBe(error.name);
      expect(AI_GATEWAY_ERROR_TYPES[key]).toBe(error.type);
    }
  });

  it("keeps AI SDK provider error names aligned with the classes re-exported by ai", () => {
    const sourceErrors = {
      apiCall: new APICallError({
        message: "failed",
        requestBodyValues: {},
        url: "https://example.com",
      }),
      emptyResponseBody: new EmptyResponseBodyError(),
      invalidArgument: new InvalidArgumentError({
        message: "invalid",
        parameter: "model",
        value: "anthropic/example",
      }),
      invalidPrompt: new InvalidPromptError({ message: "invalid", prompt: [] }),
      invalidResponseData: new InvalidResponseDataError({ data: {} }),
      jsonParse: new JSONParseError({ cause: new SyntaxError("bad json"), text: "{" }),
      loadApiKey: new LoadAPIKeyError({ message: "missing" }),
      loadSetting: new LoadSettingError({ message: "missing" }),
      noContentGenerated: new NoContentGeneratedError(),
      noSuchModel: new NoSuchModelError({ modelId: "missing", modelType: "languageModel" }),
      noSuchProviderReference: new NoSuchProviderReferenceError({
        provider: "missing",
        reference: {} as never,
      }),
      tooManyEmbeddingValuesForCall: new TooManyEmbeddingValuesForCallError({
        maxEmbeddingsPerCall: 1,
        modelId: "embedding-model",
        provider: "provider",
        values: ["a", "b"],
      }),
      typeValidation: new TypeValidationError({ cause: new Error("invalid"), value: {} }),
      unsupportedFunctionality: new UnsupportedFunctionalityError({ functionality: "tool" }),
    } satisfies Record<keyof typeof AI_SDK_PROVIDER_ERROR_NAMES, Error>;

    for (const [key, error] of Object.entries(sourceErrors) as Array<
      [keyof typeof AI_SDK_PROVIDER_ERROR_NAMES, Error]
    >) {
      expect(AI_SDK_PROVIDER_ERROR_NAMES[key]).toBe(error.name);
    }
  });

  it("keeps AI SDK core model-call error names aligned with ai exports", () => {
    const sourceErrors = {
      noObjectGenerated: new NoObjectGeneratedError({
        finishReason: "stop",
        response: { id: "response", modelId: "model", timestamp: new Date(0) },
        text: "",
        usage: {
          inputTokenDetails: {
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
            noCacheTokens: 0,
          },
          inputTokens: 0,
          outputTokenDetails: { reasoningTokens: undefined, textTokens: 0 },
          outputTokens: 0,
          totalTokens: 0,
        },
      }),
      noOutputGenerated: new NoOutputGeneratedError(),
      retry: new RetryError({
        errors: [new Error("retry failed")],
        message: "Retry failed",
        reason: "maxRetriesExceeded",
      }),
      unsupportedModelVersion: new UnsupportedModelVersionError({
        modelId: "model",
        provider: "provider",
        version: "v0",
      }),
    } satisfies Record<keyof typeof AI_SDK_CORE_ERROR_NAMES, Error>;

    for (const [key, error] of Object.entries(sourceErrors) as Array<
      [keyof typeof AI_SDK_CORE_ERROR_NAMES, Error]
    >) {
      expect(AI_SDK_CORE_ERROR_NAMES[key]).toBe(error.name);
    }
  });
});
