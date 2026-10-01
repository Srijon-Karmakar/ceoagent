import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createMemoryEntry, listMemoryEntries, getMemoryEntry, updateMemoryEntry, type MemoryEntry } from "../memory.js";
import { defineTool } from "../providers/toolAdapter.js";

function formatMemorySummary(entry: MemoryEntry): string {
  const preview = entry.content.length > 160 ? `${entry.content.slice(0, 160)}…` : entry.content;
  const owner = entry.owner === "agent" ? "(via Memory chat)" : "(added manually)";
  return `[${entry.id}] ${entry.title} ${owner}\n  updated: ${entry.updatedAt}${preview ? `\n  preview: ${preview.replace(/\n/g, " ")}` : ""}`;
}

const listMemoryToolDef = defineTool(
  "list_memory_entries",
  "List entries in the system's permanent memory — durable facts the user has fed in that persist across every run and every agent (company details, standing instructions, credentials locations, preferences, anything meant to never need repeating). Optionally filter by a query substring matched against title/content. Results are short previews; call get_memory_entry for full content. Check this before starting substantial work when the task might depend on established context you haven't been given directly.",
  { query: z.string().optional().describe("Filter entries whose title or content contains this text") },
  async ({ query }) => {
    const entries = listMemoryEntries({ query });
    if (!entries.length) return { content: [{ type: "text" as const, text: "No matching memory entries." }] };
    return { content: [{ type: "text" as const, text: entries.map(formatMemorySummary).join("\n\n") }] };
  },
);

const getMemoryToolDef = defineTool(
  "get_memory_entry",
  "Get the full content of a single memory entry by id.",
  { id: z.string().describe("Entry id, from list_memory_entries") },
  async ({ id }) => {
    const entry = getMemoryEntry(id);
    if (!entry) return { content: [{ type: "text" as const, text: `Error: no memory entry with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `[${entry.id}] ${entry.title}\n\n${entry.content}` }] };
  },
);

const SHARED_MEMORY_TOOLS = ["mcp__memory__list_memory_entries", "mcp__memory__get_memory_entry"];

/** Every existing department gets read access — this is what makes memory feel like the whole system's shared brain rather than a tab nobody else sees. */
export const MEMORY_READ_TOOLS = SHARED_MEMORY_TOOLS;

const createMemoryToolDef = defineTool(
  "create_memory_entry",
  'Save a new durable fact to the system\'s permanent memory — every agent will be able to read it from now on. Give it a short, specific title (e.g. "Refund policy", "Primary contact for TheBetterPass") and put the actual fact/instruction in content. Call list_memory_entries first to check a matching entry doesn\'t already exist — prefer update_memory_entry to enrich an existing one over creating a near-duplicate.',
  {
    title: z.string(),
    content: z.string(),
  },
  async ({ title, content }) => {
    const entry = createMemoryEntry({ title, content, owner: "agent", agentKey: "memory", source: "chat" });
    return { content: [{ type: "text" as const, text: `Saved memory [${entry.id}] "${entry.title}".` }] };
  },
);

const updateMemoryToolDef = defineTool(
  "update_memory_entry",
  "Update an existing memory entry's title and/or content by id — content is a full replacement, so call get_memory_entry first if you need to preserve/merge existing text rather than overwrite it.",
  {
    id: z.string().describe("Entry id, from list_memory_entries"),
    title: z.string().optional(),
    content: z.string().optional(),
  },
  async ({ id, ...patch }) => {
    const entry = updateMemoryEntry(id, patch);
    if (!entry) return { content: [{ type: "text" as const, text: `Error: no memory entry with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Updated memory [${entry.id}] ${entry.title}.` }] };
  },
);

/**
 * Deletion is deliberately human-only (see memory.ts/index.ts) — no agent
 * tool for it, so a misfired create/update can be corrected but no agent
 * conversation can ever wipe a memory entry outright.
 */
export const MEMORY_AGENT_TOOLS = [
  "mcp__memory__list_memory_entries",
  "mcp__memory__get_memory_entry",
  "mcp__memory__create_memory_entry",
  "mcp__memory__update_memory_entry",
];

export const MEMORY_TOOL_DEFS = [listMemoryToolDef, getMemoryToolDef, createMemoryToolDef, updateMemoryToolDef];

export const memoryServer = createSdkMcpServer({
  name: "memory",
  version: "1.0.0",
  instructions:
    "Tools for the system's permanent, cross-agent memory. Every department can list_memory_entries/get_memory_entry to check for established context before starting work; only the Memory agent can create_memory_entry/update_memory_entry. Nothing here is ever removed by an agent — deletion is a deliberate, guarded action the user takes directly in the Memory tab's Browse view.",
  tools: MEMORY_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
