import { describe, expect, it } from "vitest";

import { bindExtensionConfig, defineConfig } from "#public/definitions/extension.js";

describe("defineConfig", () => {
  it("exposes the declared schema", () => {
    const config = defineConfig({
      apiKey: { type: "string", secret: true, required: true },
      baseUrl: { type: "string", default: "https://api.acme.example" },
    });

    expect(config.schema.apiKey).toEqual({ type: "string", secret: true, required: true });
    expect(config.schema.baseUrl).toEqual({
      type: "string",
      default: "https://api.acme.example",
    });
  });

  it("throws when get() runs before the extension is mounted", () => {
    const config = defineConfig({ apiKey: { type: "string", required: true } });
    expect(() => config.get()).toThrow(/not bound/);
  });

  it("returns bound values with declared defaults applied", () => {
    const config = defineConfig({
      apiKey: { type: "string", required: true },
      baseUrl: { type: "string", default: "https://api.acme.example" },
      pageSize: { type: "number", default: 25 },
    });

    bindExtensionConfig(config, { apiKey: "sk-123" });

    expect(config.get()).toEqual({
      apiKey: "sk-123",
      baseUrl: "https://api.acme.example",
      pageSize: 25,
    });
  });

  it("lets a bound value override a default", () => {
    const config = defineConfig({ baseUrl: { type: "string", default: "https://default" } });
    bindExtensionConfig(config, { baseUrl: "https://override" });
    expect(config.get().baseUrl).toBe("https://override");
  });

  it("rejects a missing required field at bind", () => {
    const config = defineConfig({ apiKey: { type: "string", required: true } });
    expect(() => bindExtensionConfig(config, {})).toThrow(/required field "apiKey"/);
  });

  it("rejects a bound value of the wrong type", () => {
    const config = defineConfig({ pageSize: { type: "number" } });
    expect(() => bindExtensionConfig(config, { pageSize: "nope" })).toThrow(
      /expected number but received string/,
    );
  });

  it("rejects a field that is both required and defaulted", () => {
    expect(() =>
      defineConfig({ apiKey: { type: "string", required: true, default: "x" } }),
    ).toThrow(/both required and has a default/);
  });

  it("rejects an unsupported field type", () => {
    expect(() =>
      // @ts-expect-error intentionally invalid type for the runtime guard
      defineConfig({ when: { type: "date" } }),
    ).toThrow(/unsupported type/);
  });
});
