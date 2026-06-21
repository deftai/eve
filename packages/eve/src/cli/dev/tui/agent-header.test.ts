import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AgentInfoResult, AgentInfoToolEntry } from "#client/index.js";

import { AGENT_HEADER_TIPS, buildAgentHeader, pickAgentHeaderTip } from "./agent-header.js";
import { EVE_BETA_TERMS_URL } from "#cli/banner.js";
import { createTheme } from "./theme.js";

const FRAMEWORK_TOOL: AgentInfoToolEntry = {
  description: "Run a shell command.",
  hasAuth: false,
  hasExecute: true,
  hasModelOutputProjection: false,
  hasOutputSchema: true,
  inputSchema: { type: "object" },
  logicalPath: "eve:framework/bash",
  name: "bash",
  origin: "framework",
  outputSchema: { type: "object" },
  replacesFrameworkTool: false,
  requiresApproval: false,
  sourceId: "eve:bash-tool",
  sourceKind: "module",
};

const AUTHORED_TOOL: AgentInfoToolEntry = {
  description: "Get the weather.",
  hasAuth: false,
  hasExecute: true,
  hasModelOutputProjection: false,
  hasOutputSchema: false,
  inputSchema: { type: "object" },
  logicalPath: "agent/tools/get_weather.ts",
  name: "get_weather",
  origin: "authored",
  outputSchema: null,
  replacesFrameworkTool: false,
  requiresApproval: false,
  sourceKind: "module",
};

const INFO: AgentInfoResult = {
  agent: {
    agentRoot: "/tmp/weather-agent/agent",
    appRoot: "/tmp/weather-agent",
    model: {
      id: "anthropic/claude-opus-4.7",
    },
    name: "Weather Agent",
  },
  capabilities: {
    devRoutes: true,
  },
  channels: {
    authored: [],
    available: [],
    disabledFramework: [],
    framework: [],
  },
  connections: [],
  diagnostics: {
    discoveryErrors: 0,
    discoveryWarnings: 0,
  },
  hooks: [],
  instructions: {
    dynamic: [],
    static: {
      logicalPath: "instructions.md",
      markdown: "You are a weather assistant.",
      name: "instructions",
      sourceKind: "markdown",
    },
  },
  kind: "eve-agent-info",
  mode: "development",
  sandbox: null,
  schedules: [],
  skills: {
    dynamic: [],
    static: [],
  },
  subagents: {
    local: [],
    total: 0,
  },
  tools: {
    authored: [AUTHORED_TOOL],
    available: [FRAMEWORK_TOOL, AUTHORED_TOOL],
    disabledFramework: [],
    dynamic: [],
    framework: [
      {
        ...FRAMEWORK_TOOL,
        disabledByAuthor: false,
        replacedByAuthoredTool: false,
        status: "active",
      },
    ],
    reserved: [],
  },
  version: 1,
  workflow: {
    enabled: false,
    toolName: "Workflow",
  },
  workspace: {
    resourceRoot: null,
    rootEntries: [],
  },
};

describe("buildAgentHeader", () => {
  const theme = createTheme({ color: false, unicode: false });
  const previewLine = ` eve is currently in preview: ${EVE_BETA_TERMS_URL}`;

  it("renders the brand line with the agent name, directory, and port", () => {
    const lines = buildAgentHeader({
      name: "Weather Agent",
      serverUrl: "http://127.0.0.1:2000/",
      appRoot: "/tmp/weather-agent",
      info: INFO,
      theme,
      width: 120,
    });

    expect(lines).toEqual([" eve - Weather Agent - /tmp/weather-agent - :2000", previewLine]);
  });

  it("abbreviates a home-directory prefix to ~", () => {
    const lines = buildAgentHeader({
      name: "Inbound",
      serverUrl: "http://127.0.0.1:2000/",
      appRoot: join(homedir(), "wrk/eves/inbound"),
      theme,
      width: 120,
    });

    expect(lines).toEqual([" eve - Inbound - ~/wrk/eves/inbound - :2000", previewLine]);
  });

  it("shows the bare host for a remote session without a local directory", () => {
    // A remote `--url` session has no local dir, and resolveTuiTitle names it
    // after the host, so the host appears once rather than `<host> - <host>`.
    expect(
      buildAgentHeader({
        name: "example.com:8080",
        serverUrl: "https://example.com:8080/",
        theme,
        width: 120,
      }),
    ).toEqual([" eve - example.com:8080", previewLine]);
  });

  it("renders the tip line for local sessions only", () => {
    const tip = AGENT_HEADER_TIPS[0]!;
    const local = buildAgentHeader({
      name: "Weather Agent",
      serverUrl: "http://127.0.0.1:2000/",
      appRoot: "/tmp/weather-agent",
      info: INFO,
      theme,
      width: 120,
      tip,
    });
    expect(local).toEqual([
      " eve - Weather Agent - /tmp/weather-agent - :2000",
      previewLine,
      ` ${tip}`,
    ]);

    const remote = buildAgentHeader({
      name: "Weather Agent",
      serverUrl: "https://example.com/",
      info: INFO,
      theme,
      width: 120,
    });
    expect(remote.join("\n")).not.toContain("/channels");
  });

  it("keeps the preview URL visible and plain on a color terminal (no OSC 8 escape)", () => {
    const colorTheme = createTheme({ color: true, unicode: false });
    const lines = buildAgentHeader({
      name: "weather-agent",
      serverUrl: "http://127.0.0.1:2000/",
      appRoot: "/tmp/weather-agent",
      info: INFO,
      theme: colorTheme,
      width: 120,
    });
    const preview = lines.find((line) => line.includes("eve is currently in preview"))!;

    // The bare URL stays visible so the terminal's own URL matcher makes it
    // ⌘/ctrl-clickable. OSC 8 explicit hyperlinks are deliberately avoided —
    // their click handling is unreliable (e.g. Ghostty bug #11907).
    expect(preview).toContain(EVE_BETA_TERMS_URL);
    expect(preview).not.toContain("\x1b]8;;");
  });

  it("keeps the discovery-diagnostics line when the compiler reported problems", () => {
    const info: AgentInfoResult = {
      ...INFO,
      diagnostics: { discoveryErrors: 1, discoveryWarnings: 2 },
    };
    const lines = buildAgentHeader({
      name: "weather-agent",
      serverUrl: "http://127.0.0.1:2000/",
      appRoot: "/tmp/weather-agent",
      info,
      theme,
      width: 120,
    });

    expect(lines.some((line) => line.includes("1 error"))).toBe(true);
    expect(lines.some((line) => line.includes("2 warnings"))).toBe(true);
  });
});

describe("pickAgentHeaderTip", () => {
  it("maps the random draw across the whole pool", () => {
    expect(pickAgentHeaderTip(() => 0)).toBe(AGENT_HEADER_TIPS[0]);
    expect(pickAgentHeaderTip(() => 0.999)).toBe(AGENT_HEADER_TIPS.at(-1));
  });
});
