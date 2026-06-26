export interface EagerToolExecutionGate {
  readonly actionRequested: (toolCallId: string) => void;
  readonly waitForActionRequest: (toolCallId: string) => Promise<void>;
}

export function createEagerToolExecutionGate(): EagerToolExecutionGate {
  const requestedCallIds = new Set<string>();
  const waitersByCallId = new Map<string, Array<() => void>>();

  return {
    actionRequested(toolCallId) {
      if (requestedCallIds.has(toolCallId)) return;

      requestedCallIds.add(toolCallId);
      const waiters = waitersByCallId.get(toolCallId);
      waitersByCallId.delete(toolCallId);
      for (const resolve of waiters ?? []) resolve();
    },
    waitForActionRequest(toolCallId) {
      if (requestedCallIds.has(toolCallId)) return Promise.resolve();

      return new Promise<void>((resolve) => {
        const waiters = waitersByCallId.get(toolCallId) ?? [];
        waiters.push(resolve);
        waitersByCallId.set(toolCallId, waiters);
      });
    },
  };
}
