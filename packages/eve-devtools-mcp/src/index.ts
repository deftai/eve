#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createDevToolsInstanceResolver } from "./instances.js";
import { createEveDevToolsMcpServer } from "./server.js";

const appRoot = readAppRoot(process.argv.slice(2)) ?? process.env.EVE_DEVTOOLS_APP_ROOT;
const server = createEveDevToolsMcpServer(createDevToolsInstanceResolver({ appRoot }));
await server.connect(new StdioServerTransport());

function readAppRoot(arguments_: readonly string[]): string | undefined {
  const index = arguments_.indexOf("--app-root");
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("Expected a directory after --app-root.");
  }
  return value;
}
