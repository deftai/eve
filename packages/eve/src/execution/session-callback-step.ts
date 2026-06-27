import type { SessionCallback } from "#channel/types.js";
import { parseSessionCallback } from "#channel/session-callback.js";
import { SessionCallbackKey } from "#context/keys.js";
import { readDurableSession, type DurableSessionState } from "#execution/durable-session-store.js";
import { getTurnUsageState } from "#harness/turn-tag-state.js";
import { createLogger } from "#internal/logging.js";
import { toErrorMessage } from "#shared/errors.js";

const SESSION_CALLBACK_TIMEOUT_MS = 30_000;
const log = createLogger("execution.session-callback");

export interface SessionCallbackUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

/**
 * Sends the configured session terminal callback.
 *
 * Absence is a no-op. Once callback metadata is present, delivery is part of
 * the remote delegation result path, so failures are logged and rethrown
 * instead of being reported as a successful terminal step. Throwing is
 * intentional: this function runs as a durable Workflow step, so rejection
 * hands retry/failure policy back to the Workflow orchestrator rather than
 * letting eve falsely mark the callback delivery as complete.
 */
export async function fireSessionCallbackStep(input: {
  readonly error?: unknown;
  readonly output?: unknown;
  readonly serializedContext: Record<string, unknown>;
  readonly sessionState?: DurableSessionState;
  readonly status: "completed" | "failed";
}): Promise<void> {
  "use step";

  const sessionId = (input.serializedContext["eve.sessionId"] as string | undefined) ?? "";
  const value = input.serializedContext[SessionCallbackKey.name];
  if (value === undefined) {
    return;
  }

  try {
    const callback = parseSerializedSessionCallback(value);
    let body:
      | {
          callId: string;
          kind: "session.completed";
          output: unknown;
          sessionId: string;
          subagentName: string;
          usage?: SessionCallbackUsage;
        }
      | {
          callId: string;
          error: { code: string; message: string };
          kind: "session.failed";
          sessionId: string;
          subagentName: string;
        };
    if (input.status === "completed") {
      body = {
        callId: callback.callId,
        kind: "session.completed",
        output: input.output ?? "",
        sessionId,
        subagentName: callback.subagentName,
      };
      const usage =
        input.sessionState !== undefined ? await readCompletedUsage(input.sessionState) : undefined;
      if (usage !== undefined) {
        body.usage = usage;
      }
    } else {
      body = {
        callId: callback.callId,
        error: {
          code: "SESSION_FAILED",
          message: toErrorMessage(input.error),
        },
        kind: "session.failed",
        sessionId,
        subagentName: callback.subagentName,
      };
    }

    const response = await fetch(callback.url, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      // Do not follow redirects: a validated callback host could otherwise
      // 3xx-bounce the framework to an internal/metadata address after the
      // path/token check has already passed.
      redirect: "error",
      signal: AbortSignal.timeout(SESSION_CALLBACK_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Session callback failed with HTTP ${response.status}.`);
    }
  } catch (error) {
    log.error("failed to post session callback", {
      error,
      sessionId,
    });
    throw error;
  }
}

async function readCompletedUsage(
  state: DurableSessionState,
): Promise<SessionCallbackUsage | undefined> {
  try {
    const durable = await readDurableSession(state);
    const turn = getTurnUsageState(durable.state);
    if (turn === undefined) {
      return undefined;
    }
    return {
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      cacheReadTokens: turn.cacheReadTokens,
    };
  } catch (error) {
    log.warn("failed to read remote-agent usage for session callback", { error });
    return undefined;
  }
}

function parseSerializedSessionCallback(value: unknown): SessionCallback {
  const parsed = parseSessionCallback(value);
  if (!parsed.ok) {
    throw new Error("Serialized session callback is invalid.", {
      cause: parsed.cause,
    });
  }

  return parsed.callback;
}
