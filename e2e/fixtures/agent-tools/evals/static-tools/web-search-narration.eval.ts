import type { HandleMessageStreamEvent } from "eve/client";
import { defineEval } from "eve/evals";

const TOOL_NAME = "web_search";
const ANSWER = "New York Knicks";

function narratedSearchAnswers(events: readonly HandleMessageStreamEvent[]): boolean {
  const [request] = events.flatMap((event, eventIndex) =>
    event.type !== "actions.requested"
      ? []
      : event.data.actions.flatMap((action) =>
          action.kind === "tool-call" && action.toolName === TOOL_NAME
            ? [{ callId: action.callId, eventIndex }]
            : [],
        ),
  );
  if (request === undefined) return false;

  const narrated = events
    .slice(0, request.eventIndex)
    .some(
      (event) =>
        event.type === "message.completed" &&
        event.data.finishReason === "tool-calls" &&
        typeof event.data.message === "string" &&
        event.data.message.trim().length > 0,
    );
  if (!narrated) return false;

  const resultIndex = events.findIndex(
    (event, index) =>
      index > request.eventIndex &&
      event.type === "action.result" &&
      event.data.result.kind === "tool-result" &&
      event.data.result.callId === request.callId &&
      event.data.result.toolName === TOOL_NAME,
  );
  if (resultIndex < 0) return false;

  return events
    .slice(resultIndex + 1)
    .some(
      (event) =>
        event.type === "message.completed" &&
        event.data.finishReason !== "tool-calls" &&
        typeof event.data.message === "string" &&
        event.data.message.includes(ANSWER),
    );
}

export default defineEval({
  description: "Provider tools smoke: narrated gateway web search continues to an answer.",
  async test(t) {
    const turn = await t.send(
      [
        `Before calling \`${TOOL_NAME}\`, write one short plain-text sentence saying you are checking the standings.`,
        `Then call \`${TOOL_NAME}\` to determine who won the 2026 NBA Finals.`,
        `After the search returns, answer exactly: "${ANSWER}".`,
      ].join(" "),
    );

    t.succeeded();
    t.calledTool(TOOL_NAME);
    t.noFailedActions();
    turn.messageIncludes(ANSWER);
    turn.eventsSatisfy("narrated provider search returns a final answer", narratedSearchAnswers);
  },
});
