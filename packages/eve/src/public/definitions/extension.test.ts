import { describe, expect, it } from "vitest";

import { bindExtensionConfig, defineConfig, getConfig } from "#public/definitions/extension.js";

// Each test uses a distinct namespace because the schema/values registries the
// runtime keys config by are process-global.

describe("defineConfig", () => {
  it("exposes the declared schema", () => {
    const config = defineConfig(
      {
        apiKey: { type: "string", secret: true, required: true },
        baseUrl: { type: "string", default: "https://api.acme.example" },
      },
      "schema-test",
    );

    expect(config.schema.apiKey).toEqual({ type: "string", secret: true, required: true });
    expect(config.schema.baseUrl).toEqual({
      type: "string",
      default: "https://api.acme.example",
    });
  });

  it("rejects a missing required field at bind", () => {
    const config = defineConfig({ apiKey: { type: "string", required: true } }, "bind-required");
    expect(() => bindExtensionConfig(config, {})).toThrow(/required field "apiKey"/);
  });

  it("rejects a bound value of the wrong type", () => {
    const config = defineConfig({ pageSize: { type: "number" } }, "bind-type");
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

describe("getConfig", () => {
  it("throws when called outside a mounted extension", () => {
    expect(() => getConfig()).toThrow(/only works inside a mounted extension/);
  });

  it("throws when the extension declares no config", () => {
    expect(() => getConfig("unmounted-extension")).toThrow(/declares no config/);
  });

  it("returns bound values with declared defaults applied", () => {
    const config = defineConfig(
      {
        apiKey: { type: "string", required: true },
        baseUrl: { type: "string", default: "https://api.acme.example" },
        pageSize: { type: "number", default: 25 },
      },
      "read-defaults",
    );

    bindExtensionConfig(config, { apiKey: "sk-123" });

    expect(getConfig("read-defaults")).toEqual({
      apiKey: "sk-123",
      baseUrl: "https://api.acme.example",
      pageSize: 25,
    });
  });

  it("reads config bound by the mount factory call", () => {
    const config = defineConfig(
      {
        apiKey: { type: "string", required: true },
        baseUrl: { type: "string", default: "https://api.acme.example" },
      },
      "read-factory",
    );

    const mounted = config({ apiKey: "sk-456" });

    expect(mounted).toBeDefined();
    expect(getConfig("read-factory")).toEqual({
      apiKey: "sk-456",
      baseUrl: "https://api.acme.example",
    });
  });

  it("applies defaults for a zero-config mount call", () => {
    const config = defineConfig({ verbose: { type: "boolean", default: false } }, "read-zero");
    config();
    expect(getConfig("read-zero")).toEqual({ verbose: false });
  });

  it("lets a bound value override a default", () => {
    const config = defineConfig(
      { baseUrl: { type: "string", default: "https://default" } },
      "read-override",
    );
    bindExtensionConfig(config, { baseUrl: "https://override" });
    expect(getConfig("read-override")).toEqual({ baseUrl: "https://override" });
  });
});
