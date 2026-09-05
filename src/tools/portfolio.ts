import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createEntry,
  listEntries,
  getEntry,
  updateEntry,
  listProjects,
  createNote,
  listNotes,
  getNote,
  updateNote,
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_ENTRY_STATUSES,
  PORTFOLIO_NOTE_TABS,
  type PortfolioEntry,
  type PortfolioCategory,
  type PortfolioEntryStatus,
  type PortfolioNote,
  type PortfolioNoteTab,
} from "../portfolio.js";

const categoryEnum = z.enum(PORTFOLIO_CATEGORIES as [PortfolioCategory, ...PortfolioCategory[]]);
const statusEnum = z.enum(PORTFOLIO_ENTRY_STATUSES as [PortfolioEntryStatus, ...PortfolioEntryStatus[]]);
const noteTabEnum = z.enum(PORTFOLIO_NOTE_TABS as [PortfolioNoteTab, ...PortfolioNoteTab[]]);

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
  if (entry.subject) lines.push(`  subject: ${entry.subject}`);
  if (entry.recipient) lines.push(`  recipient: ${entry.recipient}`);
  if (entry.messageId) lines.push(`  messageId: ${entry.messageId}`);
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
    recipient: z.string().optional().describe('The "To" address, for an email entry'),
    subject: z.string().optional().describe("Subject line, for an email entry"),
    messageId: z.string().optional().describe("Real Gmail message id from a confirmed send, for an email entry"),
  },
  async ({ id, ...patch }) => {
    const entry = updateEntry(id, patch);
    if (!entry) return { content: [{ type: "text" as const, text: `Error: no portfolio entry with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Updated portfolio entry [${entry.id}] ${entry.title} — ${entry.status}.` }] };
  },
);

function formatNoteSummary(note: PortfolioNote): string {
  const owner = note.owner === "agent" && note.agentKey ? `(added by ${note.agentKey})` : "(added manually)";
  const preview = note.content.length > 160 ? `${note.content.slice(0, 160)}…` : note.content;
  return `[${note.id}] ${note.title} — ${note.tab} ${owner}\n  project: ${note.projectId}\n  updated: ${note.updatedAt}${preview ? `\n  preview: ${preview.replace(/\n/g, " ")}` : ""}`;
}

const listNotesTool = tool(
  "list_portfolio_notes",
  'List portfolio notes — freeform markdown memory filed under "project-details" or "database" tabs, distinct from tracked deliverables. Optionally filter by project and/or tab. Results include only a short preview; call get_portfolio_note for the full markdown content. Check these for a project before starting substantial work on it — they hold durable, human-curated context (tech stack, credentials locations, target audience, config values) meant to persist across runs.',
  {
    projectId: z.string().optional().describe("Filter to one project, from list_portfolio_projects"),
    tab: noteTabEnum.optional(),
  },
  async ({ projectId, tab }) => {
    const notes = listNotes({ projectId, tab });
    if (!notes.length) return { content: [{ type: "text" as const, text: "No matching portfolio notes." }] };
    return { content: [{ type: "text" as const, text: notes.map(formatNoteSummary).join("\n\n") }] };
  },
);

const getNoteTool = tool(
  "get_portfolio_note",
  "Get the full markdown content of a single portfolio note by id.",
  { id: z.string().describe("Note id, from list_portfolio_notes") },
  async ({ id }) => {
    const note = getNote(id);
    if (!note) return { content: [{ type: "text" as const, text: `Error: no portfolio note with id ${id}` }], isError: true };
    return {
      content: [
        {
          type: "text" as const,
          text: `[${note.id}] ${note.title} — ${note.tab} (project ${note.projectId})\n\n${note.content}`,
        },
      ],
    };
  },
);

const updateNoteTool = tool(
  "update_portfolio_note",
  "Replace an existing portfolio note's title and/or content by id — content is a full overwrite, not an append, so call get_portfolio_note first if you need to preserve/merge existing text.",
  {
    id: z.string().describe("Note id, from list_portfolio_notes"),
    title: z.string().optional(),
    content: z.string().optional().describe("Full new markdown content, replacing the note's current content"),
  },
  async ({ id, ...patch }) => {
    const note = updateNote(id, patch);
    if (!note) return { content: [{ type: "text" as const, text: `Error: no portfolio note with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Updated portfolio note [${note.id}] ${note.title}.` }] };
  },
);

/**
 * One create tool per agent, bound to a fixed agentKey via closure — same
 * "the model never self-reports which department it's acting as" reasoning
 * as tools/playbook.ts's per-agent create tools. Unlike Playbook's tools,
 * category isn't bound here since none of the categories map 1:1 to a
 * single agent — the agent picks it per call.
 */
