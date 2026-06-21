import { describe, expect, it } from "vitest";

import { DevToolsApiError, type DevToolsClient } from "./devtools-client.js";
import {
  continueSessionAcrossInstances,
  createSessionAcrossInstances,
  inspectSessionAcrossInstances,
  listSessionsAcrossInstances,
  type DevToolsInstance,
} from "./instances.js";
import type { DevToolsDiscovery, DevToolsRun } from "./types.js";

describe("DevTools instances", () => {
  it("lists sessions across every active app", async () => {
    const first = instance("devtools-1", "/workspace/first", [run("session-1", "10")]);
    const second = instance("devtools-2", "/workspace/second", [run("session-2", "20")]);

    await expect(listSessionsAcrossInstances([first, second])).resolves.toEqual([
      expect.objectContaining({
        appRoot: "/workspace/second",
        devtoolsInstanceId: "devtools-2",
        sessionId: "session-2",
      }),
      expect.objectContaining({
        appRoot: "/workspace/first",
        devtoolsInstanceId: "devtools-1",
        sessionId: "session-1",
      }),
    ]);
  });

  it("finds the owning app from a copied session ID", async () => {
    const first = instance("devtools-1", "/workspace/first", [run("session-1", "10")]);
    const second = instance("devtools-2", "/workspace/second", [run("session-2", "20")]);

    await expect(inspectSessionAcrossInstances([first, second], "session-2")).resolves.toEqual(
      expect.objectContaining({
        devtools: expect.objectContaining({
          appRoot: "/workspace/second",
          devtoolsInstanceId: "devtools-2",
        }),
        run: expect.objectContaining({ sessionId: "session-2" }),
      }),
    );
  });

  it("creates on the sole active app and continues by session ID", async () => {
    const active = instance("devtools-1", "/workspace/first", [run("session-1", "10")]);

    await expect(createSessionAcrossInstances([active], "Hello")).resolves.toEqual(
      expect.objectContaining({ appRoot: "/workspace/first", sessionId: "created-session" }),
    );
    await expect(
      continueSessionAcrossInstances([active], "session-1", "Continue"),
    ).resolves.toEqual(
      expect.objectContaining({ appRoot: "/workspace/first", sessionId: "session-1" }),
    );
  });
});

function instance(
  devtoolsInstanceId: string,
  appRoot: string,
  runs: readonly DevToolsRun[],
): DevToolsInstance {
  const discovery: DevToolsDiscovery = {
    appRoot,
    browserCapability: "capability",
    devtoolsInstanceId,
    devtoolsUrl: "http://127.0.0.1:43123/",
    schemaVersion: 1,
  };
  const client: DevToolsClient = {
    async continueRun(sessionId) {
      return run(sessionId, "30");
    },
    async createRun() {
      return run("created-session", "30");
    },
    async getRun(sessionId) {
      const value = runs.find((candidate) => candidate.sessionId === sessionId);
      if (value === undefined) throw new DevToolsApiError(404, "Run not found");
      return value;
    },
    async getRunEvents() {
      return [];
    },
    async listLogs() {
      return [];
    },
    async listRuns() {
      return runs;
    },
    async listSources() {
      return [];
    },
  };
  return { client, discovery };
}

function run(sessionId: string, updatedAt: string): DevToolsRun {
  return {
    createdAt: updatedAt,
    eventCount: 0,
    retainedEventCount: 0,
    sessionId,
    status: "waiting",
    title: sessionId,
    updatedAt,
  };
}
