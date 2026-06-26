import type { HandleMessageStreamEvent } from "eve/client";

interface RequestedParallelSearchCall {
  readonly callId: string;
  readonly eventIndex: number;
  readonly input: unknown;
  readonly observedAt: string | undefined;
}

interface ParallelSearchResult {
  readonly callId: string;
  readonly observedAt: string | undefined;
  readonly output: unknown;
}

export function parallelSearchRequestsPrecedeFirstResult(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly expectedCallCount: number;
  readonly toolName: string;
}): boolean {
  const requests = requestedParallelSearchCalls(input);
  const firstResultIndex = input.events.findIndex(
    (event) =>
      event.type === "action.result" &&
      event.data.result.kind === "tool-result" &&
      event.data.result.toolName === input.toolName,
  );

  return (
    firstResultIndex >= 0 &&
    requests.length === input.expectedCallCount &&
    new Set(requests.map((request) => request.callId)).size === input.expectedCallCount &&
    requests.every((request) => request.eventIndex < firstResultIndex)
  );
}

export function parallelSearchUsesExpectedQueries(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly expectedQueries: readonly string[];
  readonly expectedRequestCount: number;
  readonly queriesPerRequest: number;
  readonly toolName: string;
}): boolean {
  const requests = requestedParallelSearchCalls(input);
  const queries = requests.flatMap((request) =>
    readStringArrayField(request.input, "search_queries"),
  );

  return (
    requests.length === input.expectedRequestCount &&
    new Set(requests.map((request) => request.callId)).size === input.expectedRequestCount &&
    requests.every(
      (request) =>
        readStringArrayField(request.input, "search_queries").length === input.queriesPerRequest,
    ) &&
    queries.length === input.expectedQueries.length &&
    new Set(queries).size === input.expectedQueries.length &&
    queries.every((query) => input.expectedQueries.includes(query))
  );
}

export function parallelSearchResultsHaveSources(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly expectedResultCount: number;
  readonly toolName: string;
}): boolean {
  const results = parallelSearchResults(input);

  return (
    results.length === input.expectedResultCount &&
    results.every(
      (result) =>
        readStringField(result.output, "searchId") !== undefined &&
        readSearchResultUrls(result.output).some((url) => normalizeUrl(url) !== undefined),
    )
  );
}

export function parallelSearchFindingsAreGrounded(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly expectedFindingCount: number;
  readonly message: string | null | undefined;
  readonly toolName: string;
}): boolean {
  if (input.message === null || input.message === undefined) return false;

  const sourceUrls = new Set(
    parallelSearchResults(input)
      .flatMap((result) => readSearchResultUrls(result.output))
      .map(normalizeUrl)
      .filter((url): url is string => url !== undefined),
  );
  const citations = extractMarkdownUrls(input.message)
    .map(normalizeUrl)
    .filter((url): url is string => url !== undefined);

  return (
    labelledFindingCount(input.message) === input.expectedFindingCount &&
    citations.length >= input.expectedFindingCount &&
    new Set(citations).size >= input.expectedFindingCount &&
    citations.every((citation) => sourceUrls.has(citation))
  );
}

export function formatParallelSearchTrace(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly toolName: string;
}): string {
  const resultsByCallId = new Map(
    parallelSearchResults(input).map((result) => [result.callId, result]),
  );
  const calls = requestedParallelSearchCalls(input).map((request) => {
    const result = resultsByCallId.get(request.callId);

    return {
      callId: request.callId,
      observedLatencyMs: durationMs(request.observedAt, result?.observedAt),
      requestedAt: request.observedAt ?? null,
      resultAt: result?.observedAt ?? null,
      searchId: result === undefined ? null : (readStringField(result.output, "searchId") ?? null),
      searchQueries: readStringArrayField(request.input, "search_queries"),
      sourceUrls: result === undefined ? [] : readSearchResultUrls(result.output),
    };
  });

  return JSON.stringify({ calls, kind: "parallel-search-trace" });
}

function requestedParallelSearchCalls(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly toolName: string;
}): readonly RequestedParallelSearchCall[] {
  return input.events.flatMap((event, eventIndex) => {
    if (event.type !== "actions.requested") return [];

    return event.data.actions.flatMap((action) => {
      if (action.kind !== "tool-call" || action.toolName !== input.toolName) return [];
      return [
        { callId: action.callId, eventIndex, input: action.input, observedAt: event.meta?.at },
      ];
    });
  });
}

function parallelSearchResults(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly toolName: string;
}): readonly ParallelSearchResult[] {
  return input.events.flatMap((event) => {
    if (event.type !== "action.result" || event.data.result.kind !== "tool-result") return [];
    if (event.data.result.toolName !== input.toolName) return [];

    return [
      {
        callId: event.data.result.callId,
        observedAt: event.meta?.at,
        output: event.data.result.output,
      },
    ];
  });
}

function labelledFindingCount(message: string): number {
  const labels = [
    ...message.matchAll(/(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?Q(0[1-9]|10)(?:\*\*)?:/gim),
  ].map((match) => match[1]);
  return new Set(labels).size;
}

function readField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Reflect.get(value, field);
}

function readStringField(value: unknown, field: string): string | undefined {
  const candidate = readField(value, field);
  return typeof candidate === "string" ? candidate : undefined;
}

function readStringArrayField(value: unknown, field: string): readonly string[] {
  const candidate = readField(value, field);
  return Array.isArray(candidate) && candidate.every((item) => typeof item === "string")
    ? candidate
    : [];
}

function readSearchResultUrls(value: unknown): readonly string[] {
  const results = readField(value, "results");
  if (!Array.isArray(results)) return [];

  return results.flatMap((result) => {
    const url = readStringField(result, "url");
    return url === undefined ? [] : [url];
  });
}

function extractMarkdownUrls(message: string): readonly string[] {
  return [...message.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1] ?? "");
}

function normalizeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function durationMs(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | null {
  const startedAtMs = eventTimestampMs(startedAt);
  const completedAtMs = eventTimestampMs(completedAt);
  return startedAtMs === undefined || completedAtMs === undefined
    ? null
    : completedAtMs - startedAtMs;
}

function eventTimestampMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
