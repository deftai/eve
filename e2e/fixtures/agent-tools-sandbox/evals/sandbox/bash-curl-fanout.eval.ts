import { defineEval } from "eve/evals";

import {
  bashCurlRequestsReachedBarrier,
  bashRequestsPrecedeFirstResult,
  formatBashFanoutTrace,
} from "./bash-fanout.js";
import { FANOUT_SERVER_URL } from "./shared.js";

const REQUESTS = [
  { label: "search-01", query: "Vercel AI Gateway documentation" },
  { label: "search-02", query: "Anthropic Claude API documentation" },
  { label: "search-03", query: "OpenAI API documentation" },
  { label: "search-04", query: "Node.js fetch documentation" },
  { label: "search-05", query: "React useEffect documentation" },
  { label: "search-06", query: "TypeScript handbook generics" },
  { label: "search-07", query: "MDN Fetch API documentation" },
  { label: "search-08", query: "GitHub Actions documentation" },
  { label: "search-09", query: "AWS Lambda documentation" },
  { label: "search-10", query: "Google Search Central documentation" },
] as const;

export default defineEval({
  description: "Sandbox Bash: ten independent curl requests start before the barrier releases.",
  async test(t) {
    const turn = await t.send(
      [
        `Call the \`bash\` tool exactly ${REQUESTS.length} separate times in one tool-use step.`,
        "Run each command below exactly once. Do not combine commands, use a loop, background a process, or call another tool.",
        ...REQUESTS.map((request) => `${request.label}: \`${commandForRequest(request)}\``),
        "After all commands return, reply with exactly: bash curl fanout complete",
      ].join("\n"),
    );
    turn.expectOk();
    t.log(formatBashFanoutTrace(turn.events));

    t.didNotFail();
    t.completed();
    t.calledTool("bash", { isError: false, times: REQUESTS.length });
    t.noFailedActions();
    t.event(
      (events) => bashRequestsPrecedeFirstResult({ events, expectedCallCount: REQUESTS.length }),
      "all ten Bash actions are requested before the first result",
    );
    t.event(
      (events) => bashCurlRequestsReachedBarrier({ events, expectedRequests: REQUESTS }),
      "all ten Eve-side Bash curl requests reached the HTTP barrier before release",
    );
  },
});

function commandForRequest(request: (typeof REQUESTS)[number]): string {
  const url = new URL(FANOUT_SERVER_URL);
  url.searchParams.set("label", request.label);
  url.searchParams.set("q", request.query);

  return [
    "started=$(date +%s%3N)",
    `response=$(curl -fsS --max-time 20 '${url.href}')`,
    "completed=$(date +%s%3N)",
    'printf \'{"clientStartedAtMs":%s,"clientCompletedAtMs":%s,"server":%s}\\n\' "$started" "$completed" "$response"',
  ].join("; ");
}
