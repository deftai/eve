import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

export const SIGNING_SECRET = "scenario-signing-secret";
export const CHANNEL_ID = "C_SCENARIO";
export const TEAM_ID = "T_SCENARIO";
export const THREAD_TS = "1700000000.000001";
export const USER_A = "U_OWNER_A";
export const USER_B = "U_OWNER_B";

const SLACK_ROUTE_PATH = "/eve/v1/slack";

export interface RunningEveDev {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly output: () => string;
  readonly url: string;
  stop(): Promise<void>;
}

export interface RecordedSlackCall {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly responseTs: string;
  readonly url: string;
}

export interface HitlCard {
  readonly actionId: string;
  readonly blockId: string;
  readonly blocks: readonly unknown[];
  readonly callIndex: number;
  readonly label: string;
  readonly responseTs: string;
  readonly value: string;
}

export async function startEveDev(input: {
  readonly appRoot: string;
  readonly callsPath: string;
  readonly executionsPath: string;
}): Promise<RunningEveDev> {
  const eveBinPath = join(input.appRoot, "node_modules", "eve", "bin", "eve.js");
  const preloadUrl = pathToFileURL(join(input.appRoot, "slack-fetch-preload.mjs")).href;
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${preloadUrl}`]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
  const child = spawn(
    process.execPath,
    [eveBinPath, "dev", "--no-ui", "--host", "127.0.0.1", "--port", "0"],
    {
      cwd: input.appRoot,
      env: {
        ...process.env,
        EVE_SLACK_CALLS_PATH: input.callsPath,
        EVE_SLACK_TOOL_EXECUTIONS_PATH: input.executionsPath,
        NODE_ENV: "test",
        NODE_OPTIONS: nodeOptions,
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

  const url = await waitForValue({
    description: "eve dev to print its server URL",
    load: async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`eve dev exited before startup.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
      }
      return /server listening at (https?:\/\/\S+)/u.exec(stripAnsi(stdout))?.[1] ?? null;
    },
    output: () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
    timeoutMs: 120_000,
  });

  return {
    child,
    output: () => `stdout:\n${stdout}\nstderr:\n${stderr}`,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const gracefulExit = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([gracefulExit, delay(10_000)]);
      if (child.exitCode === null && child.signalCode === null) {
        const forcedExit = once(child, "exit");
        child.kill("SIGKILL");
        await forcedExit;
      }
    },
    url,
  };
}

export async function postSignedSlackBody(input: {
  readonly body: string;
  readonly contentType?: string;
  readonly serverUrl: string;
  readonly signingSecret?: string;
}): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `v0=${createHmac("sha256", input.signingSecret ?? SIGNING_SECRET)
    .update(`v0:${timestamp}:${input.body}`)
    .digest("hex")}`;
  return await fetch(new URL(SLACK_ROUTE_PATH, input.serverUrl), {
    body: input.body,
    headers: {
      "content-type": input.contentType ?? "application/json",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
    },
    method: "POST",
  });
}

export function buildMentionBody(input: {
  readonly eventId: string;
  readonly text: string;
  readonly ts: string;
  readonly userId: string;
}): string {
  return JSON.stringify({
    event: {
      channel: CHANNEL_ID,
      event_ts: input.ts,
      text: input.text,
      thread_ts: THREAD_TS,
      ts: input.ts,
      type: "app_mention",
      user: input.userId,
    },
    event_id: input.eventId,
    team_id: TEAM_ID,
    type: "event_callback",
  });
}

export function buildInteractionBody(input: {
  readonly card: HitlCard;
  readonly userId: string;
}): string {
  return new URLSearchParams({
    payload: JSON.stringify({
      actions: [
        {
          action_id: input.card.actionId,
          block_id: input.card.blockId,
          text: { text: input.card.label, type: "plain_text" },
          value: input.card.value,
        },
      ],
      channel: { id: CHANNEL_ID },
      message: {
        blocks: input.card.blocks,
        thread_ts: THREAD_TS,
        ts: input.card.responseTs,
      },
      team: { id: TEAM_ID },
      type: "block_actions",
      user: { id: input.userId, team_id: TEAM_ID },
    }),
  }).toString();
}

export async function readSlackCalls(path: string): Promise<RecordedSlackCall[]> {
  const source = await readFile(path, "utf8");
  return source
    .split("\n")
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      return isRecordedSlackCall(parsed) ? [parsed] : [];
    });
}

