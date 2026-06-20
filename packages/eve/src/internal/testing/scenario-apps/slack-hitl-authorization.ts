import type { ScenarioAppDescriptor } from "#internal/testing/scenario-app.js";

/**
 * Packaged Slack app used by the HITL authorization contract scenario.
 *
 * The preload records outbound Slack Web API calls and returns successful
 * Slack-shaped responses. Inbound requests still cross the real HTTP route,
 * signature verifier, compiled channel, and workflow runtime.
 */
export const SLACK_HITL_AUTHORIZATION_DESCRIPTOR: ScenarioAppDescriptor = {
  dependencies: {
    zod: "^4.3.6",
  },
  files: {
    "agent/agent.ts": `import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-5.4-mini",
});
`,
    "agent/channels/slack.ts": `import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  credentials: {
    botToken: "xoxb-scenario",
    signingSecret: "scenario-signing-secret",
  },
  onAppMention() {
    return {
      auth: {
        attributes: { source: "shared-scenario-auth" },
        authenticator: "scenario",
        principalId: "shared-principal",
        principalType: "user",
      },
    };
  },
});
`,
    "agent/instructions.md": `Call guarded-echo only when the user explicitly requests it.
`,
    "agent/tools/guarded-echo.ts": `import { appendFile } from "node:fs/promises";

import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

export default defineTool({
  description: "Record a marker after the caller approves this operation.",
  inputSchema: z.object({
    note: z.string(),
  }),
  needsApproval: always(),
  async execute(input) {
    const executionsPath = process.env.EVE_SLACK_TOOL_EXECUTIONS_PATH;
    if (!executionsPath) {
      throw new Error("EVE_SLACK_TOOL_EXECUTIONS_PATH is required.");
    }
    await appendFile(executionsPath, JSON.stringify({ note: input.note }) + "\\n", "utf8");
    return { recorded: input.note };
  },
});
`,
    "slack-fetch-preload.mjs": `import { appendFile } from "node:fs/promises";

const callsPath = process.env.EVE_SLACK_CALLS_PATH;
if (!callsPath) {
  throw new Error("EVE_SLACK_CALLS_PATH is required.");
}

const originalFetch = globalThis.fetch.bind(globalThis);
let sequence = 0;

globalThis.fetch = async (input, init) => {
  const url = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.toString()
      : String(input);

  if (!url.startsWith("https://slack.com/api/")) {
    return originalFetch(input, init);
  }

  sequence += 1;
  const responseTs = \`1700000001.\${String(sequence).padStart(6, "0")}\`;
  const body = await readBody(input, init);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());

  await appendFile(
    callsPath,
    JSON.stringify({
      body,
      headers,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      responseTs,
      url,
    }) + "\\n",
    "utf8",
  );

  return Response.json({
    ok: true,
    message_ts: responseTs,
    ts: responseTs,
    view: { id: \`V\${sequence}\` },
  });
};

async function readBody(input, init) {
  if (typeof init?.body === "string") return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (input instanceof Request) return input.clone().text();
  return "";
}
`,
  },
  installDependencies: true,
  name: "slack-hitl-authorization",
};
