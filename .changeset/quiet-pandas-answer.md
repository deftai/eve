---
"eve": patch
---

Bind Slack human-in-the-loop prompts to the verified user who requested them. Answered cards show the selected response without exposing the responder's identity; other users receive a private rejection, stale prompts explain that they must be recreated, and sessions without a verified Slack actor show a visible diagnostic instead of hanging silently.