export function findHitlCard(
  calls: readonly RecordedSlackCall[],
  startIndex: number,
): HitlCard | null {
  for (let index = startIndex; index < calls.length; index += 1) {
    const call = calls[index];
    if (call === undefined) continue;
    const card = parseHitlCard(call, index);
    if (card !== null) return card;
  }
  return null;
}

export function parseHitlCard(call: RecordedSlackCall, callIndex: number): HitlCard | null {
  if (operationOf(call) !== "chat.postMessage") return null;
  const blocksSource = readFormField(call.body, "blocks");
  if (blocksSource === null) return null;
  const blocks: unknown = JSON.parse(blocksSource);
  if (!Array.isArray(blocks)) return null;

  for (const block of blocks) {
    if (!isRecord(block) || !Array.isArray(block.elements) || typeof block.block_id !== "string") {
      continue;
    }
    for (const element of block.elements) {
      if (
        !isRecord(element) ||
        typeof element.action_id !== "string" ||
        !element.action_id.startsWith("eve_input:") ||
        typeof element.value !== "string"
      ) {
        continue;
      }
      const label =
        isRecord(element.text) && typeof element.text.text === "string"
          ? element.text.text
          : element.value;
      return {
        actionId: element.action_id,
        blockId: block.block_id,
        blocks,
        callIndex,
        label,
        responseTs: call.responseTs,
        value: element.value,
      };
    }
  }
  return null;
}

export function findSlackCall(
  calls: readonly RecordedSlackCall[],
  startIndex: number,
  select: (call: RecordedSlackCall) => RecordedSlackCall | null,
): RecordedSlackCall | null {
  for (const call of calls.slice(startIndex)) {
    const selected = select(call);
    if (selected !== null) return selected;
  }
  return null;
}

export function operationOf(call: RecordedSlackCall): string {
  return new URL(call.url).pathname.slice("/api/".length);
}

export function readFormField(body: string, field: string): string | null {
  return new URLSearchParams(body).get(field);
}

export async function readExecutionNotes(path: string): Promise<string[]> {
  const source = await readFile(path, "utf8");
  return source
    .split("\n")
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      return isRecord(parsed) && typeof parsed.note === "string" ? [parsed.note] : [];
    });
}

export async function readSessionRunIds(appRoot: string): Promise<string[]> {
  const runsRoot = join(appRoot, ".workflow-data", "runs");
  let entries: string[];
  try {
    entries = await readdir(runsRoot);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }

  const runIds = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry): Promise<string | null> => {
        const parsed: unknown = JSON.parse(await readFile(join(runsRoot, entry), "utf8"));
        return isRecord(parsed) &&
          parsed.workflowName === "workflow//eve//workflowEntry" &&
          typeof parsed.runId === "string"
          ? parsed.runId
          : null;
      }),
  );
  return runIds.filter((runId): runId is string => runId !== null).sort();
}

export async function waitForValue<T>(input: {
  readonly description: string;
  readonly load: () => Promise<T | null>;
  readonly output?: () => string;
  readonly server?: RunningEveDev;
  readonly timeoutMs?: number;
}): Promise<T> {
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await input.load();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    if (
      input.server !== undefined &&
      (input.server.child.exitCode !== null || input.server.child.signalCode !== null)
    ) {
      throw new Error(
        `eve dev exited while waiting for ${input.description}.\n${input.server.output()}`,
      );
    }
    await delay(50);
  }
  const output = input.server?.output() ?? input.output?.() ?? "";
  throw new Error(
    `Timed out waiting for ${input.description}.${
      lastError === undefined ? "" : ` Last error: ${String(lastError)}.`
    }${output.length === 0 ? "" : `\n${output}`}`,
  );
}

function isRecordedSlackCall(value: unknown): value is RecordedSlackCall {
  if (!isRecord(value) || !isStringRecord(value.headers)) return false;
  return (
    typeof value.body === "string" &&
    typeof value.method === "string" &&
    typeof value.responseTs === "string" &&
    typeof value.url === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function stripAnsi(text: string): string {
  return text
    .split("\u001b[")
    .map((segment, index) => (index === 0 ? segment : segment.replace(/^[0-9;]*m/u, "")))
    .join("");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
