import { randomUUID } from "node:crypto";

import { InMemoryDurabilityInbox } from "#execution/durability/in-memory-inbox.js";
import type { DurabilityBackend } from "#shared/durability-backend.js";
import type {
  DurabilityBackendCapabilities,
  DurabilityChildTurnHandle,
  DurabilityPort,
  DurabilitySessionHandle,
  DurabilityStartSessionInput,
} from "#shared/durability-port.js";
import type { HandleMessageStreamEvent } from "#protocol/message.js";

import { IN_MEMORY_DURABILITY_BACKEND_NAME } from "#execution/durability/known-backends.js";

export { IN_MEMORY_DURABILITY_BACKEND_NAME };

const IN_MEMORY_CAPABILITIES: DurabilityBackendCapabilities = {
  checkpoints: true,
  childTurns: true,
  crossDeployChildRouting: false,
  eventStream: true,
  inboxes: true,
  scheduleTriggers: false,
};

interface InboxRecord<T> {
  ownerSessionId: string | undefined;
  readonly pending: T[];
  readonly waiters: Array<() => void>;
}

interface SessionRecord {
  readonly checkpointResults: unknown[];
  checkpointCursor: number;
  continuationToken: string;
  readonly events: HandleMessageStreamEvent[];
  readonly sessionId: string;
}

interface InMemoryDurabilityStore {
  readonly childTurns: Map<string, Promise<unknown>>;
  readonly inboxes: Map<string, InboxRecord<unknown>>;
  readonly sessions: Map<string, SessionRecord>;
}

/**
 * Constructs the in-memory durability backend for dev and tests.
 *
 * Process-local only; not a security boundary. Production use emits a
 * framework warning unless explicitly overridden by env.
 */
export function createInMemoryDurabilityBackend(): DurabilityBackend {
  const store = createStore();
  return {
    name: IN_MEMORY_DURABILITY_BACKEND_NAME,
    async createBinding() {
      return {
        port: createInMemoryDurabilityPort(store),
        async shutdown() {
          store.sessions.clear();
          store.inboxes.clear();
          store.childTurns.clear();
        },
      };
    },
  };
}

function createStore(): InMemoryDurabilityStore {
  return {
    childTurns: new Map(),
    inboxes: new Map(),
    sessions: new Map(),
  };
}

function createInMemoryDurabilityPort(store: InMemoryDurabilityStore): DurabilityPort {
  return {
    capabilities: IN_MEMORY_CAPABILITIES,

    async startSession(input: DurabilityStartSessionInput): Promise<DurabilitySessionHandle> {
      const continuationToken = input.continuationToken ?? randomUUID();
      const existing = store.sessions.get(input.sessionId);
      if (existing !== undefined) {
        // Workflow re-entry replays from cached checkpoint results.
        existing.checkpointCursor = 0;
        return {
          continuationToken: existing.continuationToken,
          sessionId: existing.sessionId,
        };
      }
      const record: SessionRecord = {
        checkpointCursor: 0,
        checkpointResults: [],
        continuationToken,
        events: [],
        sessionId: input.sessionId,
      };
      store.sessions.set(input.sessionId, record);
      return { continuationToken, sessionId: input.sessionId };
    },

    async checkpoint<T>(input: {
      readonly fn: () => Promise<T>;
      readonly name: string;
      readonly sessionId: string;
    }): Promise<T> {
      void input.name;
      const session = requireSession(store, input.sessionId);
      if (session.checkpointCursor < session.checkpointResults.length) {
        const cached = session.checkpointResults[session.checkpointCursor];
        session.checkpointCursor += 1;
        return cached as T;
      }
      const result = await input.fn();
      session.checkpointResults.push(result);
      session.checkpointCursor += 1;
      return result;
    },

    createInbox<T>(input: { readonly sessionId: string; readonly token: string }) {
      void input.sessionId;
      let record = store.inboxes.get(input.token);
      if (record === undefined) {
        record = { ownerSessionId: undefined, pending: [], waiters: [] };
        store.inboxes.set(input.token, record);
      }
      return new InMemoryDurabilityInbox<T>(input.token, record as InboxRecord<T>);
    },

    async appendEvent(sessionId: string, event: HandleMessageStreamEvent): Promise<void> {
      const session = requireSession(store, sessionId);
      session.events.push(event);
    },

    readEventStream(sessionId: string, options?: { readonly startIndex?: number }) {
      const session = requireSession(store, sessionId);
      const startIndex = options?.startIndex ?? 0;
      const events = session.events.slice(startIndex);
      return new ReadableStream<HandleMessageStreamEvent>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(event);
          }
          controller.close();
        },
      });
    },

    startChildTurn(input: {
      readonly parentSessionId: string;
      readonly run: () => Promise<unknown>;
    }) {
      void input.parentSessionId;
      const id = randomUUID();
      const promise = input.run();
      store.childTurns.set(id, promise);
      const handle: DurabilityChildTurnHandle = {
        id,
        awaitResult: () => promise,
      };
      return handle;
    },
  };
}

function requireSession(store: InMemoryDurabilityStore, sessionId: string): SessionRecord {
  const session = store.sessions.get(sessionId);
  if (session === undefined) {
    throw new Error(`In-memory durability session "${sessionId}" is not open.`);
  }
  return session;
}
