import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeliverHookPayload, HookPayload } from "#channel/types.js";
import type { DurableSessionState } from "#execution/durable-session-store.js";
import { runSessionDriver } from "#execution/durability/session-driver.js";
import type { SessionDeliveryHookHandle } from "#execution/session-delivery-hook.js";
import type { DurabilityPort } from "#shared/durability-port.js";

const mocks = vi.hoisted(() => ({
  dispatchAndAwaitTurn: vi.fn(),
  fireSessionCallbackStep: vi.fn(),
  notifyDelegatedParentStep: vi.fn(),
  routeDeliverToChildren: vi.fn(),
  createSessionDeliveryHook: vi.fn(),
}));

vi.mock("#execution/turn-dispatch.js", () => ({
  dispatchAndAwaitTurn: mocks.dispatchAndAwaitTurn,
}));

vi.mock("#execution/session-callback-step.js", () => ({
  fireSessionCallbackStep: mocks.fireSessionCallbackStep,
}));

vi.mock("#execution/delegated-parent-notification.js", () => ({
  notifyDelegatedParentStep: mocks.notifyDelegatedParentStep,
}));

vi.mock("#execution/route-child-delivery.js", () => ({
  routeDeliverToChildren: mocks.routeDeliverToChildren,
}));

vi.mock("#execution/session-delivery-hook.js", () => ({
  createSessionDeliveryHook: mocks.createSessionDeliveryHook,
}));

vi.mock("#compiled/@workflow/core/index.js", () => ({
  createHook: vi.fn(() => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: true, value: undefined }),
      return: async () => ({ done: true, value: undefined }),
    }),
    dispose: async () => {},
  })),
}));

describe("runSessionDriver", () => {
  const port = {} as DurabilityPort;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fireSessionCallbackStep.mockResolvedValue(undefined);
    mocks.notifyDelegatedParentStep.mockResolvedValue(undefined);
    mocks.routeDeliverToChildren.mockImplementation(
      async (input: { payloads: DeliverHookPayload["payloads"] }) => input.payloads[0],
    );
  });

  it("finalizes when the first turn returns done", async () => {
    const sessionState = createSessionState({ continuationToken: "http:test" });
    mocks.createSessionDeliveryHook.mockReturnValue(createDeliveryHookStub());
    mocks.dispatchAndAwaitTurn.mockResolvedValueOnce({
      kind: "done",
      output: "finished",
      serializedContext: { "eve.mode": "conversation" },
      sessionState,
    });

    const result = await runSessionDriver({
      driverWritable: new WritableStream<Uint8Array>(),
      initialInput: { kind: "deliver", payloads: [{ message: "hello" }] },
      mode: "conversation",
      port,
      serializedContext: {},
      sessionState,
    });

    expect(result).toEqual({ output: "finished" });
    expect(mocks.fireSessionCallbackStep).toHaveBeenCalledWith({
      error: undefined,
      output: "finished",
      serializedContext: { "eve.mode": "conversation" },
      status: "completed",
      usage: undefined,
    });
    expect(mocks.notifyDelegatedParentStep).toHaveBeenCalledOnce();
  });

  it("rejects park when continuation token is missing", async () => {
    const sessionState = createSessionState({ continuationToken: "" });
    mocks.createSessionDeliveryHook.mockReturnValue(createDeliveryHookStub());
    mocks.dispatchAndAwaitTurn.mockResolvedValueOnce({
      kind: "park",
      serializedContext: {},
      sessionState,
    });

    await expect(
      runSessionDriver({
        driverWritable: new WritableStream<Uint8Array>(),
        initialInput: { kind: "deliver", payloads: [{ message: "hello" }] },
        mode: "conversation",
        port,
        serializedContext: {},
        sessionState,
      }),
    ).rejects.toThrow(/Cannot park: no continuation token available/);
  });

  it("resumes after park when a delivery arrives on the hook", async () => {
    const parkedState = createSessionState({ continuationToken: "http:parked" });
    const doneState = createSessionState({ continuationToken: "http:parked" });
    const deliveryHook = createDeliveryHookStub([
      { kind: "deliver", payloads: [{ message: "follow up" }] },
    ]);
    mocks.createSessionDeliveryHook.mockReturnValue(deliveryHook);
    mocks.dispatchAndAwaitTurn
      .mockResolvedValueOnce({
        kind: "park",
        serializedContext: { parked: true },
        sessionState: parkedState,
      })
      .mockResolvedValueOnce({
        kind: "done",
        output: "ok",
        serializedContext: { parked: true },
        sessionState: doneState,
      });

    const result = await runSessionDriver({
      driverWritable: new WritableStream<Uint8Array>(),
      initialInput: { kind: "deliver", payloads: [{ message: "hello" }] },
      mode: "conversation",
      port,
      serializedContext: {},
      sessionState: createSessionState({ continuationToken: "http:initial" }),
    });

    expect(result).toEqual({ output: "ok" });
    expect(deliveryHook.rekey).toHaveBeenCalledWith("http:parked");
    expect(mocks.dispatchAndAwaitTurn).toHaveBeenCalledTimes(2);
    expect(mocks.routeDeliverToChildren).toHaveBeenCalledOnce();
  });

  it("continues waiting when delivery is fully routed to children", async () => {
    const parkedState = createSessionState({ continuationToken: "http:parked" });
    const deliveryHook = createDeliveryHookStub([
      { kind: "deliver", payloads: [{ message: "child only" }] },
    ]);
    mocks.createSessionDeliveryHook.mockReturnValue(deliveryHook);
    mocks.routeDeliverToChildren.mockResolvedValueOnce(undefined);
    mocks.dispatchAndAwaitTurn.mockResolvedValueOnce({
      kind: "park",
      serializedContext: {},
      sessionState: parkedState,
    });

    const result = await runSessionDriver({
      driverWritable: new WritableStream<Uint8Array>(),
      initialInput: { kind: "deliver", payloads: [{ message: "hello" }] },
      mode: "conversation",
      port,
      serializedContext: {},
      sessionState: createSessionState({ continuationToken: "http:initial" }),
    });

    expect(result).toEqual({ output: "" });
    expect(mocks.dispatchAndAwaitTurn).toHaveBeenCalledOnce();
    expect(mocks.routeDeliverToChildren).toHaveBeenCalledOnce();
  });
});

function createSessionState(input: { readonly continuationToken: string }): DurableSessionState {
  return {
    continuationToken: input.continuationToken,
    emissionState: { sequence: 0, sessionStarted: false, stepIndex: 0, turnId: "" },
    hasProxyInputRequests: false,
    sessionId: "sess-1",
    version: 1,
  };
}

function createDeliveryHookStub(deliveries: HookPayload[] = []): SessionDeliveryHookHandle {
  let index = 0;
  return {
    consumeNext: vi.fn(),
    dispose: vi.fn(async () => {}),
    next: vi.fn(async (): Promise<IteratorResult<HookPayload>> => {
      const value = deliveries[index];
      index += 1;
      if (value === undefined) {
        return { done: true as const, value: undefined };
      }
      return { done: false as const, value };
    }),
    rekey: vi.fn(async () => {}),
  };
}
