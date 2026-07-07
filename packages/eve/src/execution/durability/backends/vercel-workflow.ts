import { createHook } from "#compiled/@workflow/core/index.js";

import { VercelDurabilityInbox } from "#execution/durability/vercel-inbox.js";
import type { DurabilityBackend } from "#shared/durability-backend.js";
import type {
  DurabilityBackendCapabilities,
  DurabilityPort,
  DurabilityStartSessionInput,
} from "#shared/durability-port.js";
import {
  encodeMessageStreamEvent,
  timestampHandleMessageStreamEvent,
  type HandleMessageStreamEvent,
} from "#protocol/message.js";

export const VERCEL_DURABILITY_BACKEND_NAME = "vercel-workflow";

const VERCEL_CAPABILITIES: DurabilityBackendCapabilities = {
  checkpoints: true,
  childTurns: true,
  crossDeployChildRouting: true,
  eventStream: true,
  inboxes: true,
  scheduleTriggers: false,
};

/**
 * Runtime context for the Vercel Workflow durability port.
 */
export interface VercelDurabilityPortContext {
  readonly eventWritable?: WritableStream<Uint8Array>;
  readonly sessionId: string;
}

/**
 * Constructs a {@link DurabilityPort} backed by `@workflow/core`.
 *
 * Call only from `"use workflow"` entrypoints — checkpoints and inboxes
 * delegate to Workflow SDK replay semantics.
 */
export function createVercelDurabilityPort(context: VercelDurabilityPortContext): DurabilityPort {
  return {
    capabilities: VERCEL_CAPABILITIES,

    async startSession(input: DurabilityStartSessionInput) {
      void input;
      return {
        continuationToken: "",
        sessionId: context.sessionId,
      };
    },

    async checkpoint<T>(input: {
      readonly fn: () => Promise<T>;
      readonly name: string;
      readonly sessionId: string;
    }): Promise<T> {
      void input.name;
      void input.sessionId;
      return input.fn();
    },

    createInbox<T>(input: { readonly sessionId: string; readonly token: string }) {
      void input.sessionId;
      const hook = createHook<T>({ token: input.token });
      return new VercelDurabilityInbox(hook);
    },

    async appendEvent(_sessionId: string, event: HandleMessageStreamEvent): Promise<void> {
      const writable = context.eventWritable;
      if (writable === undefined) {
        return;
      }
      const writer = writable.getWriter();
      try {
        await writer.write(encodeMessageStreamEvent(timestampHandleMessageStreamEvent(event)));
      } finally {
        writer.releaseLock();
      }
    },

    readEventStream(_sessionId: string, _options?: { readonly startIndex?: number }) {
      throw new Error(
        "Vercel durability readEventStream is owned by workflow-runtime; use Runtime.getEventStream().",
      );
    },

    startChildTurn(input: {
      readonly parentSessionId: string;
      readonly run: () => Promise<unknown>;
    }) {
      void input.parentSessionId;
      const id = input.parentSessionId;
      const promise = input.run();
      return {
        id,
        awaitResult: () => promise,
      };
    },
  };
}

/**
 * Constructs the production durability backend wrapping `@workflow/core`.
 */
export function createVercelDurabilityBackend(): DurabilityBackend {
  return {
    name: VERCEL_DURABILITY_BACKEND_NAME,
    async createBinding() {
      return {
        port: createVercelDurabilityPort({ sessionId: "binding" }),
        async shutdown() {},
      };
    },
  };
}
