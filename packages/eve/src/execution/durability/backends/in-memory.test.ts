import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryDurabilityBackend,
  IN_MEMORY_DURABILITY_BACKEND_NAME,
} from "#execution/durability/backends/in-memory.js";
import type { HandleMessageStreamEvent } from "#protocol/message.js";

async function readStreamEvents(
  stream: ReadableStream<HandleMessageStreamEvent>,
): Promise<HandleMessageStreamEvent[]> {
  const reader = stream.getReader();
  const events: HandleMessageStreamEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    events.push(value);
  }
  return events;
}

describe("createInMemoryDurabilityBackend", () => {
  it("exposes the stable backend name", () => {
    expect(createInMemoryDurabilityBackend().name).toBe(IN_MEMORY_DURABILITY_BACKEND_NAME);
  });

  it("replays checkpoint results without re-running the callback", async () => {
    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    const { port } = binding;

    await port.startSession({ sessionId: "sess-1" });
    const fn = vi.fn(async () => "computed");
    await port.checkpoint({ fn, name: "step-a", sessionId: "sess-1" });
    await port.checkpoint({ fn, name: "step-b", sessionId: "sess-1" });

    expect(fn).toHaveBeenCalledTimes(2);

    await port.startSession({ sessionId: "sess-1" });

    const replayFn = vi.fn(async () => "should-not-run");
    await expect(
      port.checkpoint({ fn: replayFn, name: "step-a", sessionId: "sess-1" }),
    ).resolves.toBe("computed");
    await expect(
      port.checkpoint({ fn: replayFn, name: "step-b", sessionId: "sess-1" }),
    ).resolves.toBe("computed");

    expect(replayFn).not.toHaveBeenCalled();
    await binding.shutdown();
  });

  it("rejects inbox claim when another session owns the token", async () => {
    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    const { port } = binding;
    await port.startSession({ sessionId: "owner" });
    await port.startSession({ sessionId: "intruder" });

    const inbox = port.createInbox({ sessionId: "owner", token: "hook-token" });
    await inbox.claim("owner");

    const conflictInbox = port.createInbox({ sessionId: "intruder", token: "hook-token" });
    await expect(conflictInbox.claim("intruder")).rejects.toMatchObject({
      name: "HookConflictError",
      token: "hook-token",
      conflictingRunId: "owner",
    });

    await binding.shutdown();
  });

  it("allows the same session to reclaim its inbox", async () => {
    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    const { port } = binding;
    await port.startSession({ sessionId: "owner" });

    const inbox = port.createInbox({ sessionId: "owner", token: "hook-token" });
    await inbox.claim("owner");
    await expect(inbox.claim("owner")).resolves.toBeUndefined();

    await binding.shutdown();
  });

  it("delivers inbox payloads through iterate", async () => {
    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    const { port } = binding;
    await port.startSession({ sessionId: "sess" });

    const inbox = port.createInbox<string>({ sessionId: "sess", token: "delivery" });
    await inbox.claim("sess");

    const pending = inbox.iterate().next();
    await inbox.resume("payload-a");
    await expect(pending).resolves.toEqual({ done: false, value: "payload-a" });

    await binding.shutdown();
  });

  it("slices the event stream from startIndex", async () => {
    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    const { port } = binding;
    await port.startSession({ sessionId: "sess-stream" });

    const events: HandleMessageStreamEvent[] = [
      { type: "session.started", data: {} },
      { type: "turn.started", data: { sequence: 1, turnId: "turn-1" } },
      { type: "turn.completed", data: { sequence: 1, turnId: "turn-1" } },
    ];
    for (const event of events) {
      await port.appendEvent("sess-stream", event);
    }

    const sliced = await readStreamEvents(port.readEventStream("sess-stream", { startIndex: 1 }));
    expect(sliced).toEqual([
      { type: "turn.started", data: { sequence: 1, turnId: "turn-1" } },
      { type: "turn.completed", data: { sequence: 1, turnId: "turn-1" } },
    ]);

    await binding.shutdown();
  });

  it("awaits child turn results in-process", async () => {
    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    const { port } = binding;
    await port.startSession({ sessionId: "parent" });

    const child = port.startChildTurn({
      parentSessionId: "parent",
      run: async () => 42,
    });
    await expect(child.awaitResult()).resolves.toBe(42);

    await binding.shutdown();
  });

  it("clears state on shutdown", async () => {
    const backend = createInMemoryDurabilityBackend();
    const binding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    const { port } = binding;
    await port.startSession({ sessionId: "ephemeral" });
    await binding.shutdown();

    const freshBinding = await backend.createBinding({ runtimeContext: { appRoot: "/tmp" } });
    await expect(
      freshBinding.port.checkpoint({
        fn: async () => "fresh",
        name: "after-shutdown",
        sessionId: "ephemeral",
      }),
    ).rejects.toThrow('In-memory durability session "ephemeral" is not open.');

    await freshBinding.shutdown();
  });
});
