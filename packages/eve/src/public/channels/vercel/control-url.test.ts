import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveControlUrl } from "#public/channels/vercel/control-url.js";

const wsPath = "/eve/v1/realtime-speech/ws";

function clearControlEnv() {
  delete process.env.EVE_REALTIME_CONTROL_URL;
  delete process.env.VERCEL_BRANCH_URL;
  delete process.env.VERCEL_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  delete process.env.VERCEL_DPBP;
}

// The dev shell may export VERCEL_DPBP; clear it so "no bypass" cases are
// deterministic regardless of ambient env.
beforeEach(clearControlEnv);
afterEach(clearControlEnv);

describe("resolveControlUrl", () => {
  it("honors an explicit override URL", () => {
    const url = resolveControlUrl({
      wsPath,
      request: new Request("https://app.example.com/eve/v1/realtime-speech/setup"),
      explicitUrl: "wss://tunnel.ngrok.app/eve/v1/realtime-speech/ws",
    });
    expect(url).toBe("wss://tunnel.ngrok.app/eve/v1/realtime-speech/ws");
  });

  it("derives a wss URL from the Vercel deployment host", () => {
    process.env.VERCEL_BRANCH_URL = "eve-preview.vercel.app";
    const url = resolveControlUrl({
      wsPath,
      request: new Request("https://internal/eve/v1/realtime-speech/setup"),
    });
    expect(url).toBe("wss://eve-preview.vercel.app/eve/v1/realtime-speech/ws");
  });

  it("appends the deploy-protection bypass secret as a query param", () => {
    process.env.VERCEL_URL = "eve-preview.vercel.app";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass123";
    const url = new URL(
      resolveControlUrl({
        wsPath,
        request: new Request("https://internal/eve/v1/realtime-speech/setup"),
      }),
    );
    expect(url.searchParams.get("x-vercel-protection-bypass")).toBe("bypass123");
  });

  it("falls back to VERCEL_DPBP for the bypass secret", () => {
    const url = new URL(
      resolveControlUrl({
        wsPath,
        request: new Request("https://internal/eve/v1/realtime-speech/setup"),
        explicitUrl: "wss://eve-preview.vercel.app/eve/v1/realtime-speech/ws",
        bypassSecret: "explicit-bypass",
      }),
    );
    expect(url.searchParams.get("x-vercel-protection-bypass")).toBe("explicit-bypass");
  });

  it("uses ws:// for localhost overrides", () => {
    const url = resolveControlUrl({
      wsPath,
      request: new Request("http://localhost:3000/eve/v1/realtime-speech/setup"),
      explicitUrl: "ws://localhost:3000/eve/v1/realtime-speech/ws",
    });
    expect(url).toBe("ws://localhost:3000/eve/v1/realtime-speech/ws");
  });
});
