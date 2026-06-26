import { afterEach, describe, expect, it, vi } from "vitest";

import { activateTurnStep } from "#execution/activate-turn-step.js";
import { resumeHook } from "#internal/workflow/runtime.js";

vi.mock("#compiled/@workflow/core/runtime.js", () => ({
  resumeHook: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("activateTurnStep", () => {
  it("sends the committed owner identity to the shared inbox", async () => {
    await activateTurnStep({ expectedRunId: "wrun_owner", inboxToken: "turn-inbox" });

    expect(resumeHook).toHaveBeenCalledWith("turn-inbox", {
      expectedRunId: "wrun_owner",
      kind: "turn-activation",
    });
  });

  it("accepts a replay after the activated child disposed its inbox", async () => {
    vi.mocked(resumeHook).mockRejectedValueOnce(
      Object.assign(new Error("missing"), { name: "HookNotFoundError" }),
    );

    await expect(
      activateTurnStep({ expectedRunId: "wrun_owner", inboxToken: "turn-inbox" }),
    ).resolves.toBeUndefined();
  });
});
