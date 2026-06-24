---
"eve": patch
---

Fix new project name field restoring default after user clears it. The editable row now treats the default name as a true placeholder: the field starts empty with the cursor at position 0, so deleting all text no longer causes the default to bounce back on re-focus.
