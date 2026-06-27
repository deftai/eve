---
"eve": patch
---

Fix Vercel Connect local interactive connection authorization when the dev server uses an IPv4 or IPv6 loopback address. OAuth callbacks now retain the active port while using the `localhost` hostname accepted by Connect, and local `/connect` refreshes the dev runtime before the next prompt can use the new connection.
