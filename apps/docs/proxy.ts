import { createProxy } from "@vercel/geistdocs/proxy";
import { config as geistdocsConfig } from "@/lib/geistdocs/config";
import { trackMdRequest } from "@/lib/geistdocs/md-tracking";

const proxy = createProxy({
  config: geistdocsConfig,
  trackMarkdownRequest: trackMdRequest,
  before: () => null,
});

export const config = {
  // Matcher ignoring `/_next/`, `/api/`, public static assets, favicon, sitemap, robots, etc.
  //
  // This intentionally does not exclude every path with a dot: agents.md,
  // sitemap.md, llms.txt, and rss.xml live under `/[lang]/...` and rely on
  // this proxy to rewrite the unprefixed request to the default language.
  // Skipping the proxy for them leaves `[lang]` to match the literal
  // filename (e.g. lang="agents.md"), which crashes instead of resolving.
  matcher: [
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|eve\\.tgz$|eve-5/).*)",
  ],
};

export default proxy;
