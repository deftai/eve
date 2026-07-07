import { createHook } from "#compiled/@workflow/core/index.js";

import type {
  DeliverHookPayload,
  DeliverPayload,
  HookPayload,
  SessionCapabilities,
} from "#channel/types.js";
import { coalesceDeliveries } from "#harness/messages.js";
import type { DurableSessionState } from "#execution/durable-session-store.js";
import type { NextDriverAction } from "#execution/next-driver-action.js";
import { routeDeliverToChildren } from "#execution/route-child-delivery.js";
import { dispatchAndAwaitTurn } from "#execution/turn-dispatch.js";
import {
  createDelegatedSubagentErrorResult,
  createDelegatedSubagentSuccessResult,
} from "#execution/delegated-parent-result.js";
import { fireSessionCallbackStep } from "#execution/session-callback-step.js";
import { closeHookIterator, disposeHook } from "#execution/hook-ownership.js";
import {
  createSessionDeliveryHook,
  type SessionDeliveryHook,
} from "#execution/session-delivery-hook.js";
import { notifyDelegatedParentStep } from "#execution/delegated-parent-notification.js";
import type { RunMode } from "#shared/run-mode.js";
import type { DurabilityPort } from "#shared/durability-port.js";

/** Result returned by the long-lived session workflow entrypoint. */
export interface WorkflowEntryResult {
  readonly output: unknown;
}

/**
 * Input to {@link runSessionDriver}.
 */
export interface SessionDriverInput {
  readonly capabilities?: SessionCapabilities;
  readonly driverWritable: WritableStream<Uint8Array>;
  readonly initialInput: HookPayload;
  readonly mode: RunMode;
  readonly port: DurabilityPort;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState: DurableSessionState;
}

/** Long-lived session orchestration loop backed by {@link DurabilityPort}. */
export async function runSessionDriver(input: SessionDriverInput): Promise<WorkflowEntryResult> {
  void input.port;
  const authHook = createHook<HookPayload>({
    token: `${input.sessionState.sessionId}:auth`,
  });
  const authIterator: AsyncIterator<HookPayload> = authHook[Symbol.asyncIterator]();
  let turnDispatchIndex = 0;
  const nextTurnControlToken = (): string =>
    `${input.sessionState.sessionId}:turn-control:${String(turnDispatchIndex++)}`;

  const bufferedDeliveries: DeliverHookPayload[] = [];
  const deliveryHook = createSessionDeliveryHook(bufferedDeliveries);

  try {
    if (input.sessionState.continuationToken) {
      await deliveryHook.rekey(input.sessionState.continuationToken);
    }

    let action: NextDriverAction = await dispatchAndAwaitTurn({
      bufferedDeliveries,
      capabilities: input.capabilities,
      controlToken: nextTurnControlToken(),
      delivery: input.initialInput,
      deliveryHook,
      mode: input.mode,
      parentWritable: input.driverWritable,
      serializedContext: input.serializedContext,
      sessionState: input.sessionState,
    });

    while (true) {
      if (action.kind === "done") {
        return await finalizeDone({
          action,
          driverWritable: input.driverWritable,
        });
      }

      if (action.kind !== "park") {
        throw new Error(`Driver received unexpected turn action "${action.kind}".`);
      }

      if (!action.sessionState.continuationToken) {
        throw new Error(
          "Cannot park: no continuation token available. The channel must " +
            "post the first message during the initial turn (anchoring the " +
            "session) or `send()` must be called with an explicit " +
            "continuationToken.",
        );
      }

      await deliveryHook.rekey(action.sessionState.continuationToken);

      if (action.authorizationNames && action.authorizationNames.length > 0) {
        const expected = action.authorizationNames.length;
        const allPayloads: DeliverPayload[] = [];

        while (allPayloads.length < expected) {
          const next = await authIterator.next();
          if (next.done) break;
          if (next.value.kind === "deliver") {
            allPayloads.push(...next.value.payloads);
          }
        }

        action = await dispatchAndAwaitTurn({
          bufferedDeliveries,
          capabilities: input.capabilities,
          controlToken: nextTurnControlToken(),
          delivery: {
            kind: "deliver",
            payloads: allPayloads,
          },
          deliveryHook,
          mode: input.mode,
          parentWritable: input.driverWritable,
          serializedContext: action.serializedContext,
          sessionState: action.sessionState,
        });
        continue;
      }

      const nextDeliver = await waitForNextDeliver({
        bufferedDeliveries,
        deliveryHook,
      });

      if (nextDeliver === null) {
        return { output: "" };
      }

      const remainder = await routeDeliverToChildren({
        auth: nextDeliver.auth,
        parentWritable: input.driverWritable,
        payloads: nextDeliver.payloads,
        sessionState: action.sessionState,
      });

      if (remainder === undefined) {
        continue;
      }

      action = await dispatchAndAwaitTurn({
        bufferedDeliveries,
        capabilities: input.capabilities,
        controlToken: nextTurnControlToken(),
        delivery: {
          auth: nextDeliver.auth,
          kind: "deliver",
          payloads: [remainder],
          requestId: nextDeliver.requestId,
        },
        deliveryHook,
        mode: input.mode,
        parentWritable: input.driverWritable,
        serializedContext: action.serializedContext,
        sessionState: action.sessionState,
      });
    }
  } finally {
    await deliveryHook.dispose();
    await closeHookIterator(authIterator);
    await disposeHook(authHook);
  }
}

async function finalizeDone(input: {
  readonly action: NextDriverAction & { readonly kind: "done" };
  readonly driverWritable: WritableStream<Uint8Array>;
}): Promise<WorkflowEntryResult> {
  void input.driverWritable;
  const { output, serializedContext } = input.action;
  const failed = input.action.isError === true;

  await fireSessionCallbackStep({
    error: failed ? output : undefined,
    output: failed ? undefined : output,
    serializedContext,
    status: failed ? "failed" : "completed",
    usage: failed ? undefined : input.action.usage,
  });
  await notifyDelegatedParentStep({
    result: failed
      ? createDelegatedSubagentErrorResult(serializedContext, output)
      : createDelegatedSubagentSuccessResult(serializedContext, output),
    serializedContext,
    usage: failed ? undefined : input.action.usage,
  });
  return { output };
}

async function waitForNextDeliver(input: {
  readonly bufferedDeliveries: DeliverHookPayload[];
  readonly deliveryHook: SessionDeliveryHook;
}): Promise<DeliverHookPayload | null> {
  if (input.bufferedDeliveries.length > 0) {
    return coalesceDeliveries(input.bufferedDeliveries.splice(0));
  }

  while (true) {
    const first = await input.deliveryHook.next();
    input.deliveryHook.consumeNext();

    if (first.done) {
      return null;
    }

    if (first.value.kind !== "deliver") {
      continue;
    }

    let coalesced = first.value;

    while (true) {
      const ready = await takeReadyPayload(input.deliveryHook.next());

      if (ready === NO_READY_MESSAGE) {
        break;
      }

      input.deliveryHook.consumeNext();

      if (ready.done) {
        break;
      }

      if (ready.value.kind !== "deliver") {
        continue;
      }

      coalesced = coalesceDeliveries([coalesced, ready.value]);
    }

    return coalesced;
  }
}

const NO_READY_MESSAGE = Symbol("no-ready-message");

async function takeReadyPayload<T>(promise: Promise<T>): Promise<T | typeof NO_READY_MESSAGE> {
  await Promise.resolve();
  return await Promise.race([promise, Promise.resolve(NO_READY_MESSAGE)]);
}
