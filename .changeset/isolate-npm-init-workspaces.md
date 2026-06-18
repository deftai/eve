---
"eve": patch
---

`eve init` now isolates npm installs and dev handoff commands from ancestor workspaces, preventing npm from walking Bun-owned parent dependency trees during fresh scaffolds.
