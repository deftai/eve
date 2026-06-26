import type { HandleMessageStreamEvent } from "eve/client";

interface BashFanoutMeasurement {
  readonly callId: string;
  readonly clientCompletedAtMs: number;
  readonly clientStartedAtMs: number;
  readonly label: string;
  readonly query: string;
  readonly receivedAtMs: number;
  readonly releasedAtMs: number;
  readonly requestedAt: string | undefined;
  readonly resultAt: string | undefined;
}

interface BashResultEvent {
  readonly callId: string;
  readonly output: unknown;
  readonly observedAt: string | undefined;
}

export function bashRequestsPrecedeFirstResult(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly expectedCallCount: number;
}): boolean {
  const requests = input.events.flatMap((event, eventIndex) => {
    if (event.type !== "actions.requested") return [];

    return event.data.actions.flatMap((action) => {
      if (action.kind !== "tool-call" || action.toolName !== "bash") return [];
      return [{ callId: action.callId, eventIndex }];
    });
  });
  const firstResultIndex = input.events.findIndex(
    (event) =>
      event.type === "action.result" &&
      event.data.result.kind === "tool-result" &&
      event.data.result.toolName === "bash",
  );

  return (
    firstResultIndex >= 0 &&
    requests.length === input.expectedCallCount &&
    new Set(requests.map((request) => request.callId)).size === input.expectedCallCount &&
    requests.every((request) => request.eventIndex < firstResultIndex)
  );
}

export function bashCurlRequestsReachedBarrier(input: {
  readonly events: readonly HandleMessageStreamEvent[];
  readonly expectedRequests: readonly { readonly label: string; readonly query: string }[];
}): boolean {
  const measurements = bashFanoutMeasurements(input.events);
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
        measurement.clientStartedAtMs < measurement.clientCompletedAtMs,
    ) &&
    Math.max(...measurements.map((measurement) => measurement.clientStartedAtMs)) <
      Math.min(...measurements.map((measurement) => measurement.clientCompletedAtMs)) &&
    Math.max(...measurements.map((measurement) => measurement.receivedAtMs)) <=
      Math.min(...measurements.map((measurement) => measurement.releasedAtMs))
  );
}

export function formatBashFanoutTrace(events: readonly HandleMessageStreamEvent[]): string {
  return JSON.stringify({
    calls: bashFanoutMeasurements(events).map((measurement) => ({
      ...measurement,
      clientDurationMs: measurement.clientCompletedAtMs - measurement.clientStartedAtMs,
      observedLatencyMs: durationMs(measurement.requestedAt, measurement.resultAt),
    })),
    kind: "bash-curl-fanout-trace",
  });
}

function bashFanoutMeasurements(
  events: readonly HandleMessageStreamEvent[],
): readonly BashFanoutMeasurement[] {
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
    const parsed = parseBashFanoutMeasurement(result.output);
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

function parseBashFanoutMeasurement(
  value: unknown,
): Omit<BashFanoutMeasurement, "callId" | "requestedAt" | "resultAt"> | undefined {
  const stdout = readStringField(value, "stdout");
  if (stdout === undefined) return undefined;

  for (const line of stdout.split("\n")) {
    const parsed = parseJson(line);
    const clientStartedAtMs = readFiniteNumberField(parsed, "clientStartedAtMs");
    const clientCompletedAtMs = readFiniteNumberField(parsed, "clientCompletedAtMs");
    const server = readField(parsed, "server");
    const label = readStringField(server, "label");
    const query = readStringField(server, "query");
    const receivedAtMs = readFiniteNumberField(server, "receivedAtMs");
    const releasedAtMs = readFiniteNumberField(server, "releasedAtMs");

    if (
      clientStartedAtMs !== undefined &&
      clientCompletedAtMs !== undefined &&
      label !== undefined &&
      query !== undefined &&
      receivedAtMs !== undefined &&
      releasedAtMs !== undefined
    ) {
      return { clientCompletedAtMs, clientStartedAtMs, label, query, receivedAtMs, releasedAtMs };
    }
  }

  return undefined;
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

function readStringField(value: unknown, field: string): string | undefined {
  const candidate = readField(value, field);
  return typeof candidate === "string" ? candidate : undefined;
}

function readFiniteNumberField(value: unknown, field: string): number | undefined {
  const candidate = readField(value, field);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function durationMs(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number | null {
  if (
    startedAt === null ||
    startedAt === undefined ||
    completedAt === null ||
    completedAt === undefined
  ) {
    return null;
  }

  const startedAtMs = Date.parse(startedAt);
  const completedAtMs = Date.parse(completedAt);
  return Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)
    ? completedAtMs - startedAtMs
    : null;
}
