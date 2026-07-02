// Overrides the mounted toolkit budget by re-exporting the extension's own tool
// through a consumer file. This is the documented override pattern (import the
// base from the extension, then re-declare) — and it is the case that regressed
// under the old runtime scoping: importing an extension module from a consumer
// file evaluates that module inside the consumer's bundle, where earlier scoping
// (an ambient global set only around extension module loads) never applied, so
// `defineState("budget")` lost its extension prefix and collided with tavily's
// identically-named state. The scope is now baked into the bundle at build time,
// so this eager consumer-side import keeps the extension's namespace and the
// state-isolation eval stays green.
export { default } from "toolkit-extension/tools/toolkit_budget";
