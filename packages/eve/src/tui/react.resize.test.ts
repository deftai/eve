import { describe, expect, it } from "vitest";

import { MockScreen, MockUserInput } from "../cli/dev/tui/test/mock-terminal.js";
import type { AgentTUIStreamEvent } from "../cli/dev/tui/runner.js";
import { ReactRenderer } from "./react-renderer.js";

async function* streamOf(events: AgentTUIStreamEvent[]): AsyncIterable<AgentTUIStreamEvent> {
  for (const event of events) yield event;
}

/** Widest non-blank painted row, in columns. */
function paintedWidth(snapshot: string): number {
  return Math.max(0, ...snapshot.split("\n").map((line) => line.replace(/\s+$/, "").length));
}

/**
 * Terminal resize must reflow the frame (review finding #4).
 *
 * Width was captured once at construction, so a resize left stale-width lines on
 * screen. The renderer now re-renders <Main> with the live width on the output's
 * "resize" event, and runtime reads the width live per commit. With the bug, the
 * resize triggers no repaint and the frame stays at the original width.
 */
describe("resize reflow (finding #4)", () => {
  it("repaints to the new width when the terminal resizes", async () => {
    const screen = new MockScreen({ columns: 40, rows: 20 });
    const renderer = new ReactRenderer({ input: new MockUserInput(), output: screen });
    await renderer.renderStream({
      events: streamOf([
        {
          type: "assistant-complete",
          id: "a",
          text: "alpha bravo charlie delta echo foxtrot golf",
        },
        { type: "finish" },
      ]),
    });

    // The chrome (header/status) fills the available width at 40 columns.
    expect(paintedWidth(screen.snapshot())).toBeGreaterThan(12);

    // Narrow the terminal; the renderer must repaint at the live width.
    screen.resize(12, 20);
    expect(paintedWidth(screen.snapshot())).toBeLessThanOrEqual(12);

    renderer.shutdown();
  });
});
