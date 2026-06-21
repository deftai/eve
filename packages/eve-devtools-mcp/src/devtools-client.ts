import type {
  DevToolsDiscovery,
  DevToolsLogEntry,
  DevToolsRun,
  DevToolsRunEvent,
  DevToolsSourceEntry,
} from "./types.js";

export interface DevToolsClient {
  continueRun(sessionId: string, message: string): Promise<DevToolsRun>;
  createRun(message: string): Promise<DevToolsRun>;
  getRun(sessionId: string): Promise<DevToolsRun>;
  getRunEvents(sessionId: string): Promise<readonly DevToolsRunEvent[]>;
  listLogs(): Promise<readonly DevToolsLogEntry[]>;
  listRuns(): Promise<readonly DevToolsRun[]>;
  listSources(): Promise<readonly DevToolsSourceEntry[]>;
}

export class DevToolsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DevToolsApiError";
    this.status = status;
  }
}

/** Creates a capability-authenticated client for the local DevTools HTTP API. */
export function createDevToolsClient(
  discovery: DevToolsDiscovery,
  fetchImplementation: typeof fetch = fetch,
): DevToolsClient {
  const baseUrl = new URL(discovery.devtoolsUrl);
  baseUrl.hash = "";

  const get = async <T>(path: string): Promise<T> => {
    const response = await fetchImplementation(new URL(path, baseUrl), {
      headers: { authorization: `Bearer ${discovery.browserCapability}` },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new DevToolsApiError(
        response.status,
        `Eve DevTools API returned ${response.status} for ${path}: ${body.trim() || response.statusText}`,
      );
    }
    return (await response.json()) as T;
  };

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await fetchImplementation(new URL(path, baseUrl), {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${discovery.browserCapability}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) {
      const responseBody = await response.text();
      throw new DevToolsApiError(
        response.status,
        `Eve DevTools API returned ${response.status} for ${path}: ${responseBody.trim() || response.statusText}`,
      );
    }
    return (await response.json()) as T;
  };

  return {
    async continueRun(sessionId, message) {
      const response = await post<{ readonly run: DevToolsRun }>(
        `/api/v1/runs/${encodeURIComponent(sessionId)}/messages`,
        { message },
      );
      return response.run;
    },
    async createRun(message) {
      const response = await post<{ readonly run: DevToolsRun }>("/api/v1/runs", { message });
      return response.run;
    },
    async getRun(sessionId) {
      const response = await get<{ readonly run: DevToolsRun }>(
        `/api/v1/runs/${encodeURIComponent(sessionId)}`,
      );
      return response.run;
    },
    async getRunEvents(sessionId) {
      const response = await get<{ readonly events: readonly DevToolsRunEvent[] }>(
        `/api/v1/runs/${encodeURIComponent(sessionId)}/events?cursor=0`,
      );
      return response.events;
    },
    async listLogs() {
      const response = await get<{ readonly entries: readonly DevToolsLogEntry[] }>(
        "/api/v1/logs?cursor=0",
      );
      return response.entries;
    },
    async listRuns() {
      const response = await get<{ readonly runs: readonly DevToolsRun[] }>("/api/v1/runs");
      return response.runs;
    },
    async listSources() {
      const response = await get<{ readonly sources: readonly DevToolsSourceEntry[] }>(
        "/api/v1/sources",
      );
      return response.sources;
    },
  };
}
