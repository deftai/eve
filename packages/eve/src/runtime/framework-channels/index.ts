import { readVercelProjectLink } from "#internal/vercel/project-link.js";
import {
  extractBearerToken,
  isLoopbackRequest,
  localDev,
  vercelOidc,
  type AuthFn,
} from "#public/channels/auth.js";
import { eveChannel } from "#public/channels/eve.js";
import type { CompiledChannel } from "#channel/compiled-channel.js";
import { isHttpRouteDefinition } from "#channel/routes.js";
import {
  getConnectionCallbackChannelDefinitions,
  getConnectionCallbackChannelNames,
} from "#runtime/connections/callback-route.js";
import {
  getSessionCallbackChannelDefinitions,
  getSessionCallbackChannelNames,
} from "#runtime/session-callback-route.js";
import type { ResolvedChannelDefinition } from "#runtime/types.js";

const EVE_CHANNEL_NAME = "eve";

/**
 * Framework default for the eve channel. When the runtime knows the app root,
 * local development binds an incoming Vercel OIDC token to that directory's
 * current Vercel project link before falling back to unauthenticated loopback.
 */
export function getFrameworkChannelDefinitions(
  input: { readonly appRoot?: string } = {},
): readonly ResolvedChannelDefinition[] {
  const compiled = eveChannel({
    auth: [createFrameworkVercelOidc(input.appRoot), localDev()],
  }) as CompiledChannel;

  const result: ResolvedChannelDefinition[] = [];

  for (const route of compiled.routes) {
    if (!isHttpRouteDefinition(route)) {
      continue;
    }
    result.push({
      name: EVE_CHANNEL_NAME,
      method: route.method.toUpperCase() as "GET" | "POST",
      urlPath: route.path,
      fetch: async (req: Request, ctx: any) => route.handler(req, ctx),
      handler: route.handler,
      adapter: compiled.adapter,
      logicalPath: `framework://channels/${route.path}`,
      sourceId: `eve:framework:${route.method.toLowerCase()}-${route.path}`,
      sourceKind: "module",
    });
  }

  result.push(
    ...getConnectionCallbackChannelDefinitions(),
    ...getSessionCallbackChannelDefinitions(),
  );

  return result;
}

function createFrameworkVercelOidc(appRoot: string | undefined): AuthFn<Request> {
  const defaultVercelOidc = vercelOidc();
  if (appRoot === undefined) return defaultVercelOidc;

  return async (request) => {
    if (!isLocalDevelopmentRequest(request)) return await defaultVercelOidc(request);
    if (extractBearerToken(request.headers.get("authorization")) === null) return null;

    const link = await readVercelProjectLink(appRoot);
    if (link === undefined) return await defaultVercelOidc(request);

    const auth = await vercelOidc({
      currentVercelProject: {
        environment: "development",
        projectId: link.projectId,
      },
    })(request);
    return auth?.principalType === "user" ? auth : null;
  };
}

function isLocalDevelopmentRequest(request: Request): boolean {
  if (process.env.VERCEL_ENV === "development") return true;
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    return false;
  }
  return isLoopbackRequest(request);
}

export function getAllFrameworkChannelNames(): ReadonlySet<string> {
  return new Set([
    EVE_CHANNEL_NAME,
    ...getConnectionCallbackChannelNames(),
    ...getSessionCallbackChannelNames(),
  ]);
}
