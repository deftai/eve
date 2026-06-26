import { describe, expect, it } from "vitest";

import { resolveRuntimeActionResultsForKeys } from "#harness/runtime-actions.js";

describe("resolveRuntimeActionResultsForKeys", () => {
  it("keeps the first result when a late callback duplicates a cancelled action", () => {
    const cancelled = {
      callId: "call-remote",
      isError: true,
      kind: "subagent-result" as const,
      output: { code: "REMOTE_AGENT_CANCELLED", message: "Remote agent was cancelled." },
      subagentName: "research",
    };

    expect(
      resolveRuntimeActionResultsForKeys({
        pendingKeys: ["subagent-call:research:call-remote"],
        results: [
          cancelled,
          {
            callId: "call-remote",
            kind: "subagent-result",
            output: "late completed output",
            subagentName: "research",
          },
        ],
      }),
    ).toEqual([cancelled]);
  });
});