function createEntryTool(agentKey: string) {
  return tool(
    `create_${agentKey}_portfolio_entry`,
    'Log a real deliverable (a published/drafted blog, article, collab, PR post, or email) against a portfolio project. For category "email", also pass recipient/subject/messageId from the real send confirmation — the Emails tab shows these as dedicated columns and exports them in its CSV. Call list_portfolio_projects first to find the right projectId — skip logging rather than guessing if no matching project exists.',
    {
      projectId: z.string().describe("Project id, from list_portfolio_projects"),
      category: categoryEnum,
      title: z.string(),
      link: z.string().optional().describe("URL to the published piece/draft, if it has one"),
      status: statusEnum.optional().describe('Defaults to "draft"'),
      date: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
      notes: z.string().optional(),
      recipient: z.string().optional().describe('The "To" address, for an email entry'),
      subject: z.string().optional().describe("Subject line, for an email entry"),
      messageId: z.string().optional().describe("Real Gmail message id from a confirmed send, for an email entry"),
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
const createManagerEntry = createEntryTool("manager");
const createHrEntry = createEntryTool("hr");
const createDeveloperEntry = createEntryTool("developer");
const createAnalysisEntry = createEntryTool("analysis");
const createCrmEntry = createEntryTool("crm");
const createFinanceEntry = createEntryTool("finance");
const createCalendarEntry = createEntryTool("calendar");

/** Per-agent create tool for notes, mirroring createEntryTool's closure-bound-agentKey pattern. */
function createNoteTool(agentKey: string) {
  return tool(
    `create_${agentKey}_portfolio_note`,
    'Save a new freeform markdown note against a portfolio project — durable memory under the "project-details" tab (facts about the project: tech stack, audience, goals, key decisions) or "database" tab (config-like key/value data, e.g. as a markdown list). Call list_portfolio_projects first to find the right projectId, and list_portfolio_notes to check a matching note doesn\'t already exist — prefer update_portfolio_note over creating a duplicate.',
    {
      projectId: z.string().describe("Project id, from list_portfolio_projects"),
      tab: noteTabEnum,
      title: z.string(),
      content: z.string().describe("Markdown content of the note"),
    },
    async (input) => {
      const note = createNote({ ...input, owner: "agent", agentKey });
      return {
        content: [{ type: "text" as const, text: `Added ${note.tab} note [${note.id}] "${note.title}" to project ${note.projectId}.` }],
      };
    },
  );
}

const createSalesNote = createNoteTool("sales");
const createSeoNote = createNoteTool("seo");
const createAeoNote = createNoteTool("aeo");
const createPrNote = createNoteTool("pr");
const createEmailsNote = createNoteTool("emails");
const createManagerNote = createNoteTool("manager");
const createHrNote = createNoteTool("hr");
const createDeveloperNote = createNoteTool("developer");
const createAnalysisNote = createNoteTool("analysis");
const createCrmNote = createNoteTool("crm");
const createFinanceNote = createNoteTool("finance");
const createCalendarNote = createNoteTool("calendar");

const SHARED_PORTFOLIO_TOOLS = [
  "mcp__portfolio__list_portfolio_projects",
  "mcp__portfolio__list_portfolio_entries",
  "mcp__portfolio__get_portfolio_entry",
  "mcp__portfolio__update_portfolio_entry",
  "mcp__portfolio__list_portfolio_notes",
  "mcp__portfolio__get_portfolio_note",
  "mcp__portfolio__update_portfolio_note",
];

export const PORTFOLIO_SALES_TOOLS = [
  "mcp__portfolio__create_sales_portfolio_entry",
  "mcp__portfolio__create_sales_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_SEO_TOOLS = [
  "mcp__portfolio__create_seo_portfolio_entry",
  "mcp__portfolio__create_seo_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_AEO_TOOLS = [
  "mcp__portfolio__create_aeo_portfolio_entry",
  "mcp__portfolio__create_aeo_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_PR_TOOLS = [
  "mcp__portfolio__create_pr_portfolio_entry",
  "mcp__portfolio__create_pr_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_EMAILS_TOOLS = [
  "mcp__portfolio__create_emails_portfolio_entry",
  "mcp__portfolio__create_emails_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_MANAGER_TOOLS = [
  "mcp__portfolio__create_manager_portfolio_entry",
  "mcp__portfolio__create_manager_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_HR_TOOLS = [
  "mcp__portfolio__create_hr_portfolio_entry",
  "mcp__portfolio__create_hr_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_DEVELOPER_TOOLS = [
  "mcp__portfolio__create_developer_portfolio_entry",
  "mcp__portfolio__create_developer_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_ANALYSIS_TOOLS = [
  "mcp__portfolio__create_analysis_portfolio_entry",
  "mcp__portfolio__create_analysis_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_CRM_TOOLS = [
  "mcp__portfolio__create_crm_portfolio_entry",
  "mcp__portfolio__create_crm_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_FINANCE_TOOLS = [
  "mcp__portfolio__create_finance_portfolio_entry",
  "mcp__portfolio__create_finance_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];
export const PORTFOLIO_CALENDAR_TOOLS = [
  "mcp__portfolio__create_calendar_portfolio_entry",
  "mcp__portfolio__create_calendar_portfolio_note",
  ...SHARED_PORTFOLIO_TOOLS,
];

export const portfolioServer = createSdkMcpServer({
  name: "portfolio",
  version: "1.0.0",
  instructions:
    'Tools for tracking content/deliverables (blogs, articles, collabs, PR posts, emails) and durable project memory (freeform markdown notes under "project-details"/"database" tabs) against product/project tabs in the Portfolio view. list_portfolio_projects first to find the right project — projects are human-curated tabs, agents don\'t create them. Before starting substantial work on a named project, call list_portfolio_notes for it — notes carry context (tech stack, target audience, key facts, config values) set once and meant to persist across runs, saving you from re-deriving or re-asking for it. Data here is only ever removed by explicit user/agent deletion — nothing auto-expires.',
  tools: [
    listProjectsTool,
    listEntriesTool,
    getEntryTool,
    updateEntryTool,
    listNotesTool,
    getNoteTool,
    updateNoteTool,
    createSalesEntry,
    createSeoEntry,
    createAeoEntry,
    createPrEntry,
    createEmailsEntry,
    createManagerEntry,
    createHrEntry,
    createDeveloperEntry,
    createAnalysisEntry,
    createCrmEntry,
    createFinanceEntry,
    createCalendarEntry,
    createSalesNote,
    createSeoNote,
    createAeoNote,
    createPrNote,
    createEmailsNote,
    createManagerNote,
    createHrNote,
    createDeveloperNote,
    createAnalysisNote,
    createCrmNote,
    createFinanceNote,
    createCalendarNote,
  ],
});
