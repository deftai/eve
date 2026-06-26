import type { HandleMessageStreamEvent } from "eve/client";

interface BashLatencyMeasurement {
  readonly callId: string;
  readonly clientDurationNs: number;
  readonly completedAtMs: number;
  readonly executionCompletedAt: number;
  readonly executionStartedAt: number;
  readonly label: string;
  readonly query: string;
  readonly receivedAtMs: number;
  readonly requestedAt: string | undefined;
  readonly resultAt: string | undefined;
}

interface BashResultEvent {
  readonly callId: string;
  readonly observedAt: string | undefined;
  readonly output: unknown;
}

interface BashLatencyTraceCall {
  readonly callId: string;
  readonly clientDurationMs: number;
  readonly completedAtMs: number;
  readonly executionCompletedAt: number;
  readonly executionDurationMs: number;
  readonly executionStartedAt: number;
  readonly executionToResultMs: number | null;
  readonly label: string;
  readonly observedLatencyMs: number | null;
  readonly query: string;
  readonly requestToExecutionStartMs: number | null;
  readonly receivedAtMs: number;
  readonly requestedAt: string | null;
  readonly resultAt: string | null;
}

export function bashCurlLatencyCallsMatch(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly expectedRequests: readonly { readonly label: string; readonly query: string }[];
}): boolean {
  const measurements = bashLatencyMeasurements(input.events);
  const expectedQueryByLabel = new Map(
    input.expectedRequests.map((request) => [request.label, request.query]),
  );

  return (
    measurements.length === input.expectedRequests.length &&
    expectedQueryByLabel.size === input.expectedRequests.length &&
    new Set(measurements.map((measurement) => measurement.label)).size ===
      input.expectedRequests.length &&
    measurements.every(
      (measurement) =>
        expectedQueryByLabel.get(measurement.label) === measurement.query &&
        measurement.clientDurationNs > 0 &&
        measurement.receivedAtMs < measurement.completedAtMs,
    )
  );
}

export function formatBashCurlLatencyTrace(events: readonly HandleMessageStreamEvent[]): string {
  const calls = bashLatencyMeasurements(events).map((measurement) => ({
    callId: measurement.callId,
    clientDurationMs: measurement.clientDurationNs / NANOSECONDS_PER_MILLISECOND,
    completedAtMs: measurement.completedAtMs,
    executionCompletedAt: measurement.executionCompletedAt,
    executionDurationMs: measurement.executionCompletedAt - measurement.executionStartedAt,
    executionStartedAt: measurement.executionStartedAt,
    executionToResultMs: durationFromEpochToEvent(
      measurement.executionCompletedAt,
      measurement.resultAt,
    ),
    label: measurement.label,
    observedLatencyMs: durationMs(measurement.requestedAt, measurement.resultAt),
    query: measurement.query,
    requestToExecutionStartMs: durationFromEventToEpoch(
      measurement.requestedAt,
      measurement.executionStartedAt,
    ),
    receivedAtMs: measurement.receivedAtMs,
    requestedAt: measurement.requestedAt ?? null,
    resultAt: measurement.resultAt ?? null,
  }));

  return JSON.stringify({
    calls,
    kind: "bash-curl-latency-trace",
    timing: {
      ...summarizeBashLatency(calls),
      requestSpreadMs: durationMs(calls[0]?.requestedAt, calls.at(-1)?.requestedAt),
    },
  });
}

function bashLatencyMeasurements(
  events: readonly HandleMessageStreamEvent[],
): readonly BashLatencyMeasurement[] {
  const requestedAtByCallId = new Map<string, string | undefined>();
  for (const event of events) {
    if (event.type !== "actions.requested") continue;

    for (const action of event.data.actions) {
      if (action.kind === "tool-call" && action.toolName === "bash") {
        requestedAtByCallId.set(action.callId, event.meta?.at);
      }
    }
  }

  return bashResultEvents(events).flatMap((result) => {
    const parsed = parseBashLatencyMeasurement(result.output);
    if (parsed === undefined) return [];

    return [
      {
        ...parsed,
        callId: result.callId,
        requestedAt: requestedAtByCallId.get(result.callId),
        resultAt: result.observedAt,
      },
    ];
  });
}

function bashResultEvents(events: readonly HandleMessageStreamEvent[]): readonly BashResultEvent[] {
  return events.flatMap((event) => {
    if (event.type !== "action.result" || event.data.result.kind !== "tool-result") return [];
    if (event.data.result.toolName !== "bash") return [];

    return [
      {
        callId: event.data.result.callId,
        observedAt: event.meta?.at,
        output: event.data.result.output,
      },
    ];
  });
}

