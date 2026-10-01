import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getEnvValue } from "../server/settings.js";
import { defineTool } from "../providers/toolAdapter.js";

// Hunter.io — email finder/verifier. Simple API-key auth (query param or
// header, both work; confirmed against hunter.io/api-documentation,
// 2026-08), no OAuth/dashboard-linking step. Fills the CRM agent's biggest
// gap: it can find prospect companies/names via web search but had no way
// to get an actual, verified email address for one.
const API_BASE = "https://api.hunter.io/v2";

function getApiKey(): string {
  const key = getEnvValue("HUNTER_API_KEY");
  if (!key) throw new Error("HUNTER_API_KEY is not set");
  return key;
}

export function isHunterConnected(): boolean {
  return !!getEnvValue("HUNTER_API_KEY");
}

interface HunterErrorBody {
  errors?: Array<{ id?: string; code?: number; details?: string }>;
}

function hunterErrorText(status: number, body: HunterErrorBody): string {
  const details = body.errors?.map((e) => e.details).filter(Boolean).join("; ");
  return `Hunter error ${status}${details ? `: ${details}` : ""}`;
}

const domainSearchDef = defineTool(
  "hunter_domain_search",
  "Find email addresses associated with a company's domain — returns each address with a confidence score and, when known, the person's name and job title. Use this to find real contacts at a prospect company before drafting outreach, instead of guessing an address format.",
  {
    domain: z.string().describe('Company domain, e.g. "acme.com" — no https:// or www.'),
    limit: z.number().int().min(1).max(100).default(10).describe("Max emails to return"),
  },
  async ({ domain, limit }) => {
    try {
      const params = new URLSearchParams({ domain, limit: String(limit), api_key: getApiKey() });
      const res = await fetch(`${API_BASE}/domain-search?${params}`);
      const body = (await res.json()) as HunterErrorBody & {
        data?: {
          organization?: string;
          emails?: Array<{ value: string; type: string; confidence: number; first_name?: string; last_name?: string; position?: string }>;
        };
      };
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: hunterErrorText(res.status, body) }], isError: true };
      }
      const emails = body.data?.emails ?? [];
      if (!emails.length) {
        return { content: [{ type: "text" as const, text: `No emails found for ${domain}.` }] };
      }
      const lines = emails.map((e) => {
        const who = [e.first_name, e.last_name].filter(Boolean).join(" ") || "(name unknown)";
        return `- ${e.value} — ${who}${e.position ? `, ${e.position}` : ""} (${e.type}, confidence ${e.confidence}%)`;
      });
      return { content: [{ type: "text" as const, text: `${body.data?.organization ?? domain}:\n${lines.join("\n")}` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error calling Hunter domain search: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

const findEmailDef = defineTool(
  "hunter_find_email",
  "Find the most likely email address for a specific person at a company, given their name and the company's domain. Returns a confidence score — treat anything below ~50 as a guess, not a verified contact.",
  {
    domain: z.string().describe('Company domain, e.g. "acme.com" — no https:// or www.'),
    firstName: z.string(),
    lastName: z.string(),
  },
  async ({ domain, firstName, lastName }) => {
    try {
      const params = new URLSearchParams({
        domain,
        first_name: firstName,
        last_name: lastName,
        api_key: getApiKey(),
      });
      const res = await fetch(`${API_BASE}/email-finder?${params}`);
      const body = (await res.json()) as HunterErrorBody & {
        data?: { email?: string; score?: number; position?: string; company?: string };
      };
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: hunterErrorText(res.status, body) }], isError: true };
      }
      if (!body.data?.email) {
        return { content: [{ type: "text" as const, text: `No email found for ${firstName} ${lastName} at ${domain}.` }] };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `${body.data.email} (confidence ${body.data.score}%)${body.data.position ? ` — ${body.data.position}` : ""}${body.data.company ? ` at ${body.data.company}` : ""}`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error calling Hunter email finder: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

export const HUNTER_TOOLS = ["mcp__hunter__hunter_domain_search", "mcp__hunter__hunter_find_email"];

export const HUNTER_TOOL_DEFS = [domainSearchDef, findEmailDef];

export const hunterServer = createSdkMcpServer({
  name: "hunter",
  version: "1.0.0",
  instructions:
    "Tools for finding real contact emails via Hunter.io: hunter_domain_search for all known emails at a company, hunter_find_email for one specific person. Prefer these over guessing an email format.",
  tools: HUNTER_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
