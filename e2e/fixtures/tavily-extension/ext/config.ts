import { defineConfig } from "eve/extension";

// tavily takes no consumer configuration; the empty handle still serves as the
// mount factory the consumer calls (`tavily()`).
export default defineConfig({});
