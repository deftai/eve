import { readDevelopmentRuntimeArtifactsRevision } from "#internal/nitro/dev-runtime-artifacts.js";
import { rebuildDevelopmentRuntimeArtifacts } from "#internal/nitro/host/dev-runtime-rebuild.js";

/**
 * Builds the dev-only runtime artifact revision response.
 *
 * Auth: none. The route is mounted only by the local dev server and exposes
 * only an opaque revision token that changes when HMR publishes a new runtime
 * snapshot.
 */
export function handleDevRuntimeArtifactsRequest(input: { appRoot: string }): Response {
  return Response.json(readDevelopmentRuntimeArtifactsRevision(input.appRoot), {
    headers: {
      "cache-control": "no-store",
    },
  });
}

/**
 * Flushes the live authored-source watcher before returning the revision that
 * a local TUI uses to rotate its session after setup writes a connection.
 */
export async function handleDevRuntimeArtifactsRebuildRequest(input: {
  appRoot: string;
}): Promise<Response> {
  const rebuilt = await rebuildDevelopmentRuntimeArtifacts(input.appRoot);
  if (!rebuilt) {
    return Response.json(
      { error: "Development runtime watcher is not ready." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
  return handleDevRuntimeArtifactsRequest(input);
}
