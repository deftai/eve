const WORKFLOW_RUNTIME_API_ERROR =
  "Workflow runtime APIs can only be called from outside a workflow driver bundle.";

/**
 * Workflow driver bundles must not inline `@workflow/core/runtime` because it
 * pulls Node.js builtins into the neutral VM graph. This shim satisfies static
 * imports during rolldown; the emitted bundle rewrites specifiers to the real
 * `workflow/runtime` module before execution.
 */
function workflowRuntimeApi(name: string): never {
  throw new Error(`\`${name}()\` ${WORKFLOW_RUNTIME_API_ERROR}`);
}

export function getRun(): never {
  workflowRuntimeApi("getRun");
}

export function getWorld(): never {
  workflowRuntimeApi("getWorld");
}

export function resumeHook(): never {
  workflowRuntimeApi("resumeHook");
}

export function setWorld(): never {
  workflowRuntimeApi("setWorld");
}

export function start(): never {
  workflowRuntimeApi("start");
}
