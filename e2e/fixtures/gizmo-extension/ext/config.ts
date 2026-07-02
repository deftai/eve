import { defineConfig } from "eve/extension";

// gizmo takes no consumer configuration; the empty handle still serves as the
// mount factory the consumer calls (`gizmo()`).
export default defineConfig({});
