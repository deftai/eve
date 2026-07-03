import type { LanguageModel } from "ai";
import { createCodexSubscriptionModel } from "#internal/model-auth/endpoint/codex/model.js";

const OPENAI_PROVIDER_PREFIX = "openai/";

/**
 * Creates a language model served through the local Codex login
 * (`codex login`), billed to the ChatGPT subscription instead of an API key.
 *
 * Accepts a bare OpenAI model slug (`"gpt-5.5-codex"`) or an
 * `openai/`-prefixed id; the Codex backend serves OpenAI models only, so any
 * other provider-qualified id is rejected. Model availability is enforced by
 * the Codex backend per account at call time, not at compile time.
 *
 * Credentials are read from the Codex CLI login on the machine the agent
 * runs on, so this model works in local dev and fails in a deployment.
 * Branch on environment for production, and set `modelContextWindowTokens`
 * because Codex models carry no AI Gateway metadata:
 *
 * ```ts
 * export default defineAgent({
 *   model:
 *     process.env.NODE_ENV === "production"
 *       ? "anthropic/claude-sonnet-4.6"
 *       : experimental_codex("gpt-5.5-codex"),
 *   modelContextWindowTokens: 200_000,
 * });
 * ```
 *
 * Experimental: the Codex backend is not a public API contract and may
 * change or reject subscription-backed access without notice.
 */
export function experimental_codex(model: string): LanguageModel {
  const trimmed = model.trim();
  const slug = trimmed.startsWith(OPENAI_PROVIDER_PREFIX)
    ? trimmed.slice(OPENAI_PROVIDER_PREFIX.length)
    : trimmed;

  if (slug.length === 0) {
    throw new Error(
      'Expected experimental_codex "model" to name an OpenAI model, for example "gpt-5.5-codex".',
    );
  }

  if (slug.includes("/")) {
    throw new Error(
      `experimental_codex serves OpenAI models through the local Codex login; received "${model}".`,
    );
  }

  return createCodexSubscriptionModel({ model: slug });
}
