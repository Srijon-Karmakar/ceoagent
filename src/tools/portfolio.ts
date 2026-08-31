import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createEntry,
  listEntries,
  getEntry,
  updateEntry,
  listProjects,
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_ENTRY_STATUSES,
  type PortfolioEntry,
  type PortfolioCategory,
  type PortfolioEntryStatus,
} from "../portfolio.js";

const categoryEnum = z.enum(PORTFOLIO_CATEGORIES as [PortfolioCategory, ...PortfolioCategory[]]);
const statusEnum = z.enum(PORTFOLIO_ENTRY_STATUSES as [PortfolioEntryStatus, ...PortfolioEntryStatus[]]);

function formatEntry(entry: PortfolioEntry): string {
  const parts = [
    `[${entry.id}] ${entry.title}`,
    `— ${entry.category}`,
    `— ${entry.status}`,
    entry.owner === "agent" && entry.agentKey ? `(added by ${entry.agentKey})` : "(added manually)",
  ].filter(Boolean);
  const lines = [parts.join(" ")];
  lines.push(`  project: ${entry.projectId}`);
  if (entry.link) lines.push(`  link: ${entry.link}`);
  if (entry.date) lines.push(`  date: ${entry.date}`);
  if (entry.notes) lines.push(`  notes: ${entry.notes}`);
  return lines.join("\n");
}

const listProjectsTool = tool(
  "list_portfolio_projects",
  "List the portfolio's project/product tabs (id + name). Call this first to find the right projectId before creating or filtering entries — projects are human-curated, so don't assume one exists without checking.",
  {},
  async () => {
    const projects = listProjects();
    if (!projects.length) return { content: [{ type: "text" as const, text: "No portfolio projects yet." }] };
    return {
      content: [{ type: "text" as const, text: projects.map((p) => `[${p.id}] ${p.name}`).join("\n") }],
    };
  },
);

const listEntriesTool = tool(
  "list_portfolio_entries",
  "List portfolio entries, optionally filtered by project and/or category (blog/article/collab/pr-post/email).",
  {
    projectId: z.string().optional().describe("Filter to one project, from list_portfolio_projects"),
    category: categoryEnum.optional(),
  },
  async ({ projectId, category }) => {
    const entries = listEntries({ projectId, category });
    if (!entries.length) return { content: [{ type: "text" as const, text: "No matching portfolio entries." }] };
    return { content: [{ type: "text" as const, text: entries.map(formatEntry).join("\n\n") }] };
  },
);

const getEntryTool = tool(
  "get_portfolio_entry",
  "Get full detail for a single portfolio entry by id.",
  { id: z.string().describe("Entry id, from list_portfolio_entries") },
  async ({ id }) => {
    const entry = getEntry(id);
    if (!entry) return { content: [{ type: "text" as const, text: `Error: no portfolio entry with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: formatEntry(entry) }] };
  },
);

const updateEntryTool = tool(
  "update_portfolio_entry",
  "Edit an existing portfolio entry by id — any of its fields, including moving it to a different project/category or changing its status. Only pass the fields you want to change.",
  {
    id: z.string().describe("Entry id, from list_portfolio_entries"),
    projectId: z.string().optional(),
    category: categoryEnum.optional(),
    title: z.string().optional(),
    link: z.string().optional(),
    status: statusEnum.optional(),
    date: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
  },
  async ({ id, ...patch }) => {
    const entry = updateEntry(id, patch);
    if (!entry) return { content: [{ type: "text" as const, text: `Error: no portfolio entry with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Updated portfolio entry [${entry.id}] ${entry.title} — ${entry.status}.` }] };
  },
);

/**
 * One create tool per agent, bound to a fixed agentKey via closure — same
 * "the model never self-reports which department it's acting as" reasoning
 * as tools/playbook.ts's per-agent create tools. Unlike Playbook's tools,
 * category isn't bound here since none of the 5 categories map 1:1 to a
 * single agent — the agent picks it per call.
 */
function createEntryTool(agentKey: string) {
  return tool(
    `create_${agentKey}_portfolio_entry`,
    "Log a real deliverable (a published/drafted blog, article, collab, PR post, or email) against a portfolio project. Call list_portfolio_projects first to find the right projectId — skip logging rather than guessing if no matching project exists.",
    {
      projectId: z.string().describe("Project id, from list_portfolio_projects"),
      category: categoryEnum,
      title: z.string(),
      link: z.string().optional().describe("URL to the published piece/draft, if it has one"),
      status: statusEnum.optional().describe('Defaults to "draft"'),
      date: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
      notes: z.string().optional(),
    },
    async (input) => {
      const entry = createEntry({ ...input, owner: "agent", agentKey });
      return {
        content: [
          { type: "text" as const, text: `Added ${entry.category} entry [${entry.id}] "${entry.title}" (${entry.status}) to project ${entry.projectId}.` },
        ],
      };
    },
  );
}

const createSalesEntry = createEntryTool("sales");
const createSeoEntry = createEntryTool("seo");
const createAeoEntry = createEntryTool("aeo");
const createPrEntry = createEntryTool("pr");
const createEmailsEntry = createEntryTool("emails");

const SHARED_PORTFOLIO_TOOLS = [
  "mcp__portfolio__list_portfolio_projects",
  "mcp__portfolio__list_portfolio_entries",
  "mcp__portfolio__get_portfolio_entry",
  "mcp__portfolio__update_portfolio_entry",
];

export const PORTFOLIO_SALES_TOOLS = ["mcp__portfolio__create_sales_portfolio_entry", ...SHARED_PORTFOLIO_TOOLS];
export const PORTFOLIO_SEO_TOOLS = ["mcp__portfolio__create_seo_portfolio_entry", ...SHARED_PORTFOLIO_TOOLS];
export const PORTFOLIO_AEO_TOOLS = ["mcp__portfolio__create_aeo_portfolio_entry", ...SHARED_PORTFOLIO_TOOLS];
export const PORTFOLIO_PR_TOOLS = ["mcp__portfolio__create_pr_portfolio_entry", ...SHARED_PORTFOLIO_TOOLS];
export const PORTFOLIO_EMAILS_TOOLS = ["mcp__portfolio__create_emails_portfolio_entry", ...SHARED_PORTFOLIO_TOOLS];

export const portfolioServer = createSdkMcpServer({
  name: "portfolio",
  version: "1.0.0",
  instructions:
    "Tools for tracking content/deliverables (blogs, articles, collabs, PR posts, emails) against product/project tabs in the Portfolio view. list_portfolio_projects first to find the right project — projects are human-curated tabs, agents don't create them.",
  tools: [listProjectsTool, listEntriesTool, getEntryTool, updateEntryTool, createSalesEntry, createSeoEntry, createAeoEntry, createPrEntry, createEmailsEntry],
});
