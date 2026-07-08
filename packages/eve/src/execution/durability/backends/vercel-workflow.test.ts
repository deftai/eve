import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createVercelDurabilityPort,
  VERCEL_DURABILITY_BACKEND_NAME,
} from "#execution/durability/backends/vercel-workflow.js";
import { createInMemoryDurabilityBackend } from "#execution/durability/backends/in-memory.js";

const createHookMock = vi.fn();
const resumeHookMock = vi.fn();

vi.mock("#compiled/@workflow/core/index.js", () => ({
  createHook: (...args: unknown[]) => createHookMock(...args),
}));

vi.mock("#internal/workflow/runtime.js", () => ({
  resumeHook: (...args: unknown[]) => resumeHookMock(...args),
}));

describe("createVercelDurabilityPort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes full Vercel workflow capabilities", () => {
    const port = createVercelDurabilityPort({ sessionId: "sess-1" });
    expect(port.capabilities).toMatchObject({
      checkpoints: true,
      childTurns: true,
      crossDeployChildRouting: true,
      eventStream: true,
      inboxes: true,
      scheduleTriggers: false,
    });
  });

  it("wraps createHook for inbox creation", () => {
    const hook = createMockHook();
    createHookMock.mockReturnValueOnce(hook);

    const port = createVercelDurabilityPort({ sessionId: "sess-1" });
    const inbox = port.createInbox({ sessionId: "sess-1", token: "delivery-token" });

    expect(createHookMock).toHaveBeenCalledWith({ token: "delivery-token" });
    expect(inbox.token).toBe("delivery-token");
  });

  it("passes checkpoint callbacks through on the Vercel path", async () => {
    const port = createVercelDurabilityPort({ sessionId: "sess-1" });
    const fn = vi.fn(async () => "value");

    await expect(port.checkpoint({ fn, name: "step", sessionId: "sess-1" })).resolves.toBe("value");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("rejects readEventStream — owned by workflow runtime", () => {
    const port = createVercelDurabilityPort({ sessionId: "sess-1" });
    expect(() => port.readEventStream("sess-1")).toThrow(/workflow-runtime/);
  });
});

describe("createVercelDurabilityBackend", () => {
  it("exposes the stable backend name", async () => {
    const { createVercelDurabilityBackend } =
      await import("#execution/durability/backends/vercel-workflow.js");
    expect(createVercelDurabilityBackend().name).toBe(VERCEL_DURABILITY_BACKEND_NAME);
  });

  it("returns a live binding with port and shutdown", async () => {
    const { createVercelDurabilityBackend } =
      await import("#execution/durability/backends/vercel-workflow.js");
    const binding = await createVercelDurabilityBackend().createBinding({
      runtimeContext: { appRoot: "/tmp" },
    });
    expect(binding.port.capabilities.inboxes).toBe(true);
    await expect(binding.shutdown()).resolves.toBeUndefined();
  });
});

describe("in-memory vs vercel port parity (inbox claim)", () => {
  it("both reject conflicting inbox owners", async () => {
    const inMemoryBinding = await createInMemoryDurabilityBackend().createBinding({
      runtimeContext: { appRoot: "/tmp" },
    });
    const inMemoryPort = inMemoryBinding.port;
    await inMemoryPort.startSession({ sessionId: "owner" });
    await inMemoryPort.startSession({ sessionId: "intruder" });

    const memoryInbox = inMemoryPort.createInbox({ sessionId: "owner", token: "shared" });
    await memoryInbox.claim("owner");
    const memoryConflict = inMemoryPort.createInbox({ sessionId: "intruder", token: "shared" });
    await expect(memoryConflict.claim("intruder")).rejects.toMatchObject({
      name: "HookConflictError",
    });

    const hook = createMockHook({ conflict: { runId: "wrun_owner" }, token: "vercel-token" });
    createHookMock.mockReturnValueOnce(hook);
    const vercelPort = createVercelDurabilityPort({ sessionId: "sess" });
    const vercelInbox = vercelPort.createInbox({ sessionId: "sess", token: "vercel-token" });
    await expect(vercelInbox.claim("sess")).rejects.toMatchObject({
      name: "HookConflictError",
      token: "vercel-token",
    });

    await inMemoryBinding.shutdown();
  });
});

function createMockHook(options?: {
  readonly conflict?: { readonly runId: string };
  readonly token?: string;
}) {
  const token = options?.token ?? "delivery-token";
  return {
    dispose: vi.fn(),
    getConflict: vi.fn(async () => options?.conflict ?? null),
    token,
    [Symbol.asyncIterator]: () => ({
      next: vi.fn(async () => ({ done: true, value: undefined })),
      return: vi.fn(async () => ({ done: true, value: undefined })),
    }),
  };
}
