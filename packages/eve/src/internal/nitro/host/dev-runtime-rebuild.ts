import { resolve } from "node:path";

type DevelopmentRuntimeRebuilder = () => Promise<void>;

const rebuilders = new Map<string, DevelopmentRuntimeRebuilder>();

function appRootKey(appRoot: string): string {
  return resolve(appRoot);
}

/**
 * Makes one dev server's authored-source watcher available to its local
 * runtime-artifact rebuild route. The returned cleanup cannot unregister a
 * newer watcher for the same application root.
 */
export function registerDevelopmentRuntimeRebuilder(input: {
  readonly appRoot: string;
  readonly rebuild: DevelopmentRuntimeRebuilder;
}): () => void {
  const key = appRootKey(input.appRoot);
  rebuilders.set(key, input.rebuild);

  return () => {
    if (rebuilders.get(key) === input.rebuild) {
      rebuilders.delete(key);
    }
  };
}

/**
 * Forces the live authored-source watcher to publish a fresh snapshot for the
 * requested local application. Returns false before that watcher is ready.
 */
export async function rebuildDevelopmentRuntimeArtifacts(appRoot: string): Promise<boolean> {
  const rebuild = rebuilders.get(appRootKey(appRoot));
  if (rebuild === undefined) return false;
  await rebuild();
  return true;
}
