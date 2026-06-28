export function isVercelSandboxAlreadyExistsError(error: unknown): boolean {
  for (const candidate of walkErrorChain(error)) {
    const jsonError = readVercelJsonError(candidate);
    if (jsonError === undefined) {
      continue;
    }

    const code = jsonError.code;
    const message = jsonError.message;
    if (
      code === "bad_request" &&
      typeof message === "string" &&
      isSandboxAlreadyExistsMessage(message)
    ) {
      return true;
    }
  }

  return false;
}

export function isVercelSnapshotUnavailableError(error: unknown): boolean {
  for (const candidate of walkErrorChain(error)) {
    if (readErrorStatus(candidate) === 410) {
      return true;
    }
  }

  return false;
}

export function isVercelSandboxMissingError(error: unknown): boolean {
  for (const candidate of walkErrorChain(error)) {
    if (readErrorStatus(candidate) === 404) {
      return true;
    }
  }

  return false;
}

function* walkErrorChain(error: unknown): Generator<unknown> {
  let current = error;
  const seen = new Set<unknown>();
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = isRecord(current) ? current.cause : undefined;
  }
}

function readErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = error.response;
  if (isRecord(response) && typeof response.status === "number") {
    return response.status;
  }

  if (typeof error.status === "number") {
    return error.status;
  }

  if (typeof error.statusCode === "number") {
    return error.statusCode;
  }

  return undefined;
}

function readVercelJsonError(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const json = error.json;
  if (!isRecord(json)) {
    return undefined;
  }

  const jsonError = json.error;
  return isRecord(jsonError) ? jsonError : undefined;
}

function isSandboxAlreadyExistsMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("sandbox") && normalized.includes("already exists");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
