import { createActionsRequestedEvent } from "#protocol/message.js";
import type { RuntimeToolCallActionRequest } from "#runtime/actions/types.js";
import type { HarnessEmitFn } from "#harness/types.js";

interface ActionEventCoordinates {
  readonly sequence: number;
  readonly stepIndex: number;
  readonly turnId: string;
}

/** Coordinates provider-managed tool calls that share one streamed response. */
export interface ProviderStreamActionBatch {
  flush(): Promise<void>;
  observe(action: RuntimeToolCallActionRequest): void;
}

/**
 * Provider streams do not mark the end of a parallel tool-call wave. Waiting
 * one task coalesces queued sibling calls, but does not hold the UI until a
 * provider result completes.
 */
const PROVIDER_ACTION_BATCH_TICK_MS = 0;

/** Creates the action batch for provider-managed streamed tool calls. */
export function createProviderStreamActionBatch(input: {
  readonly emitFn: HarnessEmitFn;
  readonly state: ActionEventCoordinates;
}): ProviderStreamActionBatch {
  const pendingActions = new Map<string, RuntimeToolCallActionRequest>();
  let actionFlush: Promise<void> = Promise.resolve();
  let actionFlushError: unknown;
  let actionFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveActionFlushTimer: (() => void) | undefined;

  const emitPendingActions = async (): Promise<void> => {
    if (pendingActions.size === 0) {
      return;
    }

    const actions = [...pendingActions.values()];
    pendingActions.clear();
    await input.emitFn(
      createActionsRequestedEvent({
        actions,
        sequence: input.state.sequence,
        stepIndex: input.state.stepIndex,
        turnId: input.state.turnId,
      }),
    );
  };

  const scheduleFlush = (): void => {
    if (actionFlushTimer !== undefined) {
      return;
    }

    let resolveTimer: (() => void) | undefined;
    const timerElapsed = new Promise<void>((resolve) => {
      resolveTimer = resolve;
    });
    resolveActionFlushTimer = resolveTimer;
    actionFlushTimer = setTimeout(() => {
      actionFlushTimer = undefined;
      resolveActionFlushTimer = undefined;
      resolveTimer?.();
    }, PROVIDER_ACTION_BATCH_TICK_MS);
    actionFlush = actionFlush
      .then(() => timerElapsed)
      .then(emitPendingActions)
      .catch((error: unknown) => {
        actionFlushError ??= error;
      });
  };

  return {
    observe(action) {
      pendingActions.set(action.callId, action);
      scheduleFlush();
    },
    async flush() {
      if (actionFlushTimer !== undefined) {
        clearTimeout(actionFlushTimer);
        actionFlushTimer = undefined;
        const resolveTimer = resolveActionFlushTimer;
        resolveActionFlushTimer = undefined;
        resolveTimer?.();
      }

      await actionFlush;
      if (actionFlushError !== undefined) {
        throw actionFlushError;
      }
      await emitPendingActions();
    },
  };
}
