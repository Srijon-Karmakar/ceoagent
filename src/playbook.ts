import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { readDoc, writeDoc, docExists, deleteDoc } from "./storage.js";
import { join } from "node:path";
import { getDataDir } from "./paths.js";

function dataFile(): string {
  return join(getDataDir(), "playbook.json");
}

export type PlaybookTab = "sales" | "marketing";

export const PLAYBOOK_TABS: PlaybookTab[] = ["sales", "marketing"];

export type PlaybookItemType = "ai-generative" | "image" | "carousel" | "video" | "reel" | "email-script";

export const PLAYBOOK_ITEM_TYPES: PlaybookItemType[] = [
  "ai-generative",
  "image",
  "carousel",
  "video",
  "reel",
  "email-script",
];

export type PlaybookOwner = "agent" | "manual";

export interface PlaybookItem {
  id: string;
  tab: PlaybookTab;
  type: PlaybookItemType;
  platform?: string;
  link?: string;
  details?: string;
  notes?: string;
  owner: PlaybookOwner;
  /** Which agent created/last touched it, when owner === "agent" — e.g. "sales", "seo", "aeo", "pr". */
  agentKey?: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const stores = new Map<string, Map<string, PlaybookItem>>();

function getStore(): Map<string, PlaybookItem> {
  const file = dataFile();
  const existing = stores.get(file);
  if (existing) return existing;
  const items = new Map<string, PlaybookItem>();
  if (docExists(file)) {
    const raw: PlaybookItem[] = readDoc(file)!;
    for (const i of raw) items.set(i.id, i);
  }
  stores.set(file, items);
  return items;
}

function persist() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeDoc(dataFile(), [...getStore().values()]);
}

export interface CreatePlaybookItemInput {
  tab: PlaybookTab;
  type: PlaybookItemType;
  platform?: string;
  link?: string;
  details?: string;
  notes?: string;
  owner: PlaybookOwner;
  agentKey?: string;
  done?: boolean;
}

export function createPlaybookItem(input: CreatePlaybookItemInput): PlaybookItem {
  const now = new Date().toISOString();
  const done = input.done ?? false;
  const record: PlaybookItem = {
    id: randomUUID(),
    tab: input.tab,
    type: input.type,
    platform: input.platform,
    link: input.link,
    details: input.details,
    notes: input.notes,
    owner: input.owner,
    agentKey: input.agentKey,
    done,
    createdAt: now,
    updatedAt: now,
    completedAt: done ? now : undefined,
  };
  getStore().set(record.id, record);
  persist();
  return record;
}

export function listPlaybookItems(tab?: PlaybookTab): PlaybookItem[] {
  const all = [...getStore().values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return tab ? all.filter((i) => i.tab === tab) : all;
}

export function getPlaybookItem(id: string): PlaybookItem | undefined {
  return getStore().get(id);
}

export type PlaybookItemUpdate = Partial<
  Pick<PlaybookItem, "type" | "platform" | "link" | "details" | "notes" | "done">
>;

export function updatePlaybookItem(id: string, patch: PlaybookItemUpdate): PlaybookItem | undefined {
  const record = getStore().get(id);
  if (!record) return undefined;
  const wasDone = record.done;
  Object.assign(record, patch);
  record.updatedAt = new Date().toISOString();
  if (patch.done !== undefined && patch.done !== wasDone) {
    record.completedAt = patch.done ? record.updatedAt : undefined;
  }
  persist();
  return record;
}

export function deletePlaybookItem(id: string): boolean {
  const items = getStore();
  if (!items.has(id)) return false;
  items.delete(id);
  persist();
  return true;
}
