import type { DurabilityInbox } from "#shared/durability-port.js";

interface InboxRecord<T> {
  ownerSessionId: string | undefined;
  readonly pending: T[];
  readonly waiters: Array<() => void>;
}

/**
 * In-process inbox with exclusive ownership matching hook conflict semantics.
 */
export class InMemoryDurabilityInbox<T> implements DurabilityInbox<T> {
  readonly token: string;
  readonly #record: InboxRecord<T>;

  constructor(token: string, record: InboxRecord<T>) {
    this.token = token;
    this.#record = record;
  }

  async claim(ownerSessionId: string): Promise<void> {
    const conflict = await this.getConflict();
    if (conflict !== null && conflict.runId !== ownerSessionId) {
      throw createHookConflictError(this.token, conflict.runId);
    }
    this.#record.ownerSessionId = ownerSessionId;
  }

  async getConflict(): Promise<{ readonly runId: string } | null> {
    const owner = this.#record.ownerSessionId;
    if (owner === undefined) {
      return null;
    }
    return { runId: owner };
  }

  async resume(payload: T): Promise<void> {
    this.#record.pending.push(payload);
    const waiters = this.#record.waiters.splice(0);
    for (const wake of waiters) {
      wake();
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const next = this.#record.pending.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.#record.waiters.push(resolve);
      });
    }
  }

  iterate(): AsyncIterator<T> {
    return this[Symbol.asyncIterator]();
  }

  async dispose(): Promise<void> {
    // Process-local inboxes need no teardown.
  }
}

function createHookConflictError(
  token: string,
  conflictingRunId: string,
): Error & {
  readonly conflictingRunId: string;
  readonly name: "HookConflictError";
  readonly token: string;
} {
  const error = Object.assign(
    new Error(`Hook token "${token}" is already in use (run "${conflictingRunId}")`),
    {
      conflictingRunId,
      name: "HookConflictError" as const,
      token,
    },
  );
  return error;
}
