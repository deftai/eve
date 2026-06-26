import { spawn, type ChildProcessByStdio } from "node:child_process";
import { join } from "node:path";
import type { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  EVE_DEV_RUNTIME_ARTIFACTS_REBUILD_ROUTE_PATH,
  EVE_HEALTH_ROUTE_PATH,
  EVE_INFO_ROUTE_PATH,
} from "../../src/protocol/routes.js";
import { Client } from "../../src/client/index.js";
import {
  EveTUIRunner,
  type AgentTUIRenderer,
  type PromptCommandOutcome,
} from "../../src/cli/dev/tui/runner.js";
import { runPnpmCommand } from "../../src/internal/testing/run-pnpm-command.js";
import { getCatalogEntry } from "../../src/setup/scaffold/connections/catalog.js";
import {
  ensureConnection,
  ensureConnectionDependencies,
} from "../../src/setup/scaffold/update/connections.js";
import { WEATHER_AGENT_DESCRIPTOR } from "../../src/internal/testing/scenario-apps/weather-agent.js";
import {
  type ScenarioAppDescriptor,
  useScenarioApp,
} from "../../src/internal/testing/scenario-app.js";
import { sendDevelopmentMessage } from "../dev-client-harness/send-message.js";
import { createDevelopmentSessionState } from "../dev-client-harness/session.js";

// Keep the dev TUI's glyph set deterministic across CI hosts so the
// screen assertions below remain stable.
process.env.EVE_TUI_UNICODE = "1";

const scenarioApp = useScenarioApp();
const DEV_SERVER_SCENARIO_TIMEOUT_MS = 360_000;
const DEV_SERVER_AGENT_DESCRIPTOR: ScenarioAppDescriptor = {
  ...WEATHER_AGENT_DESCRIPTOR,
  files: Object.fromEntries(
    Object.entries(WEATHER_AGENT_DESCRIPTOR.files).filter(
      ([path]) => !path.startsWith("agent/channels/"),
    ),
  ),
};

interface RunningEveDev {
  readonly stderr: () => string;
  readonly stdout: () => string;
  readonly url: string;
  stop(): Promise<void>;
}

function stripAnsi(text: string): string {
  return text
    .split("\u001b[")
    .map((segment, index) => {
      if (index === 0) {
        return segment;
      }

      return segment.replace(/^[0-9;]*m/, "");
    })
    .join("");
}

function hasUnsupportedWindowsEsmImport(text: string): boolean {
  return (
    text.includes("ERR_UNSUPPORTED_ESM_URL_SCHEME") ||
    text.includes("Received protocol 'g:'") ||
    text.includes('Received protocol "g:"')
  );
}

function hasKnownDevBundlingFailure(text: string): boolean {
  return (
    hasUnsupportedWindowsEsmImport(text) ||
    (text.includes("ERR_MODULE_NOT_FOUND") && text.includes("authored-module-map-loader"))
  );
}

function parseServerUrl(stdout: string): string | undefined {
  const match = /server listening at (https?:\/\/\S+)/.exec(stripAnsi(stdout));

  return match?.[1];
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForServerUrl(input: {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly getOutput: () => {
    readonly stderr: string;
    readonly stdout: string;
  };
}): Promise<string> {
  return await new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      settleReject(
        new Error(
          [
            "Timed out waiting for eve dev to print its server URL.",
            `stdout:\n${input.getOutput().stdout}`,
            `stderr:\n${input.getOutput().stderr}`,
          ].join("\n\n"),
        ),
      );
    }, 120_000);

    const cleanup = () => {
      clearTimeout(timeout);
      input.child.stdout.off("data", handleOutput);
      input.child.stderr.off("data", handleOutput);
      input.child.off("error", settleReject);
      input.child.off("exit", handleExit);
    };

    const settleResolve = (url: string) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(url);
    };

    function settleReject(error: unknown) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function handleOutput() {
      const output = input.getOutput();
      const combinedOutput = `${output.stdout}\n${output.stderr}`;

      if (hasKnownDevBundlingFailure(combinedOutput)) {
        settleReject(
          new Error(
            [
              "eve dev emitted a known generated dev bundle import failure.",
              `stdout:\n${output.stdout}`,
              `stderr:\n${output.stderr}`,
            ].join("\n\n"),
          ),
        );
        return;
      }

      const url = parseServerUrl(output.stdout);

      if (url !== undefined) {
        settleResolve(url);
      }
    }

    function handleExit(code: number | null, signal: NodeJS.Signals | null) {
      const output = input.getOutput();

      settleReject(
        new Error(
          [
            `eve dev exited before printing its server URL (code ${String(code)}, signal ${String(signal)}).`,
            `stdout:\n${output.stdout}`,
            `stderr:\n${output.stderr}`,
          ].join("\n\n"),
        ),
      );
    }

    input.child.stdout.on("data", handleOutput);
    input.child.stderr.on("data", handleOutput);
    input.child.once("error", settleReject);
    input.child.once("exit", handleExit);
    handleOutput();
  });
}

