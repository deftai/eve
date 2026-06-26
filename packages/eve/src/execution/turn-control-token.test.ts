import { describe, expect, it } from "vitest";

import { createTurnControlToken, createTurnInboxToken } from "#execution/turn-control-token.js";

describe("turn control tokens", () => {
  it("derives the initial child turn inbox from its session id", () => {
    const controlToken = createTurnControlToken("child-session", 0);

    expect(controlToken).toBe("child-session:turn-control:0");
    expect(createTurnInboxToken(controlToken)).toBe("child-session:turn-control:0:inbox");
  });
});
