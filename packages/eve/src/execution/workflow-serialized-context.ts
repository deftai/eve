import type { SessionCapabilities } from "#channel/types.js";
import type { RuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import type { RunMode } from "#shared/run-mode.js";
import { isObject } from "#shared/guards.js";

const BUNDLE_KEY = "eve.bundle";
const CAPABILITIES_KEY = "eve.capabilities";
const CHANNEL_KEY = "eve.channel";
const CONTINUATION_TOKEN_KEY = "eve.continuationToken";
const MODE_KEY = "eve.mode";
const PARENT_SESSION_KEY = "eve.parentSession";
const SESSION_ID_KEY = "eve.sessionId";

interface SerializedBundle {
  readonly nodeId?: string;
  readonly source: RuntimeCompiledArtifactsSource;
}

export interface WorkflowEntrySerializedContext {
  readonly bundle: SerializedBundle;
  readonly capabilities?: SessionCapabilities;
  readonly continuationToken: string;
  readonly mode: RunMode;
}

/** Reads and validates the serialized fields consumed by the workflow driver. */
export function readWorkflowEntrySerializedContext(
  context: Record<string, unknown>,
): WorkflowEntrySerializedContext {
  const bundle = context[BUNDLE_KEY];
  if (!isSerializedBundle(bundle)) {
    throw new Error(`Serialized context is missing a valid "${BUNDLE_KEY}" value.`);
  }

  const mode = context[MODE_KEY];
  if (mode !== "conversation" && mode !== "task") {
    throw new Error(`Serialized context is missing a valid "${MODE_KEY}" value.`);
  }

  const capabilities = readCapabilities(context[CAPABILITIES_KEY]);
  const continuationToken = context[CONTINUATION_TOKEN_KEY];
  return {
    bundle,
    capabilities,
    continuationToken: typeof continuationToken === "string" ? continuationToken : "",
    mode,
  };
}

/** Returns the serialized channel record when present and object-shaped. */
export function readSerializedChannel(
  context: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const channel = context[CHANNEL_KEY];
  return isObject(channel) ? channel : undefined;
}

/** Returns the serialized parent-session record when present and object-shaped. */
export function readSerializedParentSession(
  context: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const parent = context[PARENT_SESSION_KEY];
  return isObject(parent) ? parent : undefined;
}

/** Returns the serialized session id when present. */
export function readSerializedSessionId(context: Record<string, unknown>): string | undefined {
  const sessionId = context[SESSION_ID_KEY];
  return typeof sessionId === "string" ? sessionId : undefined;
}

/** Seeds the workflow run id into the serialized context. */
export function writeSerializedSessionId(
  context: Record<string, unknown>,
  sessionId: string,
): void {
  context[SESSION_ID_KEY] = sessionId;
}

function readCapabilities(value: unknown): SessionCapabilities | undefined {
  if (value === undefined) return undefined;
  if (
    !isObject(value) ||
    (value.requestInput !== undefined && typeof value.requestInput !== "boolean")
  ) {
    throw new Error(`Serialized context contains an invalid "${CAPABILITIES_KEY}" value.`);
  }
  return value;
}

function isSerializedBundle(value: unknown): value is SerializedBundle {
  if (!isObject(value)) return false;
  if (value.nodeId !== undefined && typeof value.nodeId !== "string") return false;
  return isRuntimeCompiledArtifactsSource(value.source);
}

function isRuntimeCompiledArtifactsSource(value: unknown): value is RuntimeCompiledArtifactsSource {
  if (!isObject(value)) return false;
  if (value.kind === "bundled") return true;
  return (
    value.kind === "disk" &&
    typeof value.appRoot === "string" &&
    (value.moduleMapLoaderPath === undefined || typeof value.moduleMapLoaderPath === "string") &&
    (value.sandboxAppRoot === undefined || typeof value.sandboxAppRoot === "string")
  );
}
