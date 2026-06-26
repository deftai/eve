import type { HandleMessageStreamEvent } from "eve/client";

interface RequestedToolCall {
  readonly callId: string;
  readonly input: unknown;
  readonly observedAt: string | undefined;
}

interface ToolResult {
  readonly callId: string;
  readonly observedAt: string | undefined;
  readonly output: unknown;
}

interface ToolFanoutTraceCall {
  readonly callId: string;
  readonly executionCompletedAt: number | null;
  readonly executionDurationMs: number | null;
  readonly executionStartedAt: number | null;
  readonly executionToResultMs: number | null;
  readonly observedLatencyMs: number | null;
  readonly requestToExecutionStartMs: number | null;
  readonly requestedAt: string | null;
  readonly resultAt: string | null;
}

/** Reports directly observed action, execution, and result timing for one fan-out turn. */
export function formatToolFanoutTrace(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly toolName: string;
}): string {
  const requests = requestedToolCalls(input);
  const resultsByCallId = new Map(toolResults(input).map((result) => [result.callId, result]));
  const calls = requests.map((request) => {
    const result = resultsByCallId.get(request.callId);
    const executionStartedAt =
      result === undefined ? undefined : readFiniteNumberField(result.output, "executionStartedAt");
    const executionCompletedAt =
      result === undefined
        ? undefined
        : readFiniteNumberField(result.output, "executionCompletedAt");

    return {
      callId: request.callId,
      executionCompletedAt: executionCompletedAt ?? null,
      executionDurationMs: durationBetweenEpochs(executionStartedAt, executionCompletedAt),
      executionStartedAt: executionStartedAt ?? null,
      executionToResultMs: durationFromEpochToEvent(executionCompletedAt, result?.observedAt),
      observedLatencyMs: durationMs(request.observedAt, result?.observedAt),
      requestToExecutionStartMs: durationFromEventToEpoch(request.observedAt, executionStartedAt),
      requestedAt: request.observedAt ?? null,
      resultAt: result?.observedAt ?? null,
    };
  });

  return JSON.stringify({
    calls,
    kind: "tool-fanout-trace",
    timing: {
      ...summarizeToolFanoutTiming(calls),
      requestSpreadMs: durationMs(calls[0]?.requestedAt, calls.at(-1)?.requestedAt),
    },
    toolName: input.toolName,
  });
}

function requestedToolCalls(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly toolName: string;
}): readonly RequestedToolCall[] {
  return input.events.flatMap((event) => {
    if (event.type !== "actions.requested") return [];

    return event.data.actions.flatMap((action) => {
      if (action.kind !== "tool-call" || action.toolName !== input.toolName) return [];
      return [{ callId: action.callId, input: action.input, observedAt: event.meta?.at }];
    });
  });
}

function toolResults(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly toolName: string;
}): readonly ToolResult[] {
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

function readFiniteNumberField(value: unknown, field: string): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const candidate = Reflect.get(value, field);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function durationMs(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | null {
  return durationBetweenEpochs(eventTimestampMs(startedAt), eventTimestampMs(completedAt));
}

function durationBetweenEpochs(
  startedAt: number | undefined,
  completedAt: number | undefined,
): number | null {
  return startedAt === undefined || completedAt === undefined ? null : completedAt - startedAt;
}

function durationFromEventToEpoch(
  startedAt: string | null | undefined,
  completedAt: number | undefined,
): number | null {
  return durationBetweenEpochs(eventTimestampMs(startedAt), completedAt);
}

function durationFromEpochToEvent(
  startedAt: number | undefined,
  completedAt: string | null | undefined,
): number | null {
  return durationBetweenEpochs(startedAt, eventTimestampMs(completedAt));
}

function eventTimestampMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function summarizeToolFanoutTiming(calls: readonly ToolFanoutTraceCall[]): {
  readonly currentCompletionFromFirstRequestMs: number | null;
  readonly currentFirstResultFromFirstRequestMs: number | null;
  readonly executionOverlapHeadroomMs: number | null;
  readonly firstExecutionStartFromFirstRequestMs: number | null;
  readonly executionStartSpreadMs: number | null;
  readonly lastExecutionStartFromFirstRequestMs: number | null;
  readonly maxRequestToExecutionStartMs: number | null;
  readonly minRequestToExecutionStartMs: number | null;
} {
  const firstRequestAtMs = minimum(
    calls.map((call) => eventTimestampMs(call.requestedAt)).filter(isDefined),
  );
  if (firstRequestAtMs === undefined) {
    return {
      currentCompletionFromFirstRequestMs: null,
      currentFirstResultFromFirstRequestMs: null,
      executionOverlapHeadroomMs: null,
      firstExecutionStartFromFirstRequestMs: null,
      executionStartSpreadMs: null,
      lastExecutionStartFromFirstRequestMs: null,
      maxRequestToExecutionStartMs: null,
      minRequestToExecutionStartMs: null,
    };
  }

  const observedResultTimesMs = calls
    .map((call) => eventTimestampMs(call.resultAt))
    .filter(isDefined);
  const executionStartsMs = calls.map((call) => call.executionStartedAt).filter(isDefined);
  const executionCompletedMs = calls.map((call) => call.executionCompletedAt).filter(isDefined);
  const requestToExecutionStartMs = calls
    .map((call) => call.requestToExecutionStartMs)
    .filter(isDefined);
  const currentFirstResultFromFirstRequestMs = relativeTo(
    minimum(observedResultTimesMs),
    firstRequestAtMs,
  );
  const currentCompletionFromFirstRequestMs = relativeTo(
    maximum(observedResultTimesMs),
    firstRequestAtMs,
  );

  return {
    currentCompletionFromFirstRequestMs,
    currentFirstResultFromFirstRequestMs,
    executionOverlapHeadroomMs: difference(
      minimum(executionCompletedMs),
      maximum(executionStartsMs),
    ),
    firstExecutionStartFromFirstRequestMs: relativeTo(minimum(executionStartsMs), firstRequestAtMs),
    executionStartSpreadMs: spread(executionStartsMs),
    lastExecutionStartFromFirstRequestMs: relativeTo(maximum(executionStartsMs), firstRequestAtMs),
    maxRequestToExecutionStartMs: maximum(requestToExecutionStartMs) ?? null,
    minRequestToExecutionStartMs: minimum(requestToExecutionStartMs) ?? null,
  };
}

function difference(left: number | undefined, right: number | undefined): number | null {
  return left === undefined || right === undefined ? null : left - right;
}

function isDefined<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

function maximum(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values);
}

function minimum(values: readonly number[]): number | undefined {
  return values.length === 0 ? undefined : Math.min(...values);
}

function relativeTo(value: number | undefined, origin: number): number | null {
  return value === undefined ? null : value - origin;
}

function spread(values: readonly number[]): number | null {
  const min = minimum(values);
  const max = maximum(values);
  return min === undefined || max === undefined ? null : max - min;
}
