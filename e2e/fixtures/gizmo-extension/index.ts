// Stand-in for the mount default `eve build` generates at dist/index.mjs.
// gizmo takes no consumer config, so there is no ext/config.ts and nothing to
// bind — the default export is just a mounted-extension marker. This fixture
// exports source directly and skips the build, so it ships this by hand (as
// .ts so the consumer's mount re-export resolves a declared type).
export default { [Symbol.for("eve.mounted-extension")]: true };
