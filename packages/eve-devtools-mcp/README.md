# Eve DevTools MCP prototype

This experimental stdio MCP server lets a coding agent inspect the same local DevTools API as
the browser UI. Its first tools are:

- `create_session` — send the first message to a running agent, including verification prompts
  after a fix.
- `continue_session` — send another message to a waiting session.
- `list_sessions` — discover runs retained by the current `eve dev` process.
- `inspect_session` — correlate a session's failed actions, runtime events, console logs, and
  authored source locations.

Build the package, start `eve dev` for one or more agents, then configure an MCP client to launch:

```sh
node /path/to/eve/packages/eve-devtools-mcp/dist/src/index.js
```

The server discovers active supervisors from `~/.eve/devtools/instances`, regardless of its current
working directory. It health-checks entries and removes stale process artifacts. `list_sessions`
aggregates sessions from every running agent, while `inspect_session` finds the owning agent from
the session ID. `--app-root` or `EVE_DEVTOOLS_APP_ROOT` remains available as an explicit override.
Capabilities stay in owner-readable discovery files and are not returned through MCP tools.

For the weather fixture in this repository, an MCP client configuration can use:

```json
{
  "mcpServers": {
    "eve-devtools": {
      "command": "node",
      "args": ["/path/to/eve/packages/eve-devtools-mcp/dist/src/index.js"]
    }
  }
}
```
