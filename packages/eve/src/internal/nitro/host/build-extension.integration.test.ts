import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildExtensionPackage,
  tryReadExtensionBuildConfig,
} from "#internal/nitro/host/build-extension.js";

async function createExtensionPackage(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "eve-ext-build-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "@acme/crm", type: "module", eve: { extension: "ext" } }),
    "utf8",
  );
  await mkdir(join(root, "ext", "tools"), { recursive: true });
  await writeFile(
    join(root, "ext", "config.mjs"),
    'import { defineConfig } from "eve/extension";\nexport default defineConfig({ apiKey: { type: "string", required: true } });\n',
    "utf8",
  );
  await writeFile(
    join(root, "ext", "tools", "crm_search.mjs"),
    'export default { description: "Search the CRM.", async execute() { return {}; } };\n',
    "utf8",
  );
  return root;
}

describe("extension build", () => {
  it("reads eve.extension and derives the short name", async () => {
    const root = await createExtensionPackage();
    const config = await tryReadExtensionBuildConfig(root);
    expect(config).not.toBeNull();
    expect(config?.packageName).toBe("@acme/crm");
    expect(config?.shortName).toBe("crm");
  });

  it("returns null for a regular agent app without eve.extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "eve-app-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "my-agent" }), "utf8");
    expect(await tryReadExtensionBuildConfig(root)).toBeNull();
  });

  it("generates a package index re-exporting the config handle and tools", async () => {
    const root = await createExtensionPackage();
    const config = await tryReadExtensionBuildConfig(root);
    const outDir = await buildExtensionPackage(root, config!);

    const index = await readFile(join(outDir, "index.mjs"), "utf8");
    expect(index).toContain('export { default } from "../ext/config.mjs"');
    expect(index).toContain('export { default as crm } from "../ext/config.mjs"');

    const toolsIndex = await readFile(join(outDir, "tools", "index.mjs"), "utf8");
    expect(toolsIndex).toContain(
      'export { default as crm_search } from "../../ext/tools/crm_search.mjs"',
    );
  });
});
