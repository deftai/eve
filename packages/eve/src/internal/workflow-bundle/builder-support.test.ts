import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createEvePackageImportsPlugin,
  createWorkflowNodeBuiltinGuardPlugin,
  isWorkflowInputSourceFile,
} from "#internal/workflow-bundle/builder-support.js";

const packagesEveRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("isWorkflowInputSourceFile", () => {
  it("accepts production workflow sources", () => {
    expect(isWorkflowInputSourceFile("turn-workflow.ts")).toBe(true);
    expect(isWorkflowInputSourceFile("workflow-entry.mts")).toBe(true);
  });

  it("rejects unit, integration, and scenario test basenames", () => {
    expect(isWorkflowInputSourceFile("turn-workflow.test.ts")).toBe(false);
    expect(isWorkflowInputSourceFile("workflow-entry.integration.test.ts")).toBe(false);
    expect(isWorkflowInputSourceFile("builder.scenario.test.ts")).toBe(false);
    expect(isWorkflowInputSourceFile("hook.test.tsx")).toBe(false);
  });

  it("rejects non-source extensions", () => {
    expect(isWorkflowInputSourceFile("readme.md")).toBe(false);
    expect(isWorkflowInputSourceFile("package.json")).toBe(false);
  });
});

describe("createEvePackageImportsPlugin workflowCondition", () => {
  function resolveId(
    source: string,
    options: { workflowCondition?: boolean } = { workflowCondition: true },
  ): string | undefined {
    const plugin = createEvePackageImportsPlugin(packagesEveRoot, options);
    const resolved = (plugin.resolveId as (s: string) => { id?: string } | string | undefined)(
      source,
    );
    if (resolved === undefined) {
      return undefined;
    }
    if (typeof resolved === "string") {
      return resolved;
    }
    return resolved.id;
  }

  it("aliases #internal/workflow/runtime.js to the workflow-runtime shim", () => {
    expect(resolveId("#internal/workflow/runtime.js")).toMatch(/workflow-runtime-shim\.ts$/);
  });

  it("aliases #compiled/@workflow/core/runtime.js to the workflow-runtime shim", () => {
    expect(resolveId("#compiled/@workflow/core/runtime.js")).toMatch(/workflow-runtime-shim\.ts$/);
  });

  it("does not alias #internal/workflow/runtime.js when workflowCondition is off", () => {
    expect(resolveId("#internal/workflow/runtime.js", {})).toMatch(
      /internal[/\\]workflow[/\\]runtime\.ts$/,
    );
  });
});

describe("createWorkflowNodeBuiltinGuardPlugin", () => {
  const plugin = createWorkflowNodeBuiltinGuardPlugin();

  function resolve(source: string, importer?: string): unknown {
    return (plugin.resolveId as (s: string, i?: string) => unknown)(source, importer);
  }

  it("throws on a prefixed node: builtin and names the importer", () => {
    expect(() => resolve("node:util", "/app/src/execution/x.ts")).toThrow(
      /Node\.js builtin "node:util".*imported by "\/app\/src\/execution\/x\.ts".*use step/s,
    );
  });

  it("throws on a bare builtin specifier", () => {
    expect(() => resolve("fs")).toThrow(/Node\.js builtin "fs"/);
  });

  it("passes through non-builtin specifiers", () => {
    expect(resolve("#internal/logging.js")).toBeUndefined();
    expect(resolve("./sibling.js")).toBeUndefined();
    expect(resolve("eve")).toBeUndefined();
  });

  it("omits the importer clause when the importer is unknown", () => {
    expect(() => resolve("node:crypto")).toThrow(/Node\.js builtin "node:crypto"\. Move/);
  });
});
