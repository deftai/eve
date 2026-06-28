/**
 * Source-backed error names and response types that can surface from AI SDK
 * model calls. Keep the values here instead of scattering string literals
 * across the harness and TUI so upstream SDK upgrades have one canary point.
 */

export const AI_GATEWAY_ERROR_NAMES = {
  authentication: "GatewayAuthenticationError",
  failedDependency: "GatewayFailedDependencyError",
  forbidden: "GatewayForbiddenError",
  internalServer: "GatewayInternalServerError",
  invalidRequest: "GatewayInvalidRequestError",
  modelNotFound: "GatewayModelNotFoundError",
  rateLimit: "GatewayRateLimitError",
  response: "GatewayResponseError",
} as const;

/** Public classes exported by `@ai-sdk/gateway`. */
export const AI_GATEWAY_PUBLIC_ERROR_NAMES = [
  AI_GATEWAY_ERROR_NAMES.authentication,
  AI_GATEWAY_ERROR_NAMES.failedDependency,
  AI_GATEWAY_ERROR_NAMES.forbidden,
  AI_GATEWAY_ERROR_NAMES.internalServer,
  AI_GATEWAY_ERROR_NAMES.invalidRequest,
  AI_GATEWAY_ERROR_NAMES.modelNotFound,
  AI_GATEWAY_ERROR_NAMES.rateLimit,
  AI_GATEWAY_ERROR_NAMES.response,
] as const;

/**
 * Error names present in the Gateway runtime bundle but not exported by the
 * package API. Keep these separate so public coverage tests stay exact.
 */
export const AI_GATEWAY_INTERNAL_ERROR_NAMES = {
  timeout: "GatewayTimeoutError",
} as const;

export const AI_GATEWAY_ERROR_TYPES = {
  authentication: "authentication_error",
  failedDependency: "failed_dependency",
  forbidden: "forbidden",
  internalServer: "internal_server_error",
  invalidRequest: "invalid_request_error",
  modelNotFound: "model_not_found",
  rateLimit: "rate_limit_exceeded",
  response: "response_error",
  timeout: "timeout_error",
} as const;

export const AI_SDK_PROVIDER_ERROR_NAMES = {
  apiCall: "AI_APICallError",
  emptyResponseBody: "AI_EmptyResponseBodyError",
  invalidArgument: "AI_InvalidArgumentError",
  invalidPrompt: "AI_InvalidPromptError",
  invalidResponseData: "AI_InvalidResponseDataError",
  jsonParse: "AI_JSONParseError",
  loadApiKey: "AI_LoadAPIKeyError",
  loadSetting: "AI_LoadSettingError",
  noContentGenerated: "AI_NoContentGeneratedError",
  noSuchModel: "AI_NoSuchModelError",
  noSuchProviderReference: "AI_NoSuchProviderReferenceError",
  tooManyEmbeddingValuesForCall: "AI_TooManyEmbeddingValuesForCallError",
  typeValidation: "AI_TypeValidationError",
  unsupportedFunctionality: "AI_UnsupportedFunctionalityError",
} as const;

export const AI_SDK_CORE_ERROR_NAMES = {
  noObjectGenerated: "AI_NoObjectGeneratedError",
  noOutputGenerated: "AI_NoOutputGeneratedError",
  retry: "AI_RetryError",
  unsupportedModelVersion: "AI_UnsupportedModelVersionError",
} as const;

export const AI_SDK_MODEL_CALL_ERROR_NAMES = {
  ...AI_SDK_PROVIDER_ERROR_NAMES,
  ...AI_SDK_CORE_ERROR_NAMES,
} as const;

export const LEGACY_AI_SDK_ERROR_NAMES = {
  loadApiKey: "LoadAPIKeyError",
} as const;

export const EMPTY_MODEL_RESPONSE_SUMMARY_NAME = "Empty model response";
export const MODEL_PROVIDER_API_KEY_MISSING_SUMMARY_NAME = "Model provider API key missing";

/**
 * The summary `name` assigned to recognized Gateway auth failures, carried into
 * failure-event details for the TUI.
 */
export const GATEWAY_AUTH_FAILURE_SUMMARY_NAME = "AI Gateway authentication failed";

export const GATEWAY_AUTHENTICATION_ERROR_NAME = AI_GATEWAY_ERROR_NAMES.authentication;
