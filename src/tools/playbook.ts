import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createPlaybookItem,
  listPlaybookItems,
  getPlaybookItem,
  updatePlaybookItem,
  PLAYBOOK_ITEM_TYPES,
  type PlaybookItem,
  type PlaybookItemType,
  type PlaybookTab,
} from "../playbook.js";
import { defineTool } from "../providers/toolAdapter.js";

const typeEnum = z.enum(PLAYBOOK_ITEM_TYPES as [PlaybookItemType, ...PlaybookItemType[]]);

function formatItem(item: PlaybookItem): string {
  const parts = [
    `[${item.id}] ${item.type}`,
    item.platform ? `on ${item.platform}` : null,
    `— ${item.done ? "done" : "not done"}`,
    item.owner === "agent" && item.agentKey ? `(added by ${item.agentKey})` : "(added manually)",
  ].filter(Boolean);
  const lines = [parts.join(" ")];
  if (item.link) lines.push(`  link: ${item.link}`);
  if (item.details) lines.push(`  details: ${item.details}`);
  if (item.notes) lines.push(`  notes: ${item.notes}`);
  return lines.join("\n");
}

/**
 * One create tool per agent, bound to a fixed tab + agentKey via closure —
 * same "the model never self-reports which department it's acting as"
 * reasoning as tools/documents.ts's per-agent create_X_document tools. This
 * is what makes it safe to grant the Sales agent only the sales-tab tool and
 * SEO/AEO/PR only the marketing-tab tool, without trusting any of them to
 * pass the right tab themselves.
 */
function createItemToolDef(agentKey: string, tab: PlaybookTab) {
  return defineTool(
    `create_${agentKey}_playbook_item`,
    `Add a deliverable to the ${tab} playbook — a tracked checklist of content/assets (AI-generated copy, images, carousels, videos, reels, email/script drafts) with a link, platform, and details, and a done checkbox. Use this for every deliverable you actually produce so it's tracked on the ${tab} playbook, not just described in chat.`,
    {
      type: typeEnum,
      platform: z.string().optional().describe('e.g. "LinkedIn", "Instagram", "Email", "Blog"'),
      link: z.string().optional().describe("URL to the asset/post/draft, if it has one"),
      details: z.string().optional().describe("What this is — e.g. the post caption, campaign name, or a short description"),
      notes: z.string().optional(),
      done: z.boolean().optional().describe("Whether this deliverable is already complete. Defaults to false."),
    },
    async (input) => {
      const item = createPlaybookItem({ ...input, tab, owner: "agent", agentKey });
      return {
        content: [
          {
            type: "text" as const,
            text: `Added ${item.type} item [${item.id}] to the ${tab} playbook${item.platform ? ` (${item.platform})` : ""}.`,
          },
        ],
      };
    },
  );
}

function listItemsToolDef(tab: PlaybookTab) {
  return defineTool(
    `list_${tab}_playbook_items`,
    `List items on the ${tab} playbook, optionally filtered by done status. Check this before adding a new item if there's a real risk of duplicating one already tracked.`,
    { done: z.boolean().optional() },
    async ({ done }) => {
      let items = listPlaybookItems(tab);
      if (done !== undefined) items = items.filter((i) => i.done === done);
      if (!items.length) return { content: [{ type: "text" as const, text: `No items on the ${tab} playbook.` }] };
      return { content: [{ type: "text" as const, text: items.map(formatItem).join("\n\n") }] };
    },
  );
}

function updateItemToolDef(tab: PlaybookTab) {
  return defineTool(
    `update_${tab}_playbook_item`,
    `Edit an item on the ${tab} playbook by id — any of its fields, including marking it done once the deliverable is finished. Only pass the fields you want to change.`,
    {
      id: z.string().describe(`Item id, from list_${tab}_playbook_items`),
      type: typeEnum.optional(),
      platform: z.string().optional(),
      link: z.string().optional(),
      details: z.string().optional(),
      notes: z.string().optional(),
      done: z.boolean().optional(),
    },
    async ({ id, ...patch }) => {
      const existing = getPlaybookItem(id);
      if (!existing || existing.tab !== tab) {
        return { content: [{ type: "text" as const, text: `Error: no ${tab} playbook item with id ${id}` }], isError: true };
      }
      const item = updatePlaybookItem(id, patch);
      return { content: [{ type: "text" as const, text: `Updated playbook item [${item!.id}] — ${item!.done ? "done" : "not done"}.` }] };
    },
  );
}

const createSalesItemDef = createItemToolDef("sales", "sales");
const createSeoItemDef = createItemToolDef("seo", "marketing");
const createAeoItemDef = createItemToolDef("aeo", "marketing");
const createPrItemDef = createItemToolDef("pr", "marketing");
const listSalesItemsDef = listItemsToolDef("sales");
const listMarketingItemsDef = listItemsToolDef("marketing");
const updateSalesItemDef = updateItemToolDef("sales");
const updateMarketingItemDef = updateItemToolDef("marketing");

export const PLAYBOOK_SALES_TOOLS = [
  "mcp__playbook__create_sales_playbook_item",
  "mcp__playbook__list_sales_playbook_items",
  "mcp__playbook__update_sales_playbook_item",
];

export const PLAYBOOK_SEO_TOOLS = [
  "mcp__playbook__create_seo_playbook_item",
  "mcp__playbook__list_marketing_playbook_items",
  "mcp__playbook__update_marketing_playbook_item",
];

export const PLAYBOOK_AEO_TOOLS = [
  "mcp__playbook__create_aeo_playbook_item",
  "mcp__playbook__list_marketing_playbook_items",
  "mcp__playbook__update_marketing_playbook_item",
];

export const PLAYBOOK_PR_TOOLS = [
  "mcp__playbook__create_pr_playbook_item",
  "mcp__playbook__list_marketing_playbook_items",
  "mcp__playbook__update_marketing_playbook_item",
];

export const PLAYBOOK_TOOL_DEFS = [
  createSalesItemDef,
  createSeoItemDef,
  createAeoItemDef,
  createPrItemDef,
  listSalesItemsDef,
  listMarketingItemsDef,
  updateSalesItemDef,
  updateMarketingItemDef,
];

export const playbookServer = createSdkMcpServer({
  name: "playbook",
  version: "1.0.0",
  instructions:
    "Tools for tracking deliverables (AI-generated copy, images, carousels, videos, reels, email/script drafts) on the Sales and Marketing playbooks — a checklist with links, platforms, and a done status shown on the dashboard.",
  tools: PLAYBOOK_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
