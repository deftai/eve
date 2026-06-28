---
"eve": minor
---

Remove the experimental `ExperimentalWorkflow` opt-in marker from the public `eve/tools` API and remove the dynamic Workflow docs. The internal runtime path remains in place for existing compiled manifests, but authored apps can no longer enable the tool through the public API.
