import { defineEval } from "eve/evals";

import {
  formatParallelSearchTrace,
  parallelSearchFindingsAreGrounded,
  parallelSearchRequestsPrecedeFirstResult,
  parallelSearchResultsHaveSources,
  parallelSearchUsesExpectedQueries,
} from "./parallel-search.js";

const TOOL_NAME = "web_search";
const SEARCH_QUERIES = [
  "Vercel AI Gateway documentation",
  "Anthropic Claude API documentation",
  "OpenAI API documentation",
  "Node.js fetch documentation",
  "React useEffect documentation",
  "TypeScript handbook generics",
  "MDN Fetch API documentation",
  "GitHub Actions documentation",
  "AWS Lambda documentation",
  "Google Search Central documentation",
] as const;
// Parallel accepts at most five `search_queries` per request, so ten research
// intents deliberately form two aggregate provider calls rather than ten.
const PARALLEL_REQUEST_COUNT = 2;
const QUERIES_PER_REQUEST = SEARCH_QUERIES.length / PARALLEL_REQUEST_COUNT;

export default defineEval({
  description:
    "Parallel Search: two aggregate requests cover ten queries and ground cited findings.",
  async test(t) {
    const turn = await t.send(
      [
        `Use the provider-managed \`${TOOL_NAME}\` tool exactly ${PARALLEL_REQUEST_COUNT} times in one tool-use step.`,
        `Each tool call must contain exactly ${QUERIES_PER_REQUEST} \`search_queries\` values.`,
        `Use every literal query exactly once, without rewriting it: ${SEARCH_QUERIES.map((query) => JSON.stringify(query)).join(", ")}.`,
        "Do not use any other tool and do not issue an additional web search after the first result.",
        "After both searches return, write exactly ten labelled findings, Q01 through Q10.",
        "Every finding must include one distinct Markdown source URL returned by web_search, formatted as: Q01: finding ([source](https://example.com/path)).",
      ].join("\n"),
    );
    turn.expectOk();
    t.log(formatParallelSearchTrace({ events: turn.events, toolName: TOOL_NAME }));

    t.didNotFail();
    t.completed();
    t.calledTool(TOOL_NAME, { isError: false, times: PARALLEL_REQUEST_COUNT });
    t.noFailedActions();
    t.event(
      (events) =>
        parallelSearchRequestsPrecedeFirstResult({
          events,
          expectedCallCount: PARALLEL_REQUEST_COUNT,
          toolName: TOOL_NAME,
        }),
      "both aggregate Parallel requests precede the first provider result",
    );
    t.event(
      (events) =>
        parallelSearchUsesExpectedQueries({
          events,
          expectedQueries: SEARCH_QUERIES,
          expectedRequestCount: PARALLEL_REQUEST_COUNT,
          queriesPerRequest: QUERIES_PER_REQUEST,
          toolName: TOOL_NAME,
        }),
      "Parallel received the ten requested queries in two aggregate requests",
    );
    t.event(
      (events) =>
        parallelSearchResultsHaveSources({
          events,
          expectedResultCount: PARALLEL_REQUEST_COUNT,
          toolName: TOOL_NAME,
        }),
      "each Parallel response carries a search id and at least one source URL",
    );
    t.event(
      (events) =>
        parallelSearchFindingsAreGrounded({
          events,
          expectedFindingCount: SEARCH_QUERIES.length,
          message: turn.message,
          toolName: TOOL_NAME,
        }),
      "ten labelled findings cite source URLs returned by Parallel",
    );
  },
});
