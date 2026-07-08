import { describe, expect, it } from "vitest";
import { start } from "#internal/workflow/runtime.js";

import { captureTurnEvents } from "#internal/testing/events.js";
import { createTestRuntime } from "#internal/testing/app-harness.js";
import { waitForHook } from "#internal/testing/workflow-test-helpers.js";
import { createBundledRuntimeCompiledArtifactsSource } from "#runtime/compiled-artifacts-source.js";
import { workflowEntry } from "#execution/workflow-entry.js";
import { createAgentRuntime } from "#execution/durability/runtime-factory.js";

function buildSerializedContext(input: {
  readonly continuationToken: string;
}): Record<string, unknown> {
  return {
    "eve.auth": null,
    "eve.bundle": { source: createBundledRuntimeCompiledArtifactsSource() },
    "eve.channel": { kind: "http", state: {} },
    "eve.continuationToken": input.continuationToken,
    "eve.mode": "conversation",
  };
}

describe("createAgentRuntime integration", () => {
  it("delivers follow-ups on the vercel-workflow backend", async () => {
    const runtime = createTestRuntime({ agent: { name: "durability-runtime-factory" } });
    const continuationToken = "http:durability-runtime-factory";

    await runtime.run(async () => {
      const run = await start(workflowEntry, [
        {
          input: { message: "hello there" },
          serializedContext: buildSerializedContext({ continuationToken }),
        },
      ]);

      const stream = captureTurnEvents(run);

      try {
        await waitForHook({ runId: run.runId }, { token: continuationToken });
        const firstTurn = await stream.nextTurn();

        expect(firstTurn.at(-1)?.type).toBe("session.waiting");
        expect(
          firstTurn.some(
            (event) =>
              event.type === "message.completed" &&
              event.data.message?.includes("hello there") === true,
          ),
        ).toBe(true);

        const agentRuntime = createAgentRuntime({
          compiledArtifactsSource: createBundledRuntimeCompiledArtifactsSource(),
          durabilityBackendName: "vercel-workflow",
        });

        await expect(
          agentRuntime.deliver({
            auth: null,
            continuationToken,
            payload: { message: "follow up" },
          }),
        ).resolves.toEqual({ sessionId: run.runId });

        const secondTurn = await stream.nextTurn();

        expect(secondTurn.at(-1)?.type).toBe("session.waiting");
        expect(
          secondTurn.some(
            (event) =>
              event.type === "message.completed" &&
              event.data.message?.includes("follow up") === true,
          ),
        ).toBe(true);
      } finally {
        stream.dispose();
        await run.cancel();
      }
    });
  });
});
