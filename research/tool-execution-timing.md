---
issue: https://github.com/vercel/eve/pull/251
status: validated
last_updated: "2026-06-25"
---

# Tool execution timing and provider fan-out

## Scope

This investigation found two independent mechanisms that both affect what the
TUI shows during a ten-search turn:

- provider-managed web search determines how many actions exist at all;
- local tool scheduling determines when an action that already exists begins.

They need different fixes. Starting a local executor earlier cannot turn one
aggregate provider call into ten actions. Conversely, changing provider routing
does not remove the local execution delay for authored tools or Bash.

## Provider-managed Parallel Search

Commit [`5f0f69f`](https://github.com/vercel/eve/commit/5f0f69f5b57169fb88b617a1273511b8925519b9)
made every gateway model use the `parallel` backend. The current
[`resolveWebSearchBackend`](../packages/eve/src/harness/provider-tools.ts#L68-L95)
checks `modelRef.source === undefined` before it examines the model provider,
then [`resolveWebSearchProviderTool`](../packages/eve/src/harness/provider-tools.ts#L105-L134)
creates `gateway.tools.parallelSearch()`.

The installed Gateway SDK defines one provider-executed `gateway.parallel_search`
tool. Its input is an `objective`, optional `search_queries` array, and optional
`mode`. The exact SDK source inspected for this run was
[`@ai-sdk/gateway@4.0.0`](../node_modules/.pnpm/@ai-sdk+gateway@4.0.0_zod@4.4.3/node_modules/@ai-sdk/gateway/src/tool/parallel-search.ts#L167-L294).

The current Parallel eval deliberately makes two aggregate `web_search` calls,
with five `search_queries` values in each. It requires every literal query once,
not ten calls. See [`fanout-web-search.eval.ts`](../e2e/fixtures/agent-tools/evals/static-tools/fanout-web-search.eval.ts#L11-L89)
and its input assertion in [`parallel-search.ts`](../e2e/fixtures/agent-tools/evals/static-tools/parallel-search.ts#L37-L60).

### What the existing evidence proves

- eve passes ten distinct query strings to the Parallel tool in two aggregate
  tool inputs.
- The eval checks that each returned aggregate result has a source URL and that
  the final response cites URLs returned by the tool.
- The event emitter can only project provider call IDs it has received. It
  records a provider call when the stream yields it, and
  [`createProviderStreamActionBatch`](../packages/eve/src/harness/stream-actions.ts#L17-L95)
  coalesces those observed calls for one zero-delay task. It does not expand a
  `search_queries` array into invented action IDs.

### What it does not prove

The action trace does not reveal the Gateway's internal query execution. It
does not prove that ten queries run concurrently, sequentially, or in an
N-by-N pattern. The uniqueness assertion rules out duplicate query strings in
the two inputs, but it cannot observe work behind the provider boundary.

For a physical-concurrency claim, collect a Gateway-side trace that identifies
each input query and its request start and end. No client-side timing comparison
can substitute for that trace.

### Consequence for the ten-live-row contract

The TUI can truthfully show two provider actions for the current eval. It cannot
truthfully show ten pending actions before the provider has emitted ten action
IDs. It could show ten logical queries inside an aggregate action, but those
would not have independent action lifecycles.

If the product contract is exactly ten independently pending search rows for a
gateway Anthropic model, the routing policy must change. The narrow change is
to restore native Anthropic search for gateway Anthropic model IDs and restore
the gateway provider pin needed by that provider-specific tool. That is the
pre-#251 behavior removed by
[`5f0f69f`](https://github.com/vercel/eve/commit/5f0f69f5b57169fb88b617a1273511b8925519b9#diff-7d0cb53e8a88eec1a28dcf49c0f74c222ec7d72254ed58262d231f230d723e0d).

That routing change would make ten calls possible, not guaranteed. It still
needs an eval that asks the model for ten separate native tool calls and asserts
ten emitted action IDs before the first result. It deliberately narrows #251's
all-gateway-uses-Parallel policy.

## Local executor scheduling

The AI SDK has two relevant phases. In the installed `ai@7.0.0` source,
[`onInputAvailable`](../node_modules/.pnpm/ai@7.0.0_zod@4.4.3/node_modules/ai/src/generate-text/invoke-tool-callbacks-from-stream.ts#L63-L79)
runs when a complete tool input arrives. The normal executor only queues local
calls at that point and starts the queued calls on `model-call-end`; see
[`execute-tools-from-stream.ts`](../node_modules/.pnpm/ai@7.0.0_zod@4.4.3/node_modules/ai/src/generate-text/execute-tools-from-stream.ts#L73-L239).

eve consumes the SDK stream, but it does not own that queue. The relevant
sequence is:

```text
model tool-call
  |- eve observes it and emits actions.requested
  `- AI SDK invokes onInputAvailable
       `- gate waits for actions.requested, then starts the local executor
          `- AI SDK's normal phase awaits the same execution at model-call-end
```

The implementation keeps this order with an action-request gate. The gate opens
only after [`emitStreamContent`](../packages/eve/src/harness/emission.ts#L432-L451)
has emitted `actions.requested`. The local wrapper in
[`tools.ts`](../packages/eve/src/harness/tools.ts#L199-L284) then starts a valid,
auto-approved local executor and caches its promise by call ID. The SDK's normal
`execute` later awaits that same promise, so the executor runs once.

Provider-executed tools have no local executor, and approval-gated tools do not
start early. The approval case has a focused regression test in
[`tools.test.ts`](../packages/eve/src/harness/tools.test.ts#L327-L361).

The result is overlap, not a new dependency model. A tool needed by a later
model step still waits for the earlier result. The controlled integration test
holds the model stream after the first of ten independent calls and proves that
the first HTTP fetch starts after its action request but before model-call end.
It also proves a second-step dependent call receives the first result. See
[`tool-loop-eager-execution.integration.test.ts`](../packages/eve/src/harness/tool-loop-eager-execution.integration.test.ts#L153-L258)
and [`tool-loop-eager-execution.integration.test.ts`](../packages/eve/src/harness/tool-loop-eager-execution.integration.test.ts#L261-L335).

One limit remains: the SDK emits a terminal local tool result after
`model-call-end`. Starting the executor early overlaps its work with the rest
of model output, but it does not make a terminal result visible before that
boundary.

## Measured impact

The real-model experiment used ten baseline and ten treatment trials of the
authored `streamed-action` eval. Each action records its execution timestamps
and holds for 500 ms, so the run can distinguish concurrent execution from a
serialized executor. See [`streamed-action.ts`](../e2e/fixtures/agent-tools/agent/tools/streamed-action.ts#L1-L20)
and [`fanout-authored.eval.ts`](../e2e/fixtures/agent-tools/evals/static-tools/fanout-authored.eval.ts#L24-L50).

Baseline was commit `f90c2162ea8c485a2ad2be59b04e0eee738f7ae3`. Treatment was
the current worktree with the eager local-execution change. The trace collector
records action, executor, and result timestamps in
[`tool-fanout-timing.ts`](../e2e/fixtures/agent-tools/evals/static-tools/tool-fanout-timing.ts#L1-L211).

| Metric, milliseconds                     | Baseline p50 / p95 | Treatment p50 / p95 | p50 delta | Bootstrap 95% CI | Mann-Whitney p | Result          |
| ---------------------------------------- | -----------------: | ------------------: | --------: | ---------------- | -------------: | --------------- |
| First executor start after first request |       78.5 / 131.5 |             0 / 0.6 |     -78.5 | -91.5 to -68     |        <0.0001 | significant     |
| Worst request-to-executor delay          |       78.5 / 131.5 |           12 / 15.1 |     -66.5 | -79.5 to -56     |         0.0001 | significant     |
| First action result after first request  |        591 / 641.5 |           501 / 502 |       -90 | -103.5 to -76    |         0.0001 | significant     |
| Final action result after first request  |        682 / 731.6 |         649 / 720.2 |       -33 | -65 to 6         |         0.0639 | not significant |

The zero-millisecond p50 means the request event and executor start fell in the
same millisecond. It does not mean the gate has no cost.

The head-of-line improvement is real under the predefined comparison rule. The
total fan-out completion time was not significantly lower because the model's
tool-call emission time still determines when the final call can begin. This is
why early execution helps the first useful result more than the tail of a wide
fan-out.

The comparator uses 20,000 deterministic bootstrap resamples and a two-sided
Mann-Whitney test. It calls a metric significant only with at least ten samples
per group, p below 0.05, and a bootstrap median-difference interval that
excludes zero. The implementation is in
[`compare-tool-execution-latency.mjs`](../scripts/compare-tool-execution-latency.mjs#L119-L221).

These samples are evidence for this fixture and model configuration, not a
universal latency guarantee. The baseline and treatment were separate runs, so
model and external variance remain possible confounders.

## Bash-curl status

The Bash eval sends ten separate `curl` calls to a fixed-latency local endpoint
and records client, server, and executor timestamps. Its fixture is in
[`bash-curl-latency-fanout.eval.ts`](../e2e/fixtures/agent-tools-sandbox/evals/sandbox/bash-curl-latency-fanout.eval.ts#L1-L51)
and the parser is in
[`bash-latency.ts`](../e2e/fixtures/agent-tools-sandbox/evals/sandbox/bash-latency.ts#L1-L260).

One end-to-end run reached all ten sandbox commands. Repeated real-model runs
timed out before any tool call was emitted, so there is no valid Bash baseline
and treatment comparison yet. Do not treat the authored-tool statistics as a
measured Bash result.

## Reproduction

Run the controlled behavioral test with the integration config:

```sh
pnpm --filter eve exec vitest run --config vitest.integration.config.ts \
  src/harness/tool-loop-eager-execution.integration.test.ts
```

After collecting result directories from equal numbers of baseline and
treatment trials, compare their embedded traces:

```sh
node scripts/compare-tool-execution-latency.mjs \
  <baseline-results-dir> <treatment-results-dir> markdown
```

The comparison accepts only recorded timestamps. It does not calculate a
counterfactual "estimated eager" value.
