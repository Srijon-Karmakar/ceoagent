import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createLead,
  listLeads,
  getLead,
  updateLead,
  addLeadActivity,
  deleteLead,
  LEAD_STAGES,
  type LeadRecord,
  type LeadStage,
} from "../crm.js";
import { defineTool } from "../providers/toolAdapter.js";

const stageEnum = z.enum(LEAD_STAGES as [LeadStage, ...LeadStage[]]);

function formatLead(lead: LeadRecord): string {
  const parts = [
    `[${lead.id}] ${lead.name}`,
    lead.company ? `at ${lead.company}` : null,
    lead.title ? `(${lead.title})` : null,
    `— stage: ${lead.stage}`,
    `— source: ${lead.source}`,
  ].filter(Boolean);
  const lines = [parts.join(" ")];
  if (lead.email) lines.push(`  email: ${lead.email}`);
  if (lead.phone) lines.push(`  phone: ${lead.phone}`);
  if (lead.value !== undefined) lines.push(`  value: ${lead.value}${lead.currency ? ` ${lead.currency}` : ""}`);
  if (lead.owner) lines.push(`  owner: ${lead.owner}`);
  if (lead.tags?.length) lines.push(`  tags: ${lead.tags.join(", ")}`);
  if (lead.followUpAt) lines.push(`  follow-up: ${lead.followUpAt}`);
  if (lead.notes) lines.push(`  notes: ${lead.notes}`);
  if (lead.activity.length) {
    lines.push("  activity:");
    for (const a of lead.activity) lines.push(`    - [${a.ts}] ${a.note}`);
  }
  return lines.join("\n");
}

const createLeadToolDef = defineTool(
  "create_lead",
  "Add a new lead to the CRM pipeline. Use this both for leads found via active prospecting (web research) and for leads captured from a connected channel (Gmail, Instagram, WhatsApp, LinkedIn) — set source accordingly (e.g. \"research\", \"gmail\", \"instagram\", \"whatsapp\", \"linkedin\", \"manual\"). Check list_leads first if there's a real risk of adding a duplicate (e.g. same name/company already prospected in this session).",
  {
    name: z.string().describe("Lead or contact name"),
    company: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional().describe("Job title/role"),
    source: z.string().describe('Where this lead came from, e.g. "research", "gmail", "instagram", "whatsapp", "linkedin", "manual"'),
    stage: stageEnum.optional().describe('Defaults to "new"'),
    value: z.number().optional().describe("Estimated deal value, if known"),
    currency: z.string().optional().describe('e.g. "USD" — only needed if not USD'),
    owner: z.string().optional().describe("Who's responsible for this lead"),
    tags: z.array(z.string()).optional(),
    followUpAt: z.string().optional().describe("ISO date (YYYY-MM-DD) for the next planned touchpoint"),
    notes: z.string().optional(),
  },
  async (input) => {
    const lead = createLead(input);
    return {
      content: [{ type: "text" as const, text: `Created lead [${lead.id}] ${lead.name}${lead.company ? ` at ${lead.company}` : ""} — stage: ${lead.stage}, source: ${lead.source}.` }],
    };
  },
);

const listLeadsToolDef = defineTool(
  "list_leads",
  "List leads in the CRM pipeline, optionally filtered by stage or source. Archived leads are excluded unless includeArchived is true.",
  {
    stage: stageEnum.optional(),
    source: z.string().optional(),
    includeArchived: z.boolean().optional(),
  },
  async ({ stage, source, includeArchived }) => {
    let all = listLeads();
    if (!includeArchived) all = all.filter((l) => !l.archived);
    if (stage) all = all.filter((l) => l.stage === stage);
    if (source) all = all.filter((l) => l.source === source);
    if (!all.length) return { content: [{ type: "text" as const, text: "No leads found." }] };
    return { content: [{ type: "text" as const, text: all.map(formatLead).join("\n\n") }] };
  },
);

const getLeadToolDef = defineTool(
  "get_lead",
  "Get full detail (including activity log) for a single lead by id.",
  { id: z.string().describe("Lead id, from list_leads") },
  async ({ id }) => {
    const lead = getLead(id);
    if (!lead) return { content: [{ type: "text" as const, text: `Error: no lead with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: formatLead(lead) }] };
  },
);

const updateLeadToolDef = defineTool(
  "update_lead",
  "Edit an existing lead by id — any of its fields, including moving it to a new pipeline stage. Only pass the fields you want to change.",
  {
    id: z.string().describe("Lead id, from list_leads"),
    name: z.string().optional(),
    company: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    source: z.string().optional(),
    stage: stageEnum.optional(),
    value: z.number().optional(),
    currency: z.string().optional(),
    owner: z.string().optional(),
    tags: z.array(z.string()).optional(),
    followUpAt: z.string().optional().describe("ISO date (YYYY-MM-DD)"),
    notes: z.string().optional(),
    archived: z.boolean().optional(),
  },
  async ({ id, ...patch }) => {
    const lead = updateLead(id, patch);
    if (!lead) return { content: [{ type: "text" as const, text: `Error: no lead with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Updated lead [${lead.id}] ${lead.name} — stage: ${lead.stage}.` }] };
  },
);

const logLeadActivityToolDef = defineTool(
  "log_lead_activity",
  "Append a timestamped note to a lead's activity log — e.g. why a prospected lead is a good fit, that an email/DM was sent, or a summary of a reply received.",
  {
    id: z.string().describe("Lead id, from list_leads"),
    note: z.string(),
  },
  async ({ id, note }) => {
    const lead = addLeadActivity(id, note);
    if (!lead) return { content: [{ type: "text" as const, text: `Error: no lead with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Logged activity on [${lead.id}] ${lead.name}.` }] };
  },
);

const deleteLeadToolDef = defineTool(
  "delete_lead",
  "Permanently delete a lead by id. Cannot be undone — prefer update_lead with stage: \"lost\" or archived: true unless the user explicitly wants it erased.",
  { id: z.string().describe("Lead id, from list_leads") },
  async ({ id }) => {
    const ok = deleteLead(id);
    if (!ok) return { content: [{ type: "text" as const, text: `Error: no lead with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Deleted lead ${id}.` }] };
  },
);

export const CRM_TOOLS = [
  "mcp__crm__create_lead",
  "mcp__crm__list_leads",
  "mcp__crm__get_lead",
  "mcp__crm__update_lead",
  "mcp__crm__log_lead_activity",
  "mcp__crm__delete_lead",
];

// Subset for agents (e.g. Sales) that need to read CRM leads and log outreach
// against them, but shouldn't create/delete leads themselves — the CRM agent
// stays the single place new leads get added, avoiding duplicate-creation
// logic split across two agents.
export const CRM_OUTREACH_TOOLS = [
  "mcp__crm__list_leads",
  "mcp__crm__get_lead",
  "mcp__crm__update_lead",
  "mcp__crm__log_lead_activity",
];

export const CRM_TOOL_DEFS = [
  createLeadToolDef,
  listLeadsToolDef,
  getLeadToolDef,
  updateLeadToolDef,
  logLeadActivityToolDef,
  deleteLeadToolDef,
];

export const crmServer = createSdkMcpServer({
  name: "crm",
  version: "1.0.0",
  instructions:
    "Tools for managing a local lead/pipeline CRM: creating leads (from prospecting or channel capture), listing/filtering them, updating fields or pipeline stage, logging activity notes, and deleting. list_leads first to avoid duplicating an already-tracked lead.",
  tools: CRM_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
