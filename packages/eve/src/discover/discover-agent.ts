import { join, resolve } from "node:path";

import { discoverConnectionSources } from "#discover/connections.js";
import { createDiscoverErrorDiagnostic, type DiscoverDiagnostic } from "#discover/diagnostics.js";
import { discoverSubagents } from "#discover/discover-subagent.js";
import {
  DISCOVER_EXTENSION_AGENT_CONFIG_UNSUPPORTED,
  DISCOVER_EXTENSION_SANDBOX_UNSUPPORTED,
  locateExtensionMount,
} from "#discover/extensions.js";
import { classifyAgentRootEntry } from "#discover/filesystem.js";
import {
  createChannelNameDiagnostic,
  createExtensionNameDiagnostic,
  createHookNameDiagnostic,
  createToolNameDiagnostic,
  createUnsupportedRootDirectoryDiagnostics,
  DISCOVER_CHANNELS_DIRECTORY_INVALID,
  DISCOVER_EXTENSIONS_DIRECTORY_INVALID,
  DISCOVER_HOOKS_DIRECTORY_INVALID,
  DISCOVER_TOOLS_DIRECTORY_INVALID,
  discoverFlatModuleSource,
  discoverInstructionsSource,
  discoverNamedSourceDirectory,
  readSortedDirectoryEntries,
} from "#discover/grammar.js";
import { discoverLibSources } from "#discover/lib.js";
import {
  type AgentSourceManifest,
  type CreateAgentSourceManifestInput,
  createAgentSourceManifest,
  type ResolvedExtensionMount,
} from "#discover/manifest.js";
import { createDiskProjectSource, type ProjectSource } from "#discover/project-source.js";
import { discoverSandboxSource } from "#discover/sandbox.js";
import { discoverScheduleSources } from "#discover/schedules.js";
import { discoverSkills } from "#discover/skills.js";
import { stripNpmPackageScope } from "#shared/package-name.js";

/**
 * Input for discovering the authored agent source graph from resolved roots.
 */
interface DiscoverAgentInput {
  agentRoot: string;
  appRoot: string;
  /**
   * Optional {@link ProjectSource} used for all filesystem reads. Defaults
   * to a disk-backed source so disk callers keep their current behaviour.
   * Tests that want to run discovery against an in-memory tree pass a
   * memory-backed source.
   */
  source?: ProjectSource;
  /**
   * Discovery role. `"agent"` (default) resolves mounted extensions and
   * accepts agent-level config. `"extension"` discovers an extension's own
   * source tree: it rejects `agent.ts`/`sandbox` (consumer-owned) and does
   * not resolve further extensions (transitive mounting is a non-goal).
   */
  role?: "agent" | "extension";
}

/**
 * Result of discovering one authored agent source graph.
 */
interface DiscoverAgentResult {
  diagnostics: DiscoverDiagnostic[];
  manifest: AgentSourceManifest;
}

/**
 * Discovers the current agent's authored source graph without importing authored
 * modules.
 */
