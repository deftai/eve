import { describe, expect, it } from "vitest";

import { experimental_codex } from "./index.js";

describe("experimental_codex", () => {
  it("creates a Codex-served model from a bare OpenAI slug", () => {
    const model = experimental_codex("gpt-5.5-codex");

    expect(typeof model).toBe("object");
    if (typeof model === "string") throw new Error("expected a model instance");
    expect(model.modelId).toBe("gpt-5.5-codex");
    expect(model.provider).toContain("codex");
  });

  it("strips an openai/ provider prefix", () => {
    const model = experimental_codex("openai/gpt-5.5-codex");

    if (typeof model === "string") throw new Error("expected a model instance");
    expect(model.modelId).toBe("gpt-5.5-codex");
  });

  it("rejects a non-OpenAI provider-qualified id", () => {
    expect(() => experimental_codex("anthropic/claude-sonnet-4.6")).toThrow(
      'experimental_codex serves OpenAI models through the local Codex login; received "anthropic/claude-sonnet-4.6".',
    );
  });

  it("rejects an empty model", () => {
    expect(() => experimental_codex("  ")).toThrow("name an OpenAI model");
    expect(() => experimental_codex("openai/")).toThrow("name an OpenAI model");
  });
});
