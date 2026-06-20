import { describe, expect, it, vi } from "vitest";

import type { SendFn } from "#channel/routes.js";
import type { SessionAuthContext } from "#channel/types.js";
import {
  DEFAULT_CONTROL_CAPABILITIES,
  type GatewayToEveEvent,
  type RealtimeControlCapabilities,
} from "#public/channels/vercel/voice-control-protocol.js";
import { VoiceTurnCoordinator } from "#public/channels/vercel/voice-turn-coordinator.js";

function sessionOpened(
  overrides: Partial<RealtimeControlCapabilities>,
): Extract<GatewayToEveEvent, { type: "session.opened" }> {
  return {
    type: "session.opened",
    data: {
      sessionId: "s1",
      engine: {
        provider: "openai",
        model: "openai/gpt-realtime-2",
        protocol: "ai-sdk",
        capabilities: { ...DEFAULT_CONTROL_CAPABILITIES, ...overrides },
      },
    },
  };
}

const auth: SessionAuthContext = {
  attributes: {},
  authenticator: "test",
  principalId: "user-1",
  principalType: "user",
};

function closedStream(events: readonly unknown[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
}

function sendReturning(events: readonly unknown[], id = "session-1") {
  const impl: SendFn = async () => ({
    id,
    continuationToken: "voice:ct",
    getEventStream: async () => closedStream(events),
  });
  return vi.fn(impl);
}

function harness(send: SendFn, settleMs = 5) {
  const packets: Array<{ type: string; data: Record<string, unknown> }> = [];
  const coordinator = new VoiceTurnCoordinator({
    auth,
    voiceSessionId: "voice-1",
    send,
    sendRaw: (packet) => packets.push(JSON.parse(packet)),
    closeSocket: () => undefined,
    settleMs,
  });
  return { coordinator, packets, types: () => packets.map((p) => p.type) };
}

const reply = (message: string, stepIndex = 0, finishReason = "stop") => ({
  type: "message.completed",
  data: { finishReason, message, sequence: 1, stepIndex, turnId: "t1" },
});
const waiting = () => ({ type: "session.waiting", data: { wait: "next-user-message" } });

describe("VoiceTurnCoordinator", () => {
  it("emits session.ready on start", () => {
    const { coordinator, types } = harness(sendReturning([]));
    coordinator.start();
    expect(types()).toEqual(["session.ready"]);
  });

  it("runs a durable turn and streams response.delta + response.done", async () => {
    const send = sendReturning([reply("Hello there"), waiting()]);
    const { coordinator, packets } = harness(send);
    coordinator.start();

    coordinator.handle({ type: "input.transcript.final", data: { text: "hi", itemId: "i1" } });

    await vi.waitFor(() => expect(packets.some((p) => p.type === "response.done")).toBe(true));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ message: "hi" }),
      expect.objectContaining({ auth, mode: "conversation" }),
    );
    const delta = packets.find((p) => p.type === "response.delta");
    expect(delta?.data).toEqual({ text: "Hello there" });
  });

  it("does not speak intermediate tool-call text", async () => {
    const send = sendReturning([
      reply("Let me check that", 0, "tool-calls"),
      reply("The weather is mild", 1, "stop"),
      waiting(),
    ]);
    const { coordinator, packets } = harness(send);
    coordinator.start();
    coordinator.handle({
      type: "input.transcript.final",
      data: { text: "weather?", itemId: "i1" },
    });

    await vi.waitFor(() => expect(packets.some((p) => p.type === "response.done")).toBe(true));
    const deltas = packets.filter((p) => p.type === "response.delta").map((p) => p.data.text);
    expect(deltas).toEqual(["The weather is mild"]);
  });

  it("ignores backchannel acknowledgements", async () => {
    const send = sendReturning([reply("ok"), waiting()]);
    const { coordinator } = harness(send);
    coordinator.start();
    coordinator.handle({ type: "input.transcript.final", data: { text: "mm-hmm", itemId: "i1" } });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(send).not.toHaveBeenCalled();
  });

  it("de-duplicates a repeated transcript itemId", async () => {
    const send = sendReturning([reply("Hi"), waiting()]);
    const { coordinator, packets } = harness(send);
    coordinator.start();
    coordinator.handle({ type: "input.transcript.final", data: { text: "hi", itemId: "dup" } });
    coordinator.handle({ type: "input.transcript.final", data: { text: "hi", itemId: "dup" } });

    await vi.waitFor(() => expect(packets.some((p) => p.type === "response.done")).toBe(true));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight response on barge-in", async () => {
    let controller: ReadableStreamDefaultController<unknown> | undefined;
    const impl: SendFn = async () => ({
      id: "session-1",
      continuationToken: "voice:ct",
      getEventStream: async () =>
        new ReadableStream({
          start(c) {
            controller = c;
          },
        }),
    });
    const send = vi.fn(impl);
    const { coordinator, packets, types } = harness(send);
    coordinator.start();
    coordinator.handle({
      type: "input.transcript.final",
      data: { text: "tell me a story", itemId: "i1" },
    });

    // Wait for the turn to start and emit a delta (response in flight).
    await vi.waitFor(() => expect(controller).toBeDefined());
    controller!.enqueue(reply("Once upon a"));
    await vi.waitFor(() => expect(packets.some((p) => p.type === "response.delta")).toBe(true));

    coordinator.handle({ type: "input.interrupted", data: {} });

    expect(types()).toContain("response.cancel");
    expect(types()).not.toContain("response.done");
  });

  it("runs the turn but skips the spoken readout when output.audio is false", async () => {
    const send = sendReturning([reply("Hello there"), waiting()]);
    const { coordinator, packets } = harness(send);
    coordinator.start();
    coordinator.handle(sessionOpened({ "output.audio": false }));
    coordinator.handle({ type: "input.transcript.final", data: { text: "hi", itemId: "i1" } });

    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(packets.some((p) => p.type === "response.delta")).toBe(false);
    expect(packets.some((p) => p.type === "response.done")).toBe(false);
  });

  it("does not emit response.cancel on barge-in when output.cancel is false", async () => {
    let controller: ReadableStreamDefaultController<unknown> | undefined;
    const impl: SendFn = async () => ({
      id: "session-1",
      continuationToken: "voice:ct",
      getEventStream: async () =>
        new ReadableStream({
          start(c) {
            controller = c;
          },
        }),
    });
    const send = vi.fn(impl);
    const { coordinator, packets, types } = harness(send);
    coordinator.start();
    coordinator.handle(sessionOpened({ "output.cancel": false }));
    coordinator.handle({
      type: "input.transcript.final",
      data: { text: "tell me a story", itemId: "i1" },
    });

    await vi.waitFor(() => expect(controller).toBeDefined());
    controller!.enqueue(reply("Once upon a"));
    await vi.waitFor(() => expect(packets.some((p) => p.type === "response.delta")).toBe(true));

    coordinator.handle({ type: "input.interrupted", data: {} });

    expect(types()).not.toContain("response.cancel");
  });
});
