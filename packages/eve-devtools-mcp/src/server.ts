import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  continueSessionAcrossInstances,
  createSessionAcrossInstances,
  inspectSessionAcrossInstances,
  listSessionsAcrossInstances,
  type ResolveDevToolsInstances,
} from "./instances.js";

/** Creates the experimental Eve DevTools MCP server and registers its tools. */
export function createEveDevToolsMcpServer(resolveInstances: ResolveDevToolsInstances): McpServer {
  const server = new McpServer({ name: "eve-devtools", version: "0.0.1" });

  server.registerTool(
    "create_session",
    {
      description:
        "Create a session in a running local Eve agent. Use this after a code fix to rerun the original prompt and verify the behavior. When multiple agents are running, pass appRoot.",
      inputSchema: {
        appRoot: z
          .string()
          .optional()
          .describe("Target app root. Required only when multiple Eve agents are running."),
        message: z.string().min(1).describe("The first user message for the new session."),
      },
    },
    async ({ appRoot, message }) =>
      textResult(await createSessionAcrossInstances(await resolveInstances(), message, appRoot)),
  );

  server.registerTool(
    "continue_session",
    {
      description:
        "Send another user message to an existing waiting Eve session. The owning local agent is resolved automatically from the session ID.",
      inputSchema: {
        message: z.string().min(1).describe("The next user message."),
        sessionId: z.string().min(1).describe("The Eve session ID."),
      },
    },
    async ({ message, sessionId }) =>
      textResult(
        await continueSessionAcrossInstances(await resolveInstances(), sessionId, message),
      ),
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "List sessions retained by the running local Eve DevTools server. Use this to discover a session ID before investigating a run.",
      inputSchema: {},
    },
    async () => textResult(await listSessionsAcrossInstances(await resolveInstances())),
  );

  server.registerTool(
    "inspect_session",
    {
      description:
        "Inspect a local Eve session by ID. Returns failed tool inputs/results, run failures, session-correlated logs, and authored source locations. Use this first when asked to debug or fix a failing Eve agent session.",
      inputSchema: {
        sessionId: z.string().min(1).describe("The Eve session ID copied from DevTools."),
      },
    },
    async ({ sessionId }) =>
      textResult(await inspectSessionAcrossInstances(await resolveInstances(), sessionId)),
  );

  return server;
}

function textResult(value: unknown) {
  return { content: [{ text: JSON.stringify(value, null, 2), type: "text" as const }] };
}