export async function discoverAgent(input: DiscoverAgentInput): Promise<DiscoverAgentResult> {
  const source = input.source ?? createDiskProjectSource();
  const appRoot = resolve(input.appRoot);
  const agentRoot = resolve(input.agentRoot);
  const role = input.role ?? "agent";
  const diagnostics: DiscoverDiagnostic[] = [];
  const packageName = await tryReadPackageJsonName(source, appRoot);
  const rootEntries = await readSortedDirectoryEntries(source, agentRoot);

  diagnostics.push(
    ...createUnsupportedRootDirectoryDiagnostics({
      classifyEntry: classifyAgentRootEntry,
      createUnsupportedDirectoryMessage(directoryName) {
        return `Ignoring unsupported directory "${directoryName}/" in the agent root.`;
      },
      rootEntries,
      rootPath: agentRoot,
    }),
  );

  const instructionsResult = await discoverInstructionsSource({
    rootEntries,
    rootPath: agentRoot,
    source,
    required: role !== "extension",
  });
  diagnostics.push(...instructionsResult.diagnostics);

  const configModuleResult = discoverFlatModuleSource({
    rootEntries,
    rootPath: agentRoot,
    slotName: "agent",
  });
  diagnostics.push(...configModuleResult.diagnostics);

  const channelsResult = await discoverNamedSourceDirectory({
    directoryName: "channels",
    invalidDirectoryCode: DISCOVER_CHANNELS_DIRECTORY_INVALID,
    invalidDirectoryMessage: `Expected "${join(agentRoot, "channels")}" to be a directory of authored channels.`,
    recursive: true,
    rootEntries,
    rootPath: agentRoot,
    source,
    validateSegment: createChannelNameDiagnostic,
  });
  diagnostics.push(...channelsResult.diagnostics);

  const libResult = await discoverLibSources({
    agentRoot,
    rootEntries,
    source,
  });
  diagnostics.push(...libResult.diagnostics);

  const schedulesResult = await discoverScheduleSources({
    agentRoot,
    rootEntries,
    source,
  });
  diagnostics.push(...schedulesResult.diagnostics);

  const connectionsResult = await discoverConnectionSources({
    rootEntries,
    rootPath: agentRoot,
    source,
  });
  diagnostics.push(...connectionsResult.diagnostics);

  const sandboxResult = await discoverSandboxSource({
    rootEntries,
    rootPath: agentRoot,
    source,
  });
  diagnostics.push(...sandboxResult.diagnostics);

  if (role === "extension") {
    if (configModuleResult.module !== undefined) {
      diagnostics.push(
        createDiscoverErrorDiagnostic({
          code: DISCOVER_EXTENSION_AGENT_CONFIG_UNSUPPORTED,
          message:
            "An extension may not declare agent config (agent.ts) — model, limits, and sandbox are the consuming agent's to own.",
          sourcePath: join(agentRoot, configModuleResult.module.logicalPath),
        }),
      );
    }
    if (sandboxResult.sandbox !== null) {
      diagnostics.push(
        createDiscoverErrorDiagnostic({
          code: DISCOVER_EXTENSION_SANDBOX_UNSUPPORTED,
          message: "An extension may not declare a sandbox — it is the consuming agent's to own.",
          sourcePath: join(agentRoot, sandboxResult.sandbox.logicalPath),
        }),
      );
    }
  }

  const toolsResult = await discoverNamedSourceDirectory({
    directoryName: "tools",
    invalidDirectoryCode: DISCOVER_TOOLS_DIRECTORY_INVALID,
    invalidDirectoryMessage: `Expected "${join(agentRoot, "tools")}" to be a directory of authored tools.`,
    recursive: true,
    rootEntries,
    rootPath: agentRoot,
    source,
    validateSegment: createToolNameDiagnostic,
  });
  diagnostics.push(...toolsResult.diagnostics);

  const hooksResult = await discoverNamedSourceDirectory({
    directoryName: "hooks",
    invalidDirectoryCode: DISCOVER_HOOKS_DIRECTORY_INVALID,
    invalidDirectoryMessage: `Expected "${join(agentRoot, "hooks")}" to be a directory of authored hooks.`,
    recursive: true,
    rootEntries,
    rootPath: agentRoot,
    source,
    validateSegment: createHookNameDiagnostic,
  });
  diagnostics.push(...hooksResult.diagnostics);

  const extensionsResult = await discoverNamedSourceDirectory({
    directoryName: "extensions",
    invalidDirectoryCode: DISCOVER_EXTENSIONS_DIRECTORY_INVALID,
    invalidDirectoryMessage: `Expected "${join(agentRoot, "extensions")}" to be a directory of extension mounts.`,
    recursive: false,
    rootEntries,
    rootPath: agentRoot,
    source,
    validateSegment: createExtensionNameDiagnostic,
  });
  diagnostics.push(...extensionsResult.diagnostics);

  const skillsResult = await discoverSkills({
    agentRoot,
    source,
  });
  diagnostics.push(...skillsResult.diagnostics);

  const subagentsResult = await discoverSubagents({
    agentRoot,
    appRoot,
    source,
  });
  diagnostics.push(...subagentsResult.diagnostics);

  const resolvedExtensions: ResolvedExtensionMount[] = [];
  if (role === "agent") {
    for (const mount of extensionsResult.sources) {
      const located = await locateExtensionMount({ source, agentRoot, appRoot, mount });
      diagnostics.push(...located.diagnostics);
      if (located.location === undefined) {
        continue;
      }

      const extensionResult = await discoverAgent({
        agentRoot: located.location.sourceRoot,
        appRoot: located.location.packageRoot,
        source,
        role: "extension",
      });
      diagnostics.push(...extensionResult.diagnostics);
      resolvedExtensions.push({
        namespace: located.location.namespace,
        specifier: located.location.specifier,
        packageName: located.location.packageName,
        packageRoot: located.location.packageRoot,
        sourceRoot: located.location.sourceRoot,
        manifest: extensionResult.manifest,
      });
    }
  }

  const manifestInput: CreateAgentSourceManifestInput = {
    agentRoot,
    appRoot,
    channels: channelsResult.sources,
    connections: connectionsResult.connections,
    packageName,
    diagnostics,
    extensions: extensionsResult.sources,
    resolvedExtensions,
    hooks: hooksResult.sources,
    lib: libResult.lib,
    instructions: instructionsResult.instructions,
    sandbox: sandboxResult.sandbox,
    sandboxWorkspaces:
      sandboxResult.sandboxWorkspace === null ? [] : [sandboxResult.sandboxWorkspace],
    schedules: schedulesResult.schedules,
    skills: skillsResult.skills,
    tools: toolsResult.sources,
    subagents: subagentsResult.subagents,
  };

  if (configModuleResult.module !== undefined) {
    manifestInput.configModule = configModuleResult.module;
  }

  const manifest = createAgentSourceManifest(manifestInput);

  return {
    diagnostics,
    manifest,
  };
}

/**
 * Reads the `name` field from the app root's package.json through `source`
 * and strips the npm scope prefix when present (e.g. `"@org/my-agent"` →
 * `"my-agent"`).
 *
 * Returns `undefined` when the file does not exist, cannot be parsed, or does
 * not contain a non-empty string `name` field.
 */
async function tryReadPackageJsonName(
  source: ProjectSource,
  appRoot: string,
): Promise<string | undefined> {
  try {
    const packageJsonPath = join(appRoot, "package.json");
    const content = JSON.parse(await source.readTextFile(packageJsonPath)) as {
      name?: unknown;
    };
    const name = content.name;

    if (typeof name !== "string" || name.length === 0) {
      return undefined;
    }

    return stripNpmPackageScope(name);
  } catch {
    return undefined;
  }
}
