import type { SessionEventCursor } from "#client/types.js";
import type { HandleMessageStreamEvent, HandleMessageStreamEventMeta } from "#protocol/message.js";
import { isCurrentTurnBoundaryEvent, readHandleMessageStreamEventTurn } from "#protocol/message.js";

type EventTurn = NonNullable<HandleMessageStreamEventMeta["turn"]>;

/** Projects an at-least-once physical stream into one logical event stream. */
export class ReplayNormalizer {
  #activeTurn: EventTurn | undefined;
  #initialized: boolean;
  #physicalTurn: EventTurn | undefined;
  #sawSessionStarted: boolean;
  readonly #seenEventIds: Set<string>;
  #settledTurnSequence: number | undefined;

  constructor(cursor?: SessionEventCursor) {
    this.#activeTurn = cursor?.activeTurn;
    this.#initialized = cursor !== undefined;
    this.#physicalTurn = cursor?.physicalTurn;
    this.#sawSessionStarted = cursor?.sawSessionStarted ?? false;
    this.#seenEventIds = new Set(cursor?.seenEventIds);
    this.#settledTurnSequence = cursor?.settledTurnSequence;
  }

  /** Current bounded cursor, safe to serialize after a disconnect or abort. */
  get cursor(): SessionEventCursor | undefined {
    if (!this.#initialized) return undefined;

    const cursor: {
      activeTurn?: EventTurn;
      physicalTurn?: EventTurn;
      sawSessionStarted?: boolean;
      seenEventIds?: string[];
      settledTurnSequence?: number;
      version: 1;
    } = { version: 1 };
    if (this.#activeTurn !== undefined) cursor.activeTurn = this.#activeTurn;
    if (this.#physicalTurn !== undefined) cursor.physicalTurn = this.#physicalTurn;
    if (this.#sawSessionStarted) cursor.sawSessionStarted = true;
    if (this.#activeTurn !== undefined && this.#seenEventIds.size > 0) {
      cursor.seenEventIds = [...this.#seenEventIds];
    }
    if (this.#settledTurnSequence !== undefined) {
      cursor.settledTurnSequence = this.#settledTurnSequence;
    }
    return cursor;
  }

  /** Returns whether one physical event should be exposed to public consumers. */
  shouldExpose(event: HandleMessageStreamEvent): boolean {
    return this.#process(event, false);
  }

  /** Incorporates a hidden stream prefix, including events from pre-v17 servers. */
  observeHistory(event: HandleMessageStreamEvent): void {
    this.#process(event, true);
  }

  #process(event: HandleMessageStreamEvent, includeLegacyCoordinates: boolean): boolean {
    this.#initialized = true;
    const eventId = event.meta?.eventId;
    const boundary = isCurrentTurnBoundaryEvent(event);
    const declaredTurn =
      event.meta?.turn ??
      (includeLegacyCoordinates ? readHandleMessageStreamEventTurn(event) : undefined);
    if (declaredTurn !== undefined) this.#physicalTurn = declaredTurn;
    const turn = declaredTurn ?? (boundary ? this.#physicalTurn : undefined);

    if (event.type === "session.started") {
      if (eventId === undefined && !includeLegacyCoordinates) return true;
      if (this.#sawSessionStarted) return false;
      this.#sawSessionStarted = true;
    }

    if (turn !== undefined) {
      if (this.#settledTurnSequence !== undefined && turn.sequence <= this.#settledTurnSequence) {
        if (boundary) this.#physicalTurn = undefined;
        return false;
      }

      if (this.#activeTurn === undefined || turn.sequence > this.#activeTurn.sequence) {
        if (this.#activeTurn !== undefined) {
          this.#settledTurnSequence = Math.max(
            this.#settledTurnSequence ?? -1,
            this.#activeTurn.sequence,
          );
        }
        this.#activeTurn = turn;
        this.#seenEventIds.clear();
      } else if (
        turn.sequence < this.#activeTurn.sequence ||
        (turn.sequence === this.#activeTurn.sequence && turn.id !== this.#activeTurn.id)
      ) {
        if (boundary) this.#physicalTurn = undefined;
        return false;
      }

      if (eventId !== undefined) {
        if (this.#seenEventIds.has(eventId)) return false;
        this.#seenEventIds.add(eventId);
      }

      if (boundary) {
        this.#settledTurnSequence = Math.max(this.#settledTurnSequence ?? -1, turn.sequence);
        this.#activeTurn = undefined;
        this.#physicalTurn = undefined;
        this.#seenEventIds.clear();
      }
    }

    return true;
  }
}