async function startEveDev(appRoot: string): Promise<RunningEveDev> {
  const eveBinPath = join(appRoot, "node_modules", "eve", "bin", "eve.js");
  const child = spawn(
    process.execPath,
    [eveBinPath, "dev", "--no-ui", "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        // Activate the deterministic mock-model adapter in the spawned dev
        // server so the streamed turn completes without model credentials.
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  let stdout = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const url = await waitForServerUrl({
    child,
    getOutput: () => ({
      stderr,
      stdout,
    }),
  });

  return {
    stderr: () => stderr,
    stdout: () => stdout,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 10_000);

        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.kill("SIGTERM");
      });
    },
    url,
  };
}

describe("eve dev server", () => {
  it(
    "boots the packaged development server and completes a streamed turn",
    async () => {
      const app = await scenarioApp(DEV_SERVER_AGENT_DESCRIPTOR);
      const server = await startEveDev(app.appRoot);

      try {
        const response = await fetch(new URL(EVE_HEALTH_ROUTE_PATH, server.url));
        const responseText = await response.text();

        expect(
          response.status,
          [
            `Expected ${EVE_HEALTH_ROUTE_PATH} to return 200.`,
            `response body:\n${responseText}`,
            `stdout:\n${server.stdout()}`,
            `stderr:\n${server.stderr()}`,
          ].join("\n\n"),
        ).toBe(200);
        expect(JSON.parse(responseText)).toMatchObject({
          ok: true,
          status: "ready",
        });

        let messageResult: Awaited<ReturnType<typeof sendDevelopmentMessage>>;
        try {
          messageResult = await sendDevelopmentMessage({
            message: "hello world",
            session: createDevelopmentSessionState(),
            serverUrl: server.url,
          });
        } catch (error) {
          throw new Error(
            [
              `Expected dev message route to complete without throwing: ${String(error)}`,
              `stdout:\n${server.stdout()}`,
              `stderr:\n${server.stderr()}`,
            ].join("\n\n"),
            { cause: error },
          );
        }

        expect(
          messageResult.events.some((event) => event.type === "message.completed"),
          [
            "Expected dev message route to complete a streamed turn.",
            `events:\n${JSON.stringify(messageResult.events, null, 2)}`,
            `stdout:\n${server.stdout()}`,
            `stderr:\n${server.stderr()}`,
          ].join("\n\n"),
        ).toBe(true);
        await wait(1_000);

        const output = `${server.stdout()}\n${server.stderr()}`;
        expect(hasKnownDevBundlingFailure(output)).toBe(false);
      } finally {
        await server.stop();
      }
    },
    DEV_SERVER_SCENARIO_TIMEOUT_MS,
  );

  it(
    "activates a newly installed Connect connection before the next request",
    async () => {
      const app = await scenarioApp(DEV_SERVER_AGENT_DESCRIPTOR);
      const server = await startEveDev(app.appRoot);
      const linear = getCatalogEntry("linear");
      if (linear === undefined) throw new Error("Expected the Linear connection catalog entry.");
      let restoreFetch: (() => void) | undefined;

      try {
        const originalFetch = globalThis.fetch;
        const requestedUrls: URL[] = [];
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input));
          requestedUrls.push(url);
          return await originalFetch(input, init);
        });
        restoreFetch = () => fetchSpy.mockRestore();
        const client = new Client({ host: server.url });
        const prompts: Array<string | undefined> = ["/connect", undefined];
        const renderer: AgentTUIRenderer = {
          readPrompt: async () => prompts.shift(),
          async renderStream(result) {
            for await (const _event of result.events) {
              // The setup command does not create a model stream in this test.
            }
          },
        };
        const connectOutcome: PromptCommandOutcome = {
          effect: { kind: "connection-added" },
          message: "Connections added: linear.",
        };
        const handle = vi.fn(async (): Promise<PromptCommandOutcome> => {
          await ensureConnectionDependencies({ projectRoot: app.appRoot });
          await runPnpmCommand({
            args: [
              "install",
              "--no-frozen-lockfile",
              "--prefer-offline",
              "--ignore-scripts",
              "--config.confirm-modules-purge=false",
              "--config.minimum-release-age=0",
            ],
            cwd: app.appRoot,
          });
          await ensureConnection({
            entry: {
              ...linear,
              description: "hmr-probe: connection-active",
            },
            projectRoot: app.appRoot,
            protocol: "mcp",
          });
          return connectOutcome;
        });
        const runner = new EveTUIRunner({
          client,
          promptCommandHandler: {
            handle,
          },
          renderer,
          serverUrl: server.url,
          session: client.session(),
        });

        await runner.run();
        expect(handle).toHaveBeenCalledTimes(1);
        expect(
          requestedUrls.some(
            (url) =>
              url.pathname === EVE_DEV_RUNTIME_ARTIFACTS_REBUILD_ROUTE_PATH &&
              url.searchParams.get("force") === "1",
          ),
        ).toBe(true);

        const info = await fetch(new URL(EVE_INFO_ROUTE_PATH, server.url));
        expect(info.status).toBe(200);
        const infoPayload = await info.json();
        expect(
          infoPayload,
          [`stdout:\n${server.stdout()}`, `stderr:\n${server.stderr()}`].join("\n\n"),
        ).toMatchObject({ connections: [expect.objectContaining({ connectionName: "linear" })] });

        const turn = await sendDevelopmentMessage({
          message: "hello",
          session: createDevelopmentSessionState(),
          serverUrl: server.url,
        });
        const completedMessage = turn.events.find(
          (event) => event.type === "message.completed" && event.data.message !== null,
        );
        expect(completedMessage).toMatchObject({
          data: { message: expect.stringContaining("probe=connection-active") },
        });
      } finally {
        restoreFetch?.();
        await server.stop();
      }
    },
    DEV_SERVER_SCENARIO_TIMEOUT_MS,
  );

  it(
    "activates a connection added outside the TUI without restarting eve dev",
    async () => {
      const app = await scenarioApp(DEV_SERVER_AGENT_DESCRIPTOR);
      const server = await startEveDev(app.appRoot);
      const linear = getCatalogEntry("linear");
      if (linear === undefined) throw new Error("Expected the Linear connection catalog entry.");

      try {
        await ensureConnectionDependencies({ projectRoot: app.appRoot });
        await runPnpmCommand({
          args: [
            "install",
            "--no-frozen-lockfile",
            "--prefer-offline",
            "--ignore-scripts",
            "--config.confirm-modules-purge=false",
            "--config.minimum-release-age=0",
          ],
          cwd: app.appRoot,
        });
        await ensureConnection({
          entry: {
            ...linear,
            description: "hmr-probe: watcher-active",
          },
          projectRoot: app.appRoot,
          protocol: "mcp",
        });

        await vi.waitFor(
          async () => {
            const info = await fetch(new URL(EVE_INFO_ROUTE_PATH, server.url));

            expect(info.status).toBe(200);
            expect(await info.json()).toMatchObject({
              connections: [expect.objectContaining({ connectionName: "linear" })],
            });
          },
          { interval: 100, timeout: 20_000 },
        );

        const turn = await sendDevelopmentMessage({
          message: "hello",
          session: createDevelopmentSessionState(),
          serverUrl: server.url,
        });
        const completedMessage = turn.events.find(
          (event) => event.type === "message.completed" && event.data.message !== null,
        );
        expect(completedMessage).toMatchObject({
          data: { message: expect.stringContaining("probe=watcher-active") },
        });
      } finally {
        await server.stop();
      }
    },
    DEV_SERVER_SCENARIO_TIMEOUT_MS,
  );
});
