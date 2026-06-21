---
"eve": patch
---

Running `eve dev` interactively now reconnects the TUI to a healthy dev server already running for the same app root instead of starting a duplicate; a headless `eve dev` prints that server's URL and exits. The TUI brand line now identifies the session's server (`eve · <name> · <dir> · :<port>`, or the host for a remote `--url`). An explicit `--host`, `--port`, or `PORT` binds exactly that endpoint and reports `EADDRINUSE` if the port is taken. The server's URL and process ID are recorded in `.eve/dev-server.json` purely as a reconnect hint — there is no cross-process lock.