function parseBashLatencyMeasurement(
  value: unknown,
): Omit<BashLatencyMeasurement, "callId" | "requestedAt" | "resultAt"> | undefined {
  const stdout = readStringField(value, "stdout");
  if (stdout === undefined) return undefined;

  for (const line of stdout.split("\n")) {
    const parsed = parseJson(line);
    const clientDurationNs = readPositiveSafeIntegerField(parsed, "clientDurationNs");
    const executionCompletedAt = readFiniteNumberField(value, "executionCompletedAt");
    const executionStartedAt = readFiniteNumberField(value, "executionStartedAt");
    const server = readField(parsed, "server");
    const label = readStringField(server, "label");
    const query = readStringField(server, "query");
    const receivedAtMs = readFiniteNumberField(server, "receivedAtMs");
    const completedAtMs = readFiniteNumberField(server, "completedAtMs");

    if (
      clientDurationNs !== undefined &&
      completedAtMs !== undefined &&
      executionCompletedAt !== undefined &&
      executionStartedAt !== undefined &&
      executionStartedAt <= executionCompletedAt &&
      label !== undefined &&
      query !== undefined &&
      receivedAtMs !== undefined
    ) {
      return {
        clientDurationNs,
        completedAtMs,
        executionCompletedAt,
        executionStartedAt,
        label,
        query,
        receivedAtMs,
      };
    }
  }

  return undefined;
}

function summarizeBashLatency(calls: readonly BashLatencyTraceCall[]): {
  readonly currentCompletionFromFirstRequestMs: number | null;
  readonly currentFirstResultFromFirstRequestMs: number | null;
  readonly executionOverlapHeadroomMs: number | null;
  readonly executionStartSpreadMs: number | null;
  readonly firstExecutionStartFromFirstRequestMs: number | null;
  readonly lastExecutionStartFromFirstRequestMs: number | null;
  readonly maxObservedLatencyMs: number | null;
  readonly maxRequestToExecutionStartMs: number | null;
  readonly minObservedLatencyMs: number | null;
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
      executionStartSpreadMs: null,
      firstExecutionStartFromFirstRequestMs: null,
      lastExecutionStartFromFirstRequestMs: null,
      maxObservedLatencyMs: null,
      maxRequestToExecutionStartMs: null,
      minObservedLatencyMs: null,
      minRequestToExecutionStartMs: null,
    };
  }

  const observedResultTimesMs = calls
    .map((call) => eventTimestampMs(call.resultAt))
    .filter(isDefined);
  const executionStartsMs = calls.map((call) => call.executionStartedAt);
  const executionCompletedMs = calls.map((call) => call.executionCompletedAt);
  const observedLatenciesMs = calls.map((call) => call.observedLatencyMs).filter(isDefined);
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
    executionStartSpreadMs: spread(executionStartsMs),
    firstExecutionStartFromFirstRequestMs: relativeTo(minimum(executionStartsMs), firstRequestAtMs),
    lastExecutionStartFromFirstRequestMs: relativeTo(maximum(executionStartsMs), firstRequestAtMs),
    maxObservedLatencyMs: maximum(observedLatenciesMs) ?? null,
    maxRequestToExecutionStartMs: maximum(requestToExecutionStartMs) ?? null,
    minObservedLatencyMs: minimum(observedLatenciesMs) ?? null,
    minRequestToExecutionStartMs: minimum(requestToExecutionStartMs) ?? null,
  };
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

function durationFromEventToEpoch(
  startedAt: string | null | undefined,
  completedAt: number,
): number | null {
  const startedAtMs = eventTimestampMs(startedAt);
  return startedAtMs === undefined ? null : completedAt - startedAtMs;
}

function durationFromEpochToEvent(
  startedAt: number,
  completedAt: string | null | undefined,
): number | null {
  const completedAtMs = eventTimestampMs(completedAt);
  return completedAtMs === undefined ? null : completedAtMs - startedAt;
}

function eventTimestampMs(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
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

function spread(values: readonly number[]): number | null {
  const min = minimum(values);
  const max = maximum(values);
  return min === undefined || max === undefined ? null : max - min;
}

function difference(left: number | undefined, right: number | undefined): number | null {
  return left === undefined || right === undefined ? null : left - right;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readField(value: unknown, field: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Reflect.get(value, field);
}

function readFiniteNumberField(value: unknown, field: string): number | undefined {
  const candidate = readField(value, field);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function readPositiveSafeIntegerField(value: unknown, field: string): number | undefined {
  const candidate = readField(value, field);
  return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0
    ? candidate
    : undefined;
}

function readStringField(value: unknown, field: string): string | undefined {
  const candidate = readField(value, field);
  return typeof candidate === "string" ? candidate : undefined;
}

function relativeTo(value: number | undefined, origin: number): number | null {
  return value === undefined ? null : value - origin;
}

const NANOSECONDS_PER_MILLISECOND = 1_000_000;
