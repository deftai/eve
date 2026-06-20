/** Local or remote server that backs one development TUI session. */
export type DevelopmentTuiTarget = LocalDevelopmentTarget | RemoteDevelopmentTarget;

/** A development TUI session backed by the local `eve dev` server. */
export interface LocalDevelopmentTarget {
  readonly kind: "local";
  readonly serverUrl: string;
  readonly appRoot: string;
}

/** A development TUI session connected to an existing remote server. */
export interface RemoteDevelopmentTarget {
  readonly kind: "remote";
  readonly serverUrl: string;
  readonly workspaceRoot: string;
}

/** Returns the URL host shown in remote status and authentication messages. */
export function remoteHost(target: RemoteDevelopmentTarget): string {
  return new URL(target.serverUrl).host;
}

/** CLI inputs from which one development target is resolved. */
export interface DevelopmentTargetInput {
  /** The address the TUI talks to: a local dev server, or the `--url` target. */
  readonly serverUrl: string;
  /** Absolute workspace root on disk. */
  readonly appRoot: string;
  /** Set when `--url` points the TUI at an already-running server. */
  readonly remoteServerUrl: string | undefined;
}

/**
 * The single authority that classifies a development session as local or
 * remote. A defined `remoteServerUrl` (i.e. `--url`) is the only signal:
 * locality is the operator's "connect to an existing server" choice, not a
 * property of the URL's hostname. Every downstream locality decision — client
 * credentials and runtime-artifact HMR — reads the resolved `kind` rather than
 * re-inspecting the URL.
 */
export interface EnvironmentResolver {
  resolve(input: DevelopmentTargetInput): DevelopmentTuiTarget;
}

/** Default {@link EnvironmentResolver} used by `eve dev`. */
export const developmentEnvironment: EnvironmentResolver = {
  resolve({ serverUrl, appRoot, remoteServerUrl }) {
    return remoteServerUrl === undefined
      ? { kind: "local", serverUrl, appRoot }
      : { kind: "remote", serverUrl, workspaceRoot: appRoot };
  },
};
