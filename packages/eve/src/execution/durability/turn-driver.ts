import { getWorkflowMetadata } from "#compiled/@workflow/core/index.js";

import type { DeliverHookPayload } from "#channel/types.js";
import { sendTurnControlStep, type TurnInboxPayload } from "#execution/turn-control-protocol.js";
import { dispatchRuntimeActionsStep } from "#execution/dispatch-runtime-actions-step.js";
import { dispatchWorkflowRuntimeActionsStep } from "#execution/dispatch-workflow-runtime-actions-step.js";
import type {
  TurnStepInput,
  TurnWorkflowInput,
} from "#execution/durable-session-migrations/turn-workflow.js";
import { closeHookIterator, isHookConflictError } from "#execution/hook-ownership.js";
import type { NextDriverAction } from "#execution/next-driver-action.js";
import { routeDeliverToChildren } from "#execution/route-child-delivery.js";
import { TurnExecutionCursor } from "#execution/turn-execution-cursor.js";
import { resolveWorkflowCallbackBaseUrl } from "#execution/workflow-callback-url.js";
import { normalizeSerializableError } from "#execution/workflow-errors.js";
import { runProxyInputRequestStep, turnStep } from "#execution/workflow-steps.js";
import { resolveRuntimeActionResultsForKeys } from "#harness/runtime-actions.js";
import type { RuntimeActionResult } from "#runtime/actions/types.js";
import type { DurabilityPort } from "#shared/durability-port.js";

const TASK_MODE_WAIT_ERROR_MESSAGE = "Task mode cannot wait for follow-up input (`next: null`).";

/**
 * Input to {@link runTurnDriver}.
 */
export interface TurnDriverInput {
  readonly port: DurabilityPort;
  readonly workflowInput: TurnWorkflowInput;
}

/** Runs one complete logical turn via {@link DurabilityPort}. */
export async function runTurnDriver(input: TurnDriverInput): Promise<void> {
  if (input.workflowInput.driverCapabilities?.turnInbox !== true) {
    return runLegacyTurnDriver(input.workflowInput);
  }

  return runTurnOwnedDriver(input);
}

async function runTurnOwnedDriver(input: TurnDriverInput): Promise<void> {
  const { port, workflowInput } = input;
  const inbox = port.createInbox<TurnInboxPayload>({
    sessionId: workflowInput.stepInput.sessionState.sessionId,
    token: `${workflowInput.completionToken}:inbox`,
  });
  const iterator = inbox.iterate();
  const cursor = new TurnExecutionCursor({
    controlToken: workflowInput.completionToken,
    parentWritable: workflowInput.stepInput.parentWritable,
    serializedContext: workflowInput.stepInput.serializedContext,
    sessionState: workflowInput.stepInput.sessionState,
  });
  let deliveryRequestSeq = 0;
  const nextDeliveryRequestId = (): string =>
    `${inbox.token}:delivery:${String(deliveryRequestSeq++)}`;
  const bufferedDeliveries: DeliverHookPayload[] = [];
  let nextStepInput = workflowInput.stepInput.input;
  let ownsInbox = false;

  try {
    try {
      await inbox.claim(workflowInput.stepInput.sessionState.sessionId);
      ownsInbox = true;
    } catch (error) {
      if (isHookConflictError(error)) return;
      throw error;
    }

    while (true) {
      const result = await port.checkpoint({
        fn: () => turnStep(cursor.createStepInput(nextStepInput)),
        name: "turn-step",
        sessionId: workflowInput.stepInput.sessionState.sessionId,
      });

      if (result.action === "done") {
        await cursor.finish(
          result,
          {
            kind: "done",
            output: result.output ?? "",
            isError: result.isError,
            usage: result.usage,
          },
          bufferedDeliveries,
        );
        return;
      }

      const pendingActionKeys =
        result.action === "dispatch-workflow-runtime-actions" || result.action === "park"
          ? result.pendingRuntimeActionKeys
          : undefined;

      if (pendingActionKeys !== undefined) {
        await cursor.adopt(result);
        const dispatch =
          result.action === "dispatch-workflow-runtime-actions"
            ? dispatchWorkflowRuntimeActionsStep
            : dispatchRuntimeActionsStep;
        const dispatchResult = await port.checkpoint({
          fn: () =>
            dispatch({
              callbackBaseUrl: resolveWorkflowCallbackBaseUrl(getWorkflowMetadata().url),
              parentContinuationToken: inbox.token,
              parentWritable: cursor.parentWritable,
              serializedContext: cursor.serializedContext,
              sessionState: cursor.sessionState,
            }),
          name: "dispatch-runtime-actions",
          sessionId: workflowInput.stepInput.sessionState.sessionId,
        });
        await cursor.adopt(dispatchResult);

        const results = await waitForRuntimeActionResults({
          bufferedDeliveries,
          cursor,
          inboxToken: inbox.token,
          initialResults: dispatchResult.results,
          iterator,
          nextDeliveryRequestId,
          pendingActionKeys,
        });
        nextStepInput = { kind: "runtime-action-result", results };
        continue;
      }

      if (result.action === "park") {
        const canPark =
          result.hasPendingAuthorization ||
          (result.hasPendingInputBatch && workflowInput.capabilities?.requestInput === true) ||
          workflowInput.mode === "conversation";

        if (!canPark) throw new Error(TASK_MODE_WAIT_ERROR_MESSAGE);

        await cursor.finish(
          result,
          {
            authorizationNames: result.authorizationNames,
            kind: "park",
          },
          bufferedDeliveries,
        );
        return;
      }

      await cursor.adopt(result);
      nextStepInput = undefined;
    }
  } catch (error) {
    await cursor.send({ error: normalizeSerializableError(error), kind: "turn-error" });
    throw error;
  } finally {
    await closeHookIterator(iterator);
    if (ownsInbox) await inbox.dispose();
  }
}

