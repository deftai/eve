import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LEGACY_EVE_WORKFLOW_QUEUE_NAMESPACE,
  WORKFLOW_QUEUE_NAMESPACE_ENV,
} from "#internal/workflow/queue-namespace.js";
import { resumeHook } from "#internal/workflow/runtime.js";

const getWorldMock = vi.fn();
const healthCheckMock = vi.fn();
const queueMock = vi.fn();
const resumeHookMock = vi.fn();
const setWorldMock = vi.fn();

vi.mock("#compiled/@workflow/core/runtime.js", () => ({
  getWorld: (...args: unknown[]) => getWorldMock(...args),
  healthCheck: (...args: unknown[]) => healthCheckMock(...args),
  resumeHook: (...args: unknown[]) => resumeHookMock(...args),
  setWorld: (...args: unknown[]) => setWorldMock(...args),
}));

afterEach(() => {
  getWorldMock.mockReset();
  healthCheckMock.mockReset();
  queueMock.mockReset();
  resumeHookMock.mockReset();
  setWorldMock.mockReset();
  vi.unstubAllEnvs();
});

describe("workflow runtime resumeHook", () => {
  const hook = {
    createdAt: new Date(),
    environment: "production",
    hookId: "hook_session",
    ownerId: "team_test",
    projectId: "project_test",
    runId: "wrun_session",
    token: "slack:C1:T1",
  };

  function mockWorld(run: {
    readonly deploymentId: string;
    readonly executionContext?: Record<string, unknown>;
    readonly runId?: string;
    readonly specVersion?: number;
    readonly workflowName?: string;
  }) {
    getWorldMock.mockResolvedValue({
      queue: queueMock,
      runs: {
        get: vi.fn().mockResolvedValue({
          createdAt: new Date(),
          deploymentId: run.deploymentId,
          executionContext: run.executionContext,
          runId: run.runId ?? hook.runId,
          specVersion: run.specVersion,
          status: "running",
          updatedAt: new Date(),
          workflowName: run.workflowName ?? "workflowEntry",
        }),
      },
    });
  }

  it("does not probe or fan out when the active namespace is legacy", async () => {
    vi.stubEnv(WORKFLOW_QUEUE_NAMESPACE_ENV, LEGACY_EVE_WORKFLOW_QUEUE_NAMESPACE);
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_current");
    resumeHookMock.mockResolvedValue(hook);

    await expect(resumeHook(hook.token, { kind: "deliver" })).resolves.toEqual(hook);

    expect(resumeHookMock).toHaveBeenCalledWith(hook.token, { kind: "deliver" });
    expect(getWorldMock).not.toHaveBeenCalled();
    expect(queueMock).not.toHaveBeenCalled();
  });

  it("does not fan out for hooks owned by the current deployment", async () => {
    vi.stubEnv(WORKFLOW_QUEUE_NAMESPACE_ENV, "eve6167656e74");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_current");
    resumeHookMock.mockResolvedValue(hook);
    mockWorld({ deploymentId: "dpl_current" });

    await resumeHook(hook.token, { kind: "deliver" });

    expect(healthCheckMock).not.toHaveBeenCalled();
    expect(queueMock).not.toHaveBeenCalled();
  });

  it("does not fan out when the target deployment responds on the current namespace", async () => {
    vi.stubEnv(WORKFLOW_QUEUE_NAMESPACE_ENV, "eve6167656e74");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_current");
    resumeHookMock.mockResolvedValue(hook);
    healthCheckMock.mockResolvedValue({ healthy: true });
    mockWorld({ deploymentId: "dpl_previous" });

    await resumeHook(hook.token, { kind: "deliver" });

    expect(healthCheckMock).toHaveBeenCalledWith(expect.anything(), "workflow", {
      deploymentId: "dpl_previous",
      namespace: "eve6167656e74",
      timeout: 1_000,
    });
    expect(queueMock).not.toHaveBeenCalled();
  });

  it("queues a legacy wake-up for old deployments that do not consume the current namespace", async () => {
    vi.stubEnv(WORKFLOW_QUEUE_NAMESPACE_ENV, "eve6167656e74");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_current");
    resumeHookMock.mockResolvedValue(hook);
    healthCheckMock.mockResolvedValue({ healthy: false });
    mockWorld({
      deploymentId: "dpl_legacy",
      executionContext: { traceCarrier: { traceparent: "00-test" } },
      specVersion: 4,
    });

    await resumeHook(hook.token, { kind: "deliver" });

    expect(queueMock).toHaveBeenCalledWith(
      "__eve_wkf_workflow_workflowEntry",
      {
        runId: hook.runId,
        traceCarrier: { traceparent: "00-test" },
      },
      {
        deploymentId: "dpl_legacy",
        specVersion: 4,
      },
    );
  });
});
