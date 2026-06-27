import { afterEach, describe, expect, it, vi } from "vitest";

import {
  rebuildDevelopmentRuntimeArtifacts,
  registerDevelopmentRuntimeRebuilder,
} from "#internal/nitro/host/dev-runtime-rebuild.js";

describe("development runtime rebuild registry", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("runs the registered watcher rebuild for the requested app root", async () => {
    const rebuild = vi.fn(async () => {});
    cleanups.push(registerDevelopmentRuntimeRebuilder({ appRoot: "/tmp/eve-agent", rebuild }));

    await expect(rebuildDevelopmentRuntimeArtifacts("/tmp/eve-agent")).resolves.toBe(true);
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("does not let an older watcher unregister its replacement", async () => {
    const firstRebuild = vi.fn(async () => {});
    const secondRebuild = vi.fn(async () => {});
    const unregisterFirst = registerDevelopmentRuntimeRebuilder({
      appRoot: "/tmp/eve-agent-replacement",
      rebuild: firstRebuild,
    });
    cleanups.push(unregisterFirst);
    cleanups.push(
      registerDevelopmentRuntimeRebuilder({
        appRoot: "/tmp/eve-agent-replacement",
        rebuild: secondRebuild,
      }),
    );

    unregisterFirst();
    await expect(rebuildDevelopmentRuntimeArtifacts("/tmp/eve-agent-replacement")).resolves.toBe(
      true,
    );

    expect(firstRebuild).not.toHaveBeenCalled();
    expect(secondRebuild).toHaveBeenCalledOnce();
  });
});
