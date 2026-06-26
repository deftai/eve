import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

const WAIT_TOOL_NAME = "wait-for-cancellation";

export default defineAgent({
  model: mockModel(({ lastUserMessage }) =>
    lastUserMessage?.includes(WAIT_TOOL_NAME) === true
      ? {
          toolCalls: [
            {
              id: "call_wait_for_cancellation",
              name: WAIT_TOOL_NAME,
            },
          ],
        }
      : `cancellation-follow-up-ok:${lastUserMessage ?? ""}`,
  ),
  modelContextWindowTokens: 100_000,
});
