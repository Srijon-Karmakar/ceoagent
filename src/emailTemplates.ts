import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./paths.js";

function dataFile(): string {
  return join(getDataDir(), "email-templates.json");
}

export interface EmailTemplateRecord {
  id: string;
  name: string;
  subject: string;
  body: string;
  /** true when `body` is HTML markup (e.g. a designed template with hosted <img> tags) rather than plain text. */
  isHtml?: boolean;
  createdAt: string;
  updatedAt: string;
}

const stores = new Map<string, Map<string, EmailTemplateRecord>>();

function getStore(): Map<string, EmailTemplateRecord> {
  const file = dataFile();
  const existing = stores.get(file);
  if (existing) return existing;
  const templates = new Map<string, EmailTemplateRecord>();
  if (existsSync(file)) {
    const raw: EmailTemplateRecord[] = JSON.parse(readFileSync(file, "utf-8"));
    for (const t of raw) templates.set(t.id, t);
  }
  stores.set(file, templates);
  return templates;
}

function persist() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(dataFile(), JSON.stringify([...getStore().values()], null, 2));
}

export interface CreateEmailTemplateInput {
  name: string;
  subject: string;
  body: string;
  isHtml?: boolean;
}

export function createEmailTemplate(input: CreateEmailTemplateInput): EmailTemplateRecord {
  const now = new Date().toISOString();
  const record: EmailTemplateRecord = {
    id: randomUUID(),
    name: input.name,
    subject: input.subject,
    body: input.body,
    isHtml: input.isHtml,
    createdAt: now,
    updatedAt: now,
  };
  getStore().set(record.id, record);
  persist();
  return record;
}

export function listEmailTemplates(): EmailTemplateRecord[] {
  return [...getStore().values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getEmailTemplate(id: string): EmailTemplateRecord | undefined {
  return getStore().get(id);
}

export type EmailTemplateUpdate = Partial<Pick<EmailTemplateRecord, "name" | "subject" | "body" | "isHtml">>;

export function updateEmailTemplate(id: string, patch: EmailTemplateUpdate): EmailTemplateRecord | undefined {
  const record = getStore().get(id);
  if (!record) return undefined;
  Object.assign(record, patch);
  record.updatedAt = new Date().toISOString();
  persist();
  return record;
}

export function deleteEmailTemplate(id: string): boolean {
  const templates = getStore();
  if (!templates.has(id)) return false;
  templates.delete(id);
  persist();
  return true;
}

/** Replaces `{{key}}` placeholders (case-insensitive) with the matching value from `vars`; an unmatched placeholder is left as-is rather than blanked, so a typo'd variable stays visible instead of silently disappearing. */
export function renderEmailTemplate(text: string, vars: Record<string, string>): string {
  const lowerVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) lowerVars[k.toLowerCase()] = v;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = lowerVars[key.toLowerCase()];
    return value !== undefined ? value : match;
  });
}
