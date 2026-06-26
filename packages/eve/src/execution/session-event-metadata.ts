import type { HarnessSession } from "#harness/types.js";
import { getHarnessEmissionState, setHarnessEmissionEventIndex } from "#harness/emission.js";
import type {
  HandleMessageStreamEvent,
  HandleMessageStreamEventMeta,
  TimedHandleMessageStreamEvent,
} from "#protocol/message.js";
import {
  readHandleMessageStreamEventTurn,
  timestampHandleMessageStreamEvent,
} from "#protocol/message.js";

/** Assigns replay-stable identities to events emitted from one durable step. */
export class SessionEventMetadataCursor {
  readonly #initialEventIndex: number;
  readonly #sessionId: string;
  #nextEventIndex: number;
  #turn: HandleMessageStreamEventMeta["turn"] | undefined;

  constructor(input: {
    readonly eventIndex?: number;
    readonly sessionId: string;
    readonly turn?: HandleMessageStreamEventMeta["turn"];
  }) {
    this.#initialEventIndex = input.eventIndex ?? 0;
    this.#nextEventIndex = this.#initialEventIndex;
    this.#sessionId = input.sessionId;
    this.#turn = input.turn;
  }

  /** Stamps one event and advances the durable emission position. */
  stamp(event: HandleMessageStreamEvent): TimedHandleMessageStreamEvent {
    const eventTurn = readHandleMessageStreamEventTurn(event);
    if (eventTurn !== undefined) this.#turn = eventTurn;

    return timestampHandleMessageStreamEvent(event, undefined, {
      eventIndex: this.#nextEventIndex++,
      sessionId: this.#sessionId,
      turn: eventTurn ?? this.#turn,
    });
  }

  /** Persists the next event position on a step's returned session snapshot. */
  apply(session: HarnessSession): HarnessSession {
    if (this.#nextEventIndex === this.#initialEventIndex) return session;
    return setHarnessEmissionEventIndex(session, this.#nextEventIndex);
  }
}

/** Creates a metadata cursor from the emission state carried by a durable session. */
export function createSessionEventMetadataCursor(input: {
  readonly eventIndex?: number;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly turnSequence?: number;
}): SessionEventMetadataCursor {
  return new SessionEventMetadataCursor({
    eventIndex: input.eventIndex,
    sessionId: input.sessionId,
    turn:
      input.turnId === undefined || input.turnId === "" || input.turnSequence === undefined
        ? undefined
        : { id: input.turnId, sequence: input.turnSequence },
  });
}

/** Creates a metadata cursor directly from a hydrated harness session. */
export function createSessionEventMetadataCursorForSession(
  session: HarnessSession,
): SessionEventMetadataCursor {
  const emission = getHarnessEmissionState(session.state);
  return createSessionEventMetadataCursor({
    eventIndex: emission.eventIndex,
    sessionId: session.sessionId,
    turnId: emission.turnId,
    turnSequence: emission.sequence,
  });
}