async function waitForRuntimeActionResults(input: {
  readonly bufferedDeliveries: DeliverHookPayload[];
  readonly cursor: TurnExecutionCursor;
  readonly inboxToken: string;
  readonly initialResults: readonly RuntimeActionResult[];
  readonly iterator: AsyncIterator<TurnInboxPayload>;
  readonly nextDeliveryRequestId: () => string;
  readonly pendingActionKeys: readonly string[];
}): Promise<readonly RuntimeActionResult[]> {
  let pendingDeliveryRequest: string | undefined;
  const results: RuntimeActionResult[] = [...input.initialResults];

  while (true) {
    const ready = resolveRuntimeActionResultsForKeys({
      pendingKeys: input.pendingActionKeys,
      results,
    });
    if (ready !== undefined) {
      if (pendingDeliveryRequest !== undefined) {
        await input.cursor.send({
          kind: "turn-delivery-cancelled",
          requestId: pendingDeliveryRequest,
        });
      }
      return ready;
    }

    if (input.cursor.sessionState.hasProxyInputRequests && pendingDeliveryRequest === undefined) {
      pendingDeliveryRequest = input.nextDeliveryRequestId();
      await input.cursor.send({
        continuationToken: input.cursor.sessionState.continuationToken,
        inboxToken: input.inboxToken,
        kind: "turn-delivery-request",
        requestId: pendingDeliveryRequest,
      });
    }

    const next = await input.iterator.next();
    if (next.done) throw new Error("Turn inbox closed before runtime actions completed.");

    const value = next.value;
    if (value.kind === "runtime-action-result") {
      results.push(...value.results);
      continue;
    }

    if (value.kind === "subagent-input-request") {
      const proxyResult = await runProxyInputRequestStep({
        hookPayload: value,
        parentWritable: input.cursor.parentWritable,
        serializedContext: input.cursor.serializedContext,
        sessionState: input.cursor.sessionState,
      });
      await input.cursor.adopt(proxyResult);
      continue;
    }

    if (value.kind === "driver-delivery" && value.requestId === pendingDeliveryRequest) {
      await input.cursor.send({ kind: "turn-delivery-accepted", requestId: value.requestId });
      pendingDeliveryRequest = undefined;

      const remainder = await routeDeliverToChildren({
        auth: value.delivery.auth,
        parentWritable: input.cursor.parentWritable,
        payloads: value.delivery.payloads,
        sessionState: input.cursor.sessionState,
      });
      if (remainder !== undefined) {
        input.bufferedDeliveries.push({ ...value.delivery, payloads: [remainder] });
      }
    }
  }
}

async function runLegacyTurnDriver(input: TurnWorkflowInput): Promise<void> {
  let currentStepInput: TurnStepInput = input.stepInput;

  try {
    while (true) {
      const result = await turnStep(currentStepInput);

      if (result.action === "done") {
        await sendTurnControlStep({
          controlToken: input.completionToken,
          payload: {
            action: {
              kind: "done",
              output: result.output ?? "",
              isError: result.isError,
              serializedContext: result.serializedContext,
              sessionState: result.sessionState,
              usage: result.usage,
            },
            kind: "turn-result",
          },
        });
        return;
      }

      if (result.action === "dispatch-workflow-runtime-actions") {
        await sendTurnControlStep({
          controlToken: input.completionToken,
          payload: {
            action: {
              kind: "dispatch-workflow-runtime-actions",
              pendingActionKeys: result.pendingRuntimeActionKeys,
              serializedContext: result.serializedContext,
              sessionState: result.sessionState,
            },
            kind: "turn-result",
          },
        });
        return;
      }

      if (result.action === "park") {
        const pendingActionKeys = result.pendingRuntimeActionKeys;
        const canPark =
          pendingActionKeys !== undefined ||
          result.hasPendingAuthorization ||
          (result.hasPendingInputBatch && input.capabilities?.requestInput === true) ||
          input.mode === "conversation";

        if (!canPark) throw new Error(TASK_MODE_WAIT_ERROR_MESSAGE);

        const action: NextDriverAction =
          pendingActionKeys !== undefined
            ? {
                kind: "dispatch-runtime-actions",
                pendingActionKeys,
                serializedContext: result.serializedContext,
                sessionState: result.sessionState,
              }
            : {
                kind: "park",
                serializedContext: result.serializedContext,
                sessionState: result.sessionState,
                authorizationNames: result.authorizationNames,
              };

        await sendTurnControlStep({
          controlToken: input.completionToken,
          payload: { action, kind: "turn-result" },
        });
        return;
      }

      currentStepInput = {
        input: undefined,
        parentWritable: currentStepInput.parentWritable,
        serializedContext: result.serializedContext,
        sessionState: result.sessionState,
      };
    }
  } catch (error) {
    await sendTurnControlStep({
      controlToken: input.completionToken,
      payload: { error: normalizeSerializableError(error), kind: "turn-error" },
    });
    throw error;
  }
}
