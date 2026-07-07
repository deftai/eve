"use client";

import { Input } from "@vercel/geistdocs/components/input";
import { InputGroup, InputGroupAddon } from "@vercel/geistdocs/components/input-group";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  type GalleryIntegration,
  protocolBadgeClassName,
  protocolLabel,
} from "@/lib/integrations/data";
import { cn } from "@/lib/utils";
import { IntegrationLogo } from "./integration-logo";

type Filter = "all" | "channel" | "mcp" | "openapi";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "channel", label: "Channels" },
  { value: "mcp", label: "MCP" },
  { value: "openapi", label: "OpenAPI" },
];

const FILTER_DESCRIPTIONS: Partial<Record<Filter, string>> = {
  channel: "Channels are the places where people talk to an eve agent.",
  mcp: "MCP integrations expose provider tools through a remote MCP server.",
  openapi: "OpenAPI integrations turn provider specs into callable agent tools.",
};

interface GalleryProps {
  integrations: GalleryIntegration[];
}

const providerLabel = (integration: GalleryIntegration): string | null => {
  if (integration.logoDomain) {
    return integration.logoDomain;
  }
  const endpoint = integration.surfaces?.[0]?.endpointValue;
  if (!endpoint) return null;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
};

const IntegrationRow = ({ integration }: { integration: GalleryIntegration }) => {
  const provider = providerLabel(integration);
  const surfaces = integration.surfaces ?? [];
  const protocols = [...new Set(surfaces.map((surface) => surface.protocol))];
  const authLabel = integration.type === "channel" ? null : surfaces[0]?.authLabels[0];

  return (
    <Link
      className="grid min-w-0 gap-3 border-t px-4 py-3 transition-colors [contain-intrinsic-size:72px] [content-visibility:auto] first:border-t-0 hover:bg-gray-100/50 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto]"
      href={`/integrations/${integration.slug}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-gray-1000">
          <IntegrationLogo className="size-4" integration={integration} size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-gray-1000 text-sm">{integration.name}</p>
          {provider ? <p className="truncate text-gray-800 text-xs">{provider}</p> : null}
        </div>
      </div>
      <p className="min-w-0 overflow-hidden text-gray-900 text-sm leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
        {integration.tagline}
      </p>
      <div className="flex flex-wrap items-start gap-1 sm:justify-end">
        {integration.source !== "generated" ? (
          <span className="rounded-full border bg-background px-2 py-0.5 font-medium text-gray-1000 text-xs">
            Curated
          </span>
        ) : null}
        {integration.type === "channel" ? (
          <span className="rounded-full border px-2 py-0.5 text-gray-900 text-xs">Channel</span>
        ) : (
          protocols.map((protocol) => (
            <span
              className={`rounded-full px-2 py-0.5 font-medium text-xs ${protocolBadgeClassName[protocol]}`}
              key={protocol}
            >
              {protocolLabel[protocol]}
            </span>
          ))
        )}
        {authLabel ? (
          <span className="rounded-full border px-2 py-0.5 text-gray-900 text-xs">{authLabel}</span>
        ) : null}
      </div>
    </Link>
  );
};

export const Gallery = ({ integrations }: GalleryProps) => {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return integrations.filter((integration) => {
      const surfaces = integration.surfaces ?? [];
      if (
        (filter === "channel" && integration.type !== "channel") ||
        (filter === "mcp" && !surfaces.some((surface) => surface.protocol === "mcp")) ||
        (filter === "openapi" && !surfaces.some((surface) => surface.protocol === "openapi"))
      ) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const haystack = [
        integration.name,
        integration.tagline,
        ...(integration.keywords ?? []),
        ...surfaces.flatMap((surface) => [
          surface.name,
          surface.endpointValue,
          ...surface.authLabels,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [integrations, filter, query]);
  const generatedCount = results.filter((integration) => integration.source === "generated").length;

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-wrap gap-1 rounded-md border bg-background-100 p-1 sm:w-fit">
          {FILTERS.map(({ value, label }) => (
            <button
              className={cn(
                "rounded px-3 py-1 font-medium text-sm transition-colors",
                filter === value
                  ? "bg-gray-100 text-gray-1000"
                  : "text-gray-900 hover:bg-gray-100/40 hover:text-gray-1000",
              )}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <InputGroup className="h-9 w-full bg-background sm:w-64">
          <InputGroupAddon>
            <SearchIcon className="size-4 text-gray-700" />
          </InputGroupAddon>
          <Input
            aria-label="Search integrations"
            className="h-full border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search integrations"
            value={query}
          />
        </InputGroup>
      </div>

      <div className="flex flex-col gap-1 text-gray-800 text-sm">
        {FILTER_DESCRIPTIONS[filter] ? <p>{FILTER_DESCRIPTIONS[filter]}</p> : null}
        <p>
          Showing all {results.length.toLocaleString()} integrations
          {generatedCount > 0
            ? `, including ${generatedCount.toLocaleString()} MCP servers and OpenAPI specs from public registries`
            : ""}
          .
        </p>
      </div>

      {results.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-background-100">
          {results.map((integration) => (
            <IntegrationRow integration={integration} key={integration.slug} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-16 text-center">
          <p className="font-medium text-gray-1000">No integrations found</p>
          <p className="text-gray-800 text-sm">Try a different search or filter.</p>
        </div>
      )}
    </div>
  );
};
