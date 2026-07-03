import { resumeHook } from "#internal/workflow/runtime.js";

import type { ChannelAdapter } from "#channel/adapter.js";
import type {
  SubagentAuthorizationCompletedHookPayload,
  SubagentAuthorizationRequestHookPayload,
  SubagentInputRequestHookPayload,
} from "#channel/types.js";
import { ContinuationTokenKey, SessionIdKey } from "#context/keys.js";
import { createErrorId, createLogger } from "#internal/logging.js";
import type {
  AuthorizationCompletedStreamEvent,
  AuthorizationRequiredStreamEvent,
} from "#protocol/message.js";

const log = createLogger("execution.subagent-adapter");

/**
 * Durable adapter kind used for delegated subagent child runs.
 *
 * Framework-owned — authored channel code never constructs a subagent
 * adapter directly. Emitted by `buildSubagentRunInput`
 * (`execution/subagent-tool.ts`) when a parent dispatches a child
 * subagent.
 */
export const SUBAGENT_ADAPTER_KIND = "subagent";

/**
 * Durable state carried on a subagent adapter instance.
 *
 * Populated by `buildSubagentRunInput` at dispatch time so the child
 * run retains the parent lineage metadata required to resume its parent
 * when the child finishes and to forward HITL requests up the chain.
 *
 * The parent's turn identifier is not duplicated here — it lives on
 * `RunInput.parent.turn.id` which is the single source of truth for the
 * child's parent-turn lineage.
 */
export interface SubagentAdapterState extends Record<string, unknown> {
  readonly callId: string;
  readonly parentContinuationToken: string;
  readonly parentSessionId: string;
  readonly subagentName: string;
}

/**
 * Narrow runtime guard for {@link SubagentAdapterState}.
 *
 * Framework adapters live through a JSON round-trip at every workflow
 * step boundary, so consumers that want to treat the adapter state as
 * a structured record must validate the shape explicitly.
 */
export function isSubagentAdapterState(value: unknown): value is SubagentAdapterState {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<SubagentAdapterState>;

  return (
    typeof state.callId === "string" &&
    state.callId.length > 0 &&
    typeof state.parentContinuationToken === "string" &&
    state.parentContinuationToken.length > 0 &&
    typeof state.parentSessionId === "string" &&
    typeof state.subagentName === "string" &&
    state.subagentName.length > 0
  );
}

/**
 * Framework adapter that bridges a child subagent session to its
 * parent.
 *
 * It proxies child `input.requested` events upward so the parent channel
 * can render HITL prompts and route responses back down to the child, and
 * child `authorization.required`/`authorization.completed` events so the
 * parent channel can render connection sign-in affordances. Authorization
 * needs no downward routing: the challenge's OAuth callback resumes the
 * child session's own hook directly.
 */
export const SUBAGENT_ADAPTER: ChannelAdapter = {
  kind: SUBAGENT_ADAPTER_KIND,
  async "input.requested"(data, ctx) {
    const state = ctx.state;

    if (!isSubagentAdapterState(state)) {
      return;
    }

    const hookPayload: SubagentInputRequestHookPayload = {
      callId: state.callId,
      childContinuationToken: ctx.ctx.require(ContinuationTokenKey),
      childSessionId: ctx.ctx.require(SessionIdKey),
      event: {
        requests: data.requests,
        sequence: data.sequence,
        stepIndex: data.stepIndex,
        turnId: data.turnId,
      },
      kind: "subagent-input-request",
      subagentName: state.subagentName,
    };

    await forwardSubagentInputRequestStep({
      hookPayload,
      parentContinuationToken: state.parentContinuationToken,
    });
  },
  async "authorization.required"(data, ctx) {
    const state = ctx.state;

    if (!isSubagentAdapterState(state)) {
      return;
    }

    const event: AuthorizationRequiredStreamEvent["data"] = {
      description: data.description,
      name: data.name,
      sequence: data.sequence,
      stepIndex: data.stepIndex,
      turnId: data.turnId,
    };
    if (data.authorization !== undefined) {
      event.authorization = data.authorization;
    }
    if (data.webhookUrl !== undefined) {
      event.webhookUrl = data.webhookUrl;
    }

    const hookPayload: SubagentAuthorizationRequestHookPayload = {
      callId: state.callId,
      childSessionId: ctx.ctx.require(SessionIdKey),
      event,
      kind: "subagent-authorization-request",
      subagentName: state.subagentName,
    };

    await forwardSubagentAuthorizationEventStep({
      hookPayload,
      parentContinuationToken: state.parentContinuationToken,
    });
  },
  async "authorization.completed"(data, ctx) {
    const state = ctx.state;

    if (!isSubagentAdapterState(state)) {
      return;
    }

    const event: AuthorizationCompletedStreamEvent["data"] = {
      name: data.name,
      outcome: data.outcome,
      sequence: data.sequence,
      stepIndex: data.stepIndex,
      turnId: data.turnId,
    };
    if (data.authorization !== undefined) {
      event.authorization = data.authorization;
    }
    if (data.reason !== undefined) {
      event.reason = data.reason;
    }

    const hookPayload: SubagentAuthorizationCompletedHookPayload = {
      callId: state.callId,
      childSessionId: ctx.ctx.require(SessionIdKey),
      event,
      kind: "subagent-authorization-completed",
      subagentName: state.subagentName,
    };

    await forwardSubagentAuthorizationEventStep({
      hookPayload,
      parentContinuationToken: state.parentContinuationToken,
    });
  },
};

/**
 * Forwards one child HITL batch up to its parent via the durable
 * workflow `resumeHook` path.
 */
async function forwardSubagentInputRequestStep(input: {
  readonly hookPayload: SubagentInputRequestHookPayload;
  readonly parentContinuationToken: string;
}): Promise<void> {
  "use step";

  try {
    await resumeHook(input.parentContinuationToken, input.hookPayload);
  } catch (error) {
    const errorId = createErrorId();
    log.warn("failed to forward proxied HITL batch to parent", {
      callId: input.hookPayload.callId,
      childContinuationToken: input.hookPayload.childContinuationToken,
      childSessionId: input.hookPayload.childSessionId,
      errorId,
      parentContinuationToken: input.parentContinuationToken,
      subagentName: input.hookPayload.subagentName,
      error,
    });
    throw error;
  }
}

/**
 * Forwards one child authorization lifecycle event up to its parent via
 * the durable workflow `resumeHook` path.
 */
async function forwardSubagentAuthorizationEventStep(input: {
  readonly hookPayload:
    | SubagentAuthorizationCompletedHookPayload
    | SubagentAuthorizationRequestHookPayload;
  readonly parentContinuationToken: string;
}): Promise<void> {
  "use step";

  try {
    await resumeHook(input.parentContinuationToken, input.hookPayload);
  } catch (error) {
    const errorId = createErrorId();
    log.warn("failed to forward proxied authorization event to parent", {
      callId: input.hookPayload.callId,
      childSessionId: input.hookPayload.childSessionId,
      errorId,
      kind: input.hookPayload.kind,
      parentContinuationToken: input.parentContinuationToken,
      subagentName: input.hookPayload.subagentName,
      error,
    });
    throw error;
  }
}
