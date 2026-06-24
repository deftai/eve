import { EVE_SESSION_ID_HEADER } from "#protocol/message.js";
import {
  createEveCallbackRoutePath,
  createEveCancelSessionRoutePath,
  EVE_CREATE_SESSION_ROUTE_PATH,
} from "#protocol/routes.js";
import { createWorkflowCallbackUrl } from "#execution/workflow-callback-url.js";
import { formatSubagentInvocation } from "#execution/subagent-invocation.js";
import type { HarnessSession } from "#harness/types.js";
import type { RuntimeRemoteAgentCallActionRequest } from "#runtime/actions/types.js";
import type { RuntimeSubagentRegistry } from "#runtime/subagents/registry.js";
import type { ResolvedRuntimeRemoteAgentNode } from "#runtime/types.js";

export async function startRemoteAgentSession(input: {
  readonly action: RuntimeRemoteAgentCallActionRequest;
  readonly callbackBaseUrl: string | undefined;
  readonly remote: ResolvedRuntimeRemoteAgentNode;
  readonly session: HarnessSession;
}): Promise<{ readonly continuationToken: string; readonly sessionId: string }> {
  const callbackToken = input.session.continuationToken;
  if (!callbackToken) {
    throw new Error("Cannot dispatch remote agent without a parent continuation token.");
  }
  if (!input.callbackBaseUrl) {
    throw new Error("Cannot dispatch remote agent without a callback base URL.");
  }

  const headers = await resolveRemoteAgentRequestHeaders(input.remote);
  const response = await fetch(createRemoteAgentSessionUrl(input.remote), {
    body: JSON.stringify({
      callback: {
        callId: input.action.callId,
        subagentName: input.action.remoteAgentName,
        token: callbackToken,
        url: createWorkflowCallbackUrl(
          input.callbackBaseUrl,
          createEveCallbackRoutePath(callbackToken),
        ),
      },
      message: formatRemoteAgentCallInputMessage(input.action),
      mode: "task",
      outputSchema:
        (input.action.input.outputSchema as object | undefined) ?? input.remote.outputSchema,
    }),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `Remote agent "${input.action.remoteAgentName}" create-session request failed with HTTP ${response.status}.`,
    );
  }

  let body: { readonly continuationToken?: unknown; readonly sessionId?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error(
      `Remote agent "${input.action.remoteAgentName}" create-session response was not valid JSON.`,
    );
  }

  const sessionIdFromHeader = response.headers.get(EVE_SESSION_ID_HEADER);
  const sessionId =
    sessionIdFromHeader && sessionIdFromHeader.length > 0 ? sessionIdFromHeader : body.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error(
      `Remote agent "${input.action.remoteAgentName}" create-session response did not include a session id.`,
    );
  }
  if (typeof body.continuationToken !== "string" || body.continuationToken.length === 0) {
    throw new Error(
      `Remote agent "${input.action.remoteAgentName}" create-session response did not include a continuation token.`,
    );
  }

  return { continuationToken: body.continuationToken, sessionId };
}

/** Cancels a remote child through the public eve cancellation endpoint. */
export async function cancelRemoteAgentSession(input: {
  readonly remote: ResolvedRuntimeRemoteAgentNode;
  readonly sessionId: string;
}): Promise<void> {
  const headers = await resolveRemoteAgentRequestHeaders(input.remote);
  const response = await fetch(
    new URL(
      createEveCancelSessionRoutePath(input.sessionId),
      `${trimTrailingSlash(input.remote.url)}/`,
    ).toString(),
    {
      body: JSON.stringify({
        scope: "session",
      }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    },
  );

  if (!response.ok && response.status !== 409) {
    throw new Error(`Remote agent cancellation failed with HTTP ${response.status}.`);
  }
}

export function resolveRemoteAgentForAction(input: {
  readonly nodeId: string;
  readonly registry: RuntimeSubagentRegistry["subagentsByNodeId"];
  readonly remoteAgentName: string;
}): ResolvedRuntimeRemoteAgentNode {
  const registered = input.registry.get(input.nodeId);
  const definition = registered?.definition;
  if (definition?.kind !== "remote") {
    throw new Error(`Missing remote agent "${input.remoteAgentName}" in runtime registry.`);
  }
  return definition;
}

function createRemoteAgentSessionUrl(remote: ResolvedRuntimeRemoteAgentNode): string {
  return new URL(EVE_CREATE_SESSION_ROUTE_PATH, `${trimTrailingSlash(remote.url)}/`).toString();
}

async function resolveRemoteAgentRequestHeaders(
  remote: ResolvedRuntimeRemoteAgentNode,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (remote.headers !== undefined) {
    Object.assign(
      headers,
      typeof remote.headers === "function" ? await remote.headers() : remote.headers,
    );
  }
  if (remote.auth !== undefined) {
    Object.assign(headers, (await remote.auth()).headers);
  }
  return headers;
}

function formatRemoteAgentCallInputMessage(input: RuntimeRemoteAgentCallActionRequest): string {
  const message = typeof input.input.message === "string" ? input.input.message : "";
  return formatSubagentInvocation({
    description: input.description,
    message,
    name: input.remoteAgentName,
  }).message;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
