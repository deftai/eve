import type { Hook } from "#compiled/@workflow/core/index.js";

import { claimHookOwnership, disposeHook } from "#execution/hook-ownership.js";
import type { DurabilityInbox } from "#shared/durability-port.js";

/**
 * Workflow hook adapter implementing {@link DurabilityInbox}.
 */
export class VercelDurabilityInbox<T> implements DurabilityInbox<T> {
  readonly token: string;
  readonly #hook: Hook<T>;

  constructor(hook: Hook<T>) {
    this.#hook = hook;
    this.token = hook.token;
  }

  async claim(_ownerSessionId: string): Promise<void> {
    await claimHookOwnership(this.#hook);
  }

  async dispose(): Promise<void> {
    await disposeHook(this.#hook);
  }

  async getConflict(): Promise<{ readonly runId: string } | null> {
    const conflict = await this.#hook.getConflict();
    if (conflict === null) {
      return null;
    }
    return { runId: conflict.runId };
  }

  async resume(payload: T): Promise<void> {
    const { resumeHook } = await import("#internal/workflow/runtime.js");
    await resumeHook(this.token, payload);
  }

  iterate(): AsyncIterator<T> {
    return this.#hook[Symbol.asyncIterator]();
  }
}
