import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { readDoc, writeDoc, docExists, deleteDoc } from "./storage.js";
import { join } from "node:path";
import { getDataDir } from "./paths.js";

function dataFile(): string {
  return join(getDataDir(), "leads.json");
}

export type LeadStage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";

export const LEAD_STAGES: LeadStage[] = ["new", "contacted", "qualified", "proposal", "won", "lost"];

export interface LeadActivity {
  id: string;
  ts: string;
  note: string;
}

export interface LeadRecord {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  title?: string;
  /** Free string, not a closed enum — e.g. "research", "gmail", "instagram",
   * "whatsapp", "linkedin", "manual" — same reasoning as `platform` in
   * tools/zernio.ts. */
  source: string;
  stage: LeadStage;
  value?: number;
  /** e.g. "USD" — only set when meaningful, display defaults to USD/"$". */
  currency?: string;
  owner?: string;
  tags?: string[];
  /** ISO date (YYYY-MM-DD) for the next planned touchpoint, if any. */
  followUpAt?: string;
  notes?: string;
  activity: LeadActivity[];
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp of the last time `stage` changed (or createdAt if never). */
  stageEnteredAt: string;
  archived?: boolean;
}

const stores = new Map<string, Map<string, LeadRecord>>();

function getStore(): Map<string, LeadRecord> {
  const file = dataFile();
  const existing = stores.get(file);
  if (existing) return existing;
  const leads = new Map<string, LeadRecord>();
  let migrated = false;
  if (docExists(file)) {
    const raw: LeadRecord[] = readDoc(file)!;
    for (const l of raw) {
      if (!l.stageEnteredAt) {
        l.stageEnteredAt = l.updatedAt ?? l.createdAt;
        migrated = true;
      }
      leads.set(l.id, l);
    }
  }
  stores.set(file, leads);
  if (migrated) persist();
  return leads;
}

function persist() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeDoc(dataFile(), [...getStore().values()]);
}

export interface CreateLeadInput {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  title?: string;
  source: string;
  stage?: LeadStage;
  value?: number;
  currency?: string;
  owner?: string;
  tags?: string[];
  followUpAt?: string;
  notes?: string;
}

export function createLead(input: CreateLeadInput): LeadRecord {
  const now = new Date().toISOString();
  const record: LeadRecord = {
    id: randomUUID(),
    name: input.name,
    company: input.company,
    email: input.email,
    phone: input.phone,
    title: input.title,
    source: input.source,
    stage: input.stage ?? "new",
    value: input.value,
    currency: input.currency,
    owner: input.owner,
    tags: input.tags,
    followUpAt: input.followUpAt,
    notes: input.notes,
    activity: [],
    createdAt: now,
    updatedAt: now,
    stageEnteredAt: now,
  };
  getStore().set(record.id, record);
  persist();
  return record;
}

export function listLeads(): LeadRecord[] {
  return [...getStore().values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getLead(id: string): LeadRecord | undefined {
  return getStore().get(id);
}

export type LeadUpdate = Partial<
  Pick<
    LeadRecord,
    | "name"
    | "company"
    | "email"
    | "phone"
    | "title"
    | "source"
    | "stage"
    | "value"
    | "currency"
    | "owner"
    | "tags"
    | "followUpAt"
    | "notes"
    | "archived"
  >
>;

export function updateLead(id: string, patch: LeadUpdate): LeadRecord | undefined {
  const record = getStore().get(id);
  if (!record) return undefined;
  const now = new Date().toISOString();
  if (patch.stage !== undefined && patch.stage !== record.stage) record.stageEnteredAt = now;
  Object.assign(record, patch);
  record.updatedAt = now;
  persist();
  return record;
}

export function addLeadActivity(id: string, note: string): LeadRecord | undefined {
  const record = getStore().get(id);
  if (!record) return undefined;
  record.activity.push({ id: randomUUID(), ts: new Date().toISOString(), note });
  record.updatedAt = new Date().toISOString();
  persist();
  return record;
}

export function deleteLead(id: string): boolean {
  const leads = getStore();
  if (!leads.has(id)) return false;
  leads.delete(id);
  persist();
  return true;
}
