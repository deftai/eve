export interface DevToolsDiscovery {
  readonly appRoot: string;
  readonly browserCapability: string;
  readonly devtoolsInstanceId: string;
  readonly devtoolsUrl: string;
  readonly schemaVersion: number;
  readonly supervisorPid?: number;
  readonly updatedAt?: string;
}

export interface DevToolsRun {
  readonly createdAt: string;
  readonly eventCount: number;
  readonly retainedEventCount: number;
  readonly sessionId: string;
  readonly status: "completed" | "failed" | "running" | "waiting";
  readonly title: string;
  readonly updatedAt: string;
}

export interface DevToolsRunEvent {
  readonly cursor: string;
  readonly event: {
    readonly data?: unknown;
    readonly meta?: unknown;
    readonly type: string;
  };
  readonly sessionId: string;
}

export interface DevToolsLogEntry {
  readonly cursor: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly level: "debug" | "error" | "info" | "warn";
  readonly message: string;
  readonly source?: DevToolsSourceLocation;
  readonly stream: "console" | "stderr" | "stdout" | "system";
  readonly timestamp: string;
}

export interface DevToolsSourceLocation {
  readonly column?: number;
  readonly line?: number;
  readonly path?: string;
  readonly url?: string;
}

export interface DevToolsSourceEntry {
  readonly id: string;
  readonly kind: "authored";
  readonly loaded: boolean;
  readonly path: string;
  readonly revision?: string;
}
