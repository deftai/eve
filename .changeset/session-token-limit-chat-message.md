---
"eve": patch
---

Sessions that reach their configured token limit now emit one final chat message ("The session reached its configured input token limit. Start a new session to continue.") before the failure cascade, so conversations no longer end silently on surfaces that only render messages.
