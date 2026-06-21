import type { DevToolsClient } from "./devtools-client.js";
import type {
  DevToolsLogEntry,
  DevToolsRun,
  DevToolsRunEvent,
  DevToolsSourceEntry,
  DevToolsSourceLocation,
} from "./types.js";

const MAX_SESSION_LOGS = 100;

export interface SessionInspection {
  readonly failures: readonly SessionFailure[];
  readonly logs: readonly DevToolsLogEntry[];
  readonly run: DevToolsRun;
  readonly source?: {
    readonly location?: DevToolsSourceLocation;
    readonly path: string;
    readonly sourceId: string;
  };
  readonly toolCalls: readonly ToolCall[];
}

interface SessionFailure {
  readonly code?: string;
  readonly cursor: string;
  readonly message: string;
  readonly type: string;
}

interface ToolCall {
  readonly callId?: string;
  readonly error?: unknown;
  readonly input?: unknown;
  readonly status: "completed" | "failed" | "requested" | "rejected";
  readonly toolName?: string;
}

/** Collects the run, failures, correlated logs, and most relevant authored source location. */
export async function inspectSession(
  client: DevToolsClient,
  sessionId: string,
): Promise<SessionInspection> {
  const [run, events, allLogs, sources] = await Promise.all([
    client.getRun(sessionId),
    client.getRunEvents(sessionId),
    client.listLogs(),
    client.listSources(),
  ]);
  const logs = allLogs
    .filter((entry) => logSessionId(entry) === sessionId)
    .slice(-MAX_SESSION_LOGS);
  const toolCalls = projectToolCalls(events);
  const failures = projectFailures(events, toolCalls);
  const source = resolveRelevantSource(logs, sources, toolCalls);
  return { failures, logs, run, source, toolCalls };
}

function projectToolCalls(events: readonly DevToolsRunEvent[]): readonly ToolCall[] {
  const calls = new Map<string, ToolCall>();
  for (const envelope of events) {
    const data = record(envelope.event.data);
    if (envelope.event.type === "actions.requested") {
      const actions = Array.isArray(data?.actions) ? data.actions : [];
      for (const value of actions) {
        const action = record(value);
        const callId = stringValue(action?.callId);
        if (callId === undefined) continue;
        calls.set(callId, {
          callId,
          input: action?.input,
          status: "requested",
          toolName: stringValue(action?.toolName) ?? stringValue(action?.subagentName),
        });
      }
      continue;
    }
    if (envelope.event.type !== "action.result") continue;
    const result = record(data?.result);
    const callId = stringValue(result?.callId);
    if (callId === undefined) continue;
    const previous = calls.get(callId);
    calls.set(callId, {
      callId,
      error: data?.error ?? (result?.isError === true ? result.output : undefined),
      input: previous?.input,
      status: statusValue(data?.status),
      toolName:
        previous?.toolName ?? stringValue(result?.toolName) ?? stringValue(result?.subagentName),
    });
  }
  return [...calls.values()];
}

function projectFailures(
  events: readonly DevToolsRunEvent[],
  toolCalls: readonly ToolCall[],
): readonly SessionFailure[] {
  const failures: SessionFailure[] = [];
  for (const envelope of events) {
    const type = envelope.event.type;
    if (type !== "session.failed" && type !== "step.failed" && type !== "turn.failed") continue;
    const data = record(envelope.event.data);
    failures.push({
      code: stringValue(data?.code),
      cursor: envelope.cursor,
      message: stringValue(data?.message) ?? "Unknown run failure",
      type,
    });
  }
  for (const call of toolCalls) {
    if (call.status !== "failed") continue;
    failures.push({
      cursor: call.callId ?? "unknown",
      message: errorMessage(call.error) ?? `${call.toolName ?? "Action"} failed`,
      type: "action.result",
    });
  }
  return failures;
}

function resolveRelevantSource(
  logs: readonly DevToolsLogEntry[],
  sources: readonly DevToolsSourceEntry[],
  toolCalls: readonly ToolCall[],
): SessionInspection["source"] {
  const errorLocation = [...logs]
    .reverse()
    .find((entry) => entry.level === "error" && sourcePath(entry.source))?.source;
  const anyLocation = [...logs].reverse().find((entry) => sourcePath(entry.source))?.source;
  const location = errorLocation ?? anyLocation;
  const failedTool = [...toolCalls].reverse().find((call) => call.status === "failed")?.toolName;
  const source = findSource(sources, sourcePath(location), failedTool);
  if (source === undefined) return undefined;
  return { location, path: source.path, sourceId: source.id };
}

function findSource(
  sources: readonly DevToolsSourceEntry[],
  locationPath: string | undefined,
  toolName: string | undefined,
): DevToolsSourceEntry | undefined {
  if (locationPath !== undefined) {
    const normalized = stripFileUrl(locationPath);
    const direct = sources.find(
      (source) =>
        source.id === locationPath ||
        source.path === locationPath ||
        normalized.endsWith(`/${source.path}`),
    );
    if (direct !== undefined) return direct;
  }
  if (toolName === undefined) return undefined;
  return sources.find((source) => {
    const basename = source.path
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/u, "");
    return basename === toolName && source.path.includes("/tools/");
  });
}

function logSessionId(entry: DevToolsLogEntry): string | undefined {
  const coordinates = record(entry.fields?.coordinates);
  return stringValue(coordinates?.session) ?? stringValue(entry.fields?.sessionId);
}

function sourcePath(source: DevToolsSourceLocation | undefined): string | undefined {
  return source?.path ?? source?.url;
}

function stripFileUrl(value: string): string {
  try {
    return value.startsWith("file:") ? new URL(value).pathname : value;
  } catch {
    return value;
  }
}

function statusValue(value: unknown): ToolCall["status"] {
  return value === "completed" || value === "failed" || value === "rejected" ? value : "completed";
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const object = record(value);
  return stringValue(object?.message) ?? stringValue(object?.error);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
