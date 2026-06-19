import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelRuntimeActionsStep } from "#execution/cancel-runtime-actions-step.js";
import { createWorkflowRuntime } from "#execution/workflow-runtime.js";

vi.mock("#context/serialize.js", () => ({
  deserializeContext: vi.fn().mockResolvedValue({
    require: () => ({
      compiledArtifactsSource: { kind: "test" },
      subagentRegistry: {
        subagentsByNodeId: new Map([
          [
            "remote/research",
            {
              definition: {
                headers: { authorization: "Bearer token" },
                kind: "remote",
                url: "https://remote.example.com",
              },
            },
          ],
        ]),
      },
    }),
  }),
}));

vi.mock("#execution/workflow-runtime.js", () => ({
  createWorkflowRuntime: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("cancelRuntimeActionsStep", () => {
  it("cancels local delegated sessions through their runtime", async () => {
    const cancelTurn = vi.fn().mockResolvedValue(true);
    vi.mocked(createWorkflowRuntime).mockReturnValue({ cancelTurn } as never);

    await cancelRuntimeActionsStep({
      serializedContext: {},
      targets: [
        {
          cancelToken: "child_cancel_1",
          kind: "local",
          nodeId: "subagents/research",
          sessionId: "child_session_1",
        },
      ],
    });

    expect(createWorkflowRuntime).toHaveBeenCalledWith({
      compiledArtifactsSource: { kind: "test" },
      nodeId: "subagents/research",
    });
    expect(cancelTurn).toHaveBeenCalledWith("child_session_1", "child_cancel_1");
  });

  it("cancels remote delegated sessions through the eve protocol", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ cancelled: true }));
    vi.stubGlobal("fetch", fetchMock);

    await cancelRuntimeActionsStep({
      serializedContext: {},
      targets: [
        {
          cancelToken: "remote_cancel_1",
          kind: "remote",
          nodeId: "remote/research",
          sessionId: "remote_session_1",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://remote.example.com/eve/v1/session/remote_session_1/cancel"),
      {
        body: JSON.stringify({ cancelToken: "remote_cancel_1" }),
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        method: "POST",
      },
    );
  });
});
