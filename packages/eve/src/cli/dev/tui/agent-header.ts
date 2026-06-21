/**
 * Builds the startup header the dev TUI commits to scrollback before the
 * first prompt: one `eve · <name> · <dir> · :<port>` brand line identifying
 * the session and the dev server it is attached to, a preview-terms line, a
 * discovery-diagnostics line when the compiler reported problems, and a
 * rotating tip for local sessions. The resolved model is not repeated here —
 * it lives on the persistent status line at the bottom.
 */

import { homedir } from "node:os";
import { sep } from "node:path";

import type { AgentInfoResult } from "#client/index.js";
import { EVE_BETA_TERMS_URL } from "#cli/banner.js";
import type { Theme } from "./theme.js";
import { truncate } from "./tool-format.js";

export interface AgentHeaderInput {
  /** Resolved display name, including an explicit `--name` when provided. */
  name: string;
  /** URL of the dev server this session is attached to. */
  serverUrl: string;
  /** Local project root, or `undefined` when attached to a remote `--url`. */
  appRoot?: string;
  /** Agent inspection payload, or `undefined` when it could not be fetched. */
  info?: AgentInfoResult;
  theme: Theme;
  /** Available terminal width. */
  width: number;
  /** Message-of-the-day line rendered under the brand line, when present. */
  tip?: string;
}

/** Collapses a leading home-directory prefix to `~` for a shorter path. */
function abbreviateHome(path: string): string {
  const home = homedir();
  if (home.length > 0 && (path === home || path.startsWith(`${home}${sep}`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/**
 * The dimmed identity that follows the `eve` brand: `<dir> · :<port>` for a
 * local session, or the bare host when attached to a remote URL. Returns
 * `undefined` only when the server URL cannot be parsed and there is no local
 * directory to fall back to.
 */
function buildHeaderIdentity(input: {
  serverUrl: string;
  appRoot: string | undefined;
  dot: string;
}): string | undefined {
  let url: URL | undefined;
  try {
    url = new URL(input.serverUrl);
  } catch {
    url = undefined;
  }

  if (input.appRoot !== undefined) {
    const dir = abbreviateHome(input.appRoot);
    return url?.port ? `${dir} ${input.dot} :${url.port}` : dir;
  }

  return url?.host;
}

/**
 * The header's message-of-the-day pool. All entries reference local-only
 * slash commands, so callers only attach a tip to local `eve dev` sessions.
 */
export const AGENT_HEADER_TIPS: readonly string[] = [
  "Use /channels to add more ways to reach your agent.",
  "Use /deploy to see your agent go live.",
  "Type /help to see every command.",
];

/** Picks one tip; `random` is a test seam over Math.random. */
export function pickAgentHeaderTip(random: () => number = Math.random): string {
  const index = Math.min(
    AGENT_HEADER_TIPS.length - 1,
    Math.floor(random() * AGENT_HEADER_TIPS.length),
  );
  return AGENT_HEADER_TIPS[index]!;
}

/**
 * Returns the styled rows of the startup header (no trailing blank line is
 * added by callers other than the one separating it from the transcript).
 */
export function buildAgentHeader(input: AgentHeaderInput): string[] {
  const { theme, info, name, width } = input;
  const c = theme.colors;

  const lines: string[] = [];
  const brand = c.bold("eve");
  const identity = buildHeaderIdentity({
    serverUrl: input.serverUrl,
    appRoot: input.appRoot,
    dot: theme.glyph.dot,
  });
  const identityParts = identity === undefined || identity === name ? [name] : [name, identity];
  const identityText = truncate(identityParts.join(` ${theme.glyph.dot} `), Math.max(8, width - 8));
  lines.push(` ${brand} ${c.dim(`${theme.glyph.dot} ${identityText}`)}`);
  lines.push(
    ` ${c.dim(
      truncate(`eve is currently in preview: ${EVE_BETA_TERMS_URL}`, Math.max(8, width - 2)),
    )}`,
  );

  if (info && (info.diagnostics.discoveryErrors > 0 || info.diagnostics.discoveryWarnings > 0)) {
    const parts: string[] = [];
    if (info.diagnostics.discoveryErrors > 0) {
      parts.push(
        c.red(
          `${info.diagnostics.discoveryErrors} error${plural(info.diagnostics.discoveryErrors)}`,
        ),
      );
    }
    if (info.diagnostics.discoveryWarnings > 0) {
      parts.push(
        c.yellow(
          `${info.diagnostics.discoveryWarnings} warning${plural(
            info.diagnostics.discoveryWarnings,
          )}`,
        ),
      );
    }
    lines.push(` ${c.dim(theme.glyph.warning)} ${parts.join(c.dim(" · "))}`);
  }

  if (input.tip !== undefined) {
    lines.push(` ${c.dim(truncate(input.tip, Math.max(8, width - 2)))}`);
  }

  return lines;
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}
