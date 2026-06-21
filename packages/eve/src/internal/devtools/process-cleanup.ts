import { rmSync } from "node:fs";

export interface DevToolsProcessCleanupHandle {
  close(): void;
}

export function registerDevToolsDiscoveryCleanup(
  discoveryPaths: readonly string[],
): DevToolsProcessCleanupHandle {
  const removeDiscovery = () => {
    for (const discoveryPath of discoveryPaths) rmSync(discoveryPath, { force: true });
  };

  process.once("exit", removeDiscovery);

  return {
    close() {
      process.off("exit", removeDiscovery);
    },
  };
}
