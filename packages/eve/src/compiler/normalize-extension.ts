import { join as joinPath, relative as relativePath } from "node:path";

import type { ResolvedExtensionMount } from "#discover/manifest.js";
import type {
  CompiledConnectionDefinition,
  CompiledDynamicInstructionsDefinition,
  CompiledDynamicSkillDefinition,
  CompiledDynamicToolDefinition,
  CompiledHookDefinition,
  CompiledScheduleDefinition,
  CompiledSkillDefinition,
  CompiledToolDefinition,
} from "#compiler/manifest.js";
import { compileConnectionDefinition } from "#compiler/normalize-connection.js";
import type { ManifestCompileContext } from "#compiler/normalize-helpers.js";
import { compileHookEntry } from "#compiler/normalize-hook.js";
import { compileInstructionsEntry } from "#compiler/normalize-instructions.js";
import { compileScheduleDefinition } from "#compiler/normalize-schedule.js";
import { compileSkillSource } from "#compiler/normalize-skill.js";
import { compileToolEntry } from "#compiler/normalize-tool.js";

/**
 * Contributions one mounted extension composes into the consuming agent,
 * already namespaced by the mount and rebased onto the consumer's agent root.
 */
export interface CompiledExtensionContributions {
  readonly tools: CompiledToolDefinition[];
  readonly dynamicTools: CompiledDynamicToolDefinition[];
  readonly hooks: CompiledHookDefinition[];
  readonly schedules: CompiledScheduleDefinition[];
  readonly skills: CompiledSkillDefinition[];
  readonly dynamicSkills: CompiledDynamicSkillDefinition[];
  readonly dynamicInstructions: CompiledDynamicInstructionsDefinition[];
  readonly connections: CompiledConnectionDefinition[];
  readonly instructionFragments: string[];
}

/**
 * Compiles one mounted extension's source tree and namespaces its
 * contributions by the mount name. Module-backed contributions keep loading
 * from the extension package because their `logicalPath` is rebased to a
 * consumer-relative path — the module-map codegen resolves it against the
 * consumer's agent root, reaching into the extension package unchanged.
 */
export async function compileExtensionContributions(input: {
  readonly mount: ResolvedExtensionMount;
  readonly context: ManifestCompileContext;
  readonly consumerAgentRoot: string;
  readonly externalDependencies: readonly string[];
}): Promise<CompiledExtensionContributions> {
  const { mount, consumerAgentRoot } = input;
  const sourceRoot = mount.manifest.agentRoot;
  const options = { externalDependencies: input.externalDependencies };
  const prefix = `${mount.namespace}__`;
  const scopeSourceId = (sourceId: string): string => `ext:${mount.namespace}:${sourceId}`;
  const rebase = (logicalPath: string): string =>
    relativePath(consumerAgentRoot, joinPath(sourceRoot, logicalPath)).replaceAll("\\", "/");

  const tools: CompiledToolDefinition[] = [];
  const dynamicTools: CompiledDynamicToolDefinition[] = [];
  for (const source of mount.manifest.tools) {
    const entry = await compileToolEntry(sourceRoot, source, options);
    if (entry.kind === "tool") {
      tools.push({
        ...entry.definition,
        name: `${prefix}${entry.definition.name}`,
        sourceId: scopeSourceId(entry.definition.sourceId),
        logicalPath: rebase(entry.definition.logicalPath),
      });
    } else if (entry.kind === "dynamic-tool") {
      dynamicTools.push({
        ...entry.definition,
        slug: `${prefix}${entry.definition.slug}`,
        sourceId: scopeSourceId(entry.definition.sourceId),
        logicalPath: rebase(entry.definition.logicalPath),
      });
    }
  }

  const hooks: CompiledHookDefinition[] = mount.manifest.hooks.map((source) => {
    const hook = compileHookEntry(source);
    return {
      ...hook,
      slug: `${prefix}${hook.slug}`,
      sourceId: scopeSourceId(hook.sourceId),
      logicalPath: rebase(hook.logicalPath),
    };
  });

  const schedules: CompiledScheduleDefinition[] = (
    await Promise.all(
      mount.manifest.schedules.map((source) =>
        compileScheduleDefinition(sourceRoot, source, options),
      ),
    )
  ).map((schedule) => ({
    ...schedule,
    name: `${prefix}${schedule.name}`,
    sourceId: scopeSourceId(schedule.sourceId),
    logicalPath: rebase(schedule.logicalPath),
  }));

  const skills: CompiledSkillDefinition[] = [];
  const dynamicSkills: CompiledDynamicSkillDefinition[] = [];
  for (const source of mount.manifest.skills) {
    const entry = await compileSkillSource(sourceRoot, source, options);
    if (entry.kind === "skill") {
      skills.push({
        ...entry.definition,
        name: `${prefix}${entry.definition.name}`,
        sourceId: scopeSourceId(entry.definition.sourceId),
        logicalPath: rebase(entry.definition.logicalPath),
      });
    } else {
      dynamicSkills.push({
        ...entry.definition,
        slug: `${prefix}${entry.definition.slug}`,
        sourceId: scopeSourceId(entry.definition.sourceId),
        logicalPath: rebase(entry.definition.logicalPath),
      });
    }
  }

  const connections: CompiledConnectionDefinition[] = (
    await Promise.all(
      mount.manifest.connections.map((source) =>
        compileConnectionDefinition(sourceRoot, source, options),
      ),
    )
  ).map((connection) => ({
    ...connection,
    connectionName: `${prefix}${connection.connectionName}`,
    sourceId: scopeSourceId(connection.sourceId),
    logicalPath: rebase(connection.logicalPath),
  }));

  const dynamicInstructions: CompiledDynamicInstructionsDefinition[] = [];
  const instructionFragments: string[] = [];
  for (const source of mount.manifest.instructions) {
    const entry = await compileInstructionsEntry(sourceRoot, source, options);
    if (entry.kind === "instructions") {
      instructionFragments.push(entry.definition.markdown);
    } else {
      dynamicInstructions.push({
        ...entry.definition,
        slug: `${prefix}${entry.definition.slug}`,
        sourceId: scopeSourceId(entry.definition.sourceId),
        logicalPath: rebase(entry.definition.logicalPath),
      });
    }
  }

  return {
    tools,
    dynamicTools,
    hooks,
    schedules,
    skills,
    dynamicSkills,
    dynamicInstructions,
    connections,
    instructionFragments,
  };
}
