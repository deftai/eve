import type { ScenarioAppDescriptor } from "#internal/testing/scenario-app.js";

export const GITHUB_ROUTE_PORTABILITY_DESCRIPTOR: ScenarioAppDescriptor = {
  files: {
    "agent/channels/github.ts": `import { githubChannel } from "eve/channels/github";

export const assessmentSchema = {
  "~standard": {
    version: 1,
    vendor: "portability-test",
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      }),
    },
  },
} as const;

export default githubChannel({
  botName: "testbot",
  onIssue: (_ctx, issue) =>
    issue.action === "opened" ? { auth: null, outputSchema: assessmentSchema } : null,
});
`,
    "agent/schedules/retry-assessment.ts": `import { defineSchedule } from "eve/schedules";

import github, { assessmentSchema } from "../channels/github.js";

export default defineSchedule({
  cron: "*/5 * * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(
      receive(github, {
        auth: appAuth,
        message: "Retry the assessment.",
        outputSchema: assessmentSchema,
        target: { owner: "vercel", repo: "eve", issueNumber: 214, repositoryId: 123 },
      }),
    );
  },
});
`,
  },
  name: "github-route-portability",
};
