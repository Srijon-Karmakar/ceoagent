import { existsSync, readFileSync } from "node:fs";
import { readDoc, writeDoc } from "./storage.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./paths.js";

// Append-only log of every outgoing email (Gmail + SES), oldest first, capped
// at MAX_RECORDS. Stored through storage.ts (Postgres or a JSON file). Lives in the tenant's data dir, so each organization has its own log.
// Read by the /api/sent-emails routes, including the external
// /api/automation/sent-emails endpoint other systems poll.

export type SentEmailChannel = "gmail" | "ses";

export interface SentEmailRecord {
  id: string;
  channel: SentEmailChannel;
  to: string;
  subject: string;
  isHtml: boolean;
  /** First ~300 chars of the body, tags stripped for HTML. */
  preview: string;
  status: "sent" | "failed";
  /** Provider message id on success. */
  messageId?: string;
  error?: string;
  sentAt: string;
}

const PREVIEW_CHARS = 300;
const MAX_RECORDS = 10_000;

function logFile(): string {
  return join(getDataDir(), "sent-emails.json");
}

/** The log, importing the older one-JSON-object-per-line file the first time if that's all there is. */
function loadLog(): SentEmailRecord[] {
  const existing = readDoc<SentEmailRecord[]>(logFile());
  if (existing) return existing;
  const legacy = join(getDataDir(), "sent-emails.jsonl");
  if (!existsSync(legacy)) return [];
  const records: SentEmailRecord[] = [];
  for (const line of readFileSync(legacy, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as SentEmailRecord);
    } catch {
      // skip a corrupt line rather than failing the whole import
    }
  }
  return records;
}

function makePreview(body: string, isHtml: boolean): string {
  const text = isHtml
    ? body.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ")
    : body;
  return text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);
}

export function recordSentEmail(input: {
  channel: SentEmailChannel;
  to: string;
  subject: string;
  body: string;
  isHtml: boolean;
  result: { ok: true; id: string } | { ok: false; error: string };
}): void {
  // Logging must never break a send.
  try {
    const record: SentEmailRecord = {
      id: randomUUID(),
      channel: input.channel,
      to: input.to,
      subject: input.subject,
      isHtml: input.isHtml,
      preview: makePreview(input.body, input.isHtml),
      status: input.result.ok ? "sent" : "failed",
      ...(input.result.ok ? { messageId: input.result.id } : { error: input.result.error }),
      sentAt: new Date().toISOString(),
    };
    const log = loadLog();
    log.push(record);
    writeDoc(logFile(), log.length > MAX_RECORDS ? log.slice(-MAX_RECORDS) : log);
  } catch (err) {
    console.error("[sentEmails] failed to record email:", err);
  }
}

export interface SentEmailQuery {
  since?: string;
  channel?: SentEmailChannel;
  status?: "sent" | "failed";
  limit?: number;
}

/** Newest first. */
export function listSentEmails(query: SentEmailQuery = {}): SentEmailRecord[] {
  const sinceMs = query.since ? Date.parse(query.since) : NaN;
  const records: SentEmailRecord[] = [];
  for (const r of loadLog()) {
    if (!Number.isNaN(sinceMs) && Date.parse(r.sentAt) <= sinceMs) continue;
    if (query.channel && r.channel !== query.channel) continue;
    if (query.status && r.status !== query.status) continue;
    records.push(r);
  }
  records.reverse();
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
  return records.slice(0, limit);
}
