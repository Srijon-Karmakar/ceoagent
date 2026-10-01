import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getEnvValue } from "../server/settings.js";
import { defineTool } from "../providers/toolAdapter.js";

// ScrapeGraphAI — AI-powered scraping/extraction API. Distinct from the
// built-in WebSearch/WebFetch tools: those return free-text/markdown for the
// model to read, while this returns a JSON object shaped to a caller-supplied
// schema — worth reaching for whenever the task needs specific fields
// reliably (e.g. a company's contact details for CRM prospecting, or a
// competitor page's meta tags for an SEO/AEO report) rather than a summary.
// Confirmed against docs.scrapegraphai.com (2026-08): v2 API, one API key,
// no OAuth/dashboard linking step — just SCRAPEGRAPH_API_KEY.
const API_BASE = "https://v2-api.scrapegraphai.com";

function getApiKey(): string {
  const key = getEnvValue("SCRAPEGRAPH_API_KEY");
  if (!key) throw new Error("SCRAPEGRAPH_API_KEY is not set");
  return key;
}

export function isScrapegraphConnected(): boolean {
  return !!getEnvValue("SCRAPEGRAPH_API_KEY");
}

function scrapegraphHeaders() {
  return { "SGAI-APIKEY": getApiKey(), "Content-Type": "application/json" };
}

const schemaParam = z
  .record(z.string(), z.unknown())
  .optional()
  .describe("Optional JSON Schema object constraining the shape of the returned json field, e.g. { type: \"object\", properties: { price: { type: \"string\" } }, required: [\"price\"] }");

const extractUrlDef = defineTool(
  "scrapegraph_extract",
  "Extract structured data from a single URL using natural language, optionally constrained to a JSON Schema. Use this instead of WebFetch when the task needs specific, reliably-shaped fields (pricing, contact info, meta tags, specs) rather than a free-text summary.",
  {
    url: z.string().url().describe("Page to extract from"),
    prompt: z.string().describe("Natural-language description of what to extract"),
    schema: schemaParam,
  },
  async ({ url, prompt, schema }) => {
    try {
      const res = await fetch(`${API_BASE}/api/extract`, {
        method: "POST",
        headers: scrapegraphHeaders(),
        body: JSON.stringify({ url, prompt, ...(schema ? { schema } : {}) }),
      });
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error from ScrapeGraph extract: ${res.status} ${await res.text()}` }], isError: true };
      }
      const json = (await res.json()) as { json?: unknown; raw?: string | null };
      if (json.json === undefined || json.json === null) {
        return { content: [{ type: "text" as const, text: json.raw ?? "ScrapeGraph returned no extracted data for this URL." }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(json.json, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error calling ScrapeGraph extract: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

const searchWebDef = defineTool(
  "scrapegraph_search",
  "AI-powered web search that fetches and returns page content for each result, optionally extracting structured data (via prompt + schema) across all results at once. Use this over WebSearch when you need actual page content alongside the results, or a structured summary distilled across several pages in one call.",
  {
    query: z.string().describe("Search query"),
    numResults: z.number().int().min(1).max(20).default(5).describe("Number of results to fetch (1-20)"),
    prompt: z.string().optional().describe("Optional natural-language extraction prompt applied across all fetched results"),
    schema: schemaParam,
  },
  async ({ query, numResults, prompt, schema }) => {
    try {
      const res = await fetch(`${API_BASE}/api/search`, {
        method: "POST",
        headers: scrapegraphHeaders(),
        body: JSON.stringify({ query, numResults, ...(prompt ? { prompt } : {}), ...(schema ? { schema } : {}) }),
      });
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error from ScrapeGraph search: ${res.status} ${await res.text()}` }], isError: true };
      }
      const data = (await res.json()) as {
        results?: Array<{ url: string; title?: string; content?: string }>;
        json?: unknown;
      };
      const parts: string[] = [];
      if (data.json !== undefined && data.json !== null) {
        parts.push(`Extracted:\n${JSON.stringify(data.json, null, 2)}`);
      }
      const results = data.results ?? [];
      if (results.length) {
        parts.push(
          results
            .map((r) => `- ${r.title ?? r.url} (${r.url})${r.content ? `\n  ${r.content.slice(0, 500)}` : ""}`)
            .join("\n"),
        );
      }
      if (!parts.length) parts.push("No results found.");
      return { content: [{ type: "text" as const, text: parts.join("\n\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error calling ScrapeGraph search: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

export const SCRAPEGRAPH_TOOLS = ["mcp__scrapegraph__scrapegraph_extract", "mcp__scrapegraph__scrapegraph_search"];

export const SCRAPEGRAPH_TOOL_DEFS = [extractUrlDef, searchWebDef];

export const scrapegraphServer = createSdkMcpServer({
  name: "scrapegraph",
  version: "1.0.0",
  instructions:
    "Tools for AI-powered structured web extraction (scrapegraph_extract) and search-with-content (scrapegraph_search) via ScrapeGraphAI. Prefer these over WebFetch/WebSearch when the task needs specific, reliably-shaped fields rather than a free-text summary.",
  tools: SCRAPEGRAPH_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
