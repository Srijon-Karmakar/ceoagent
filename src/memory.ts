import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { readDoc, writeDoc, docExists, deleteDoc } from "./storage.js";
import { join } from "node:path";
import { getDataDir } from "./paths.js";

/**
 * The system's permanent, cross-agent memory — a flat list of durable facts
 * fed in by the user (via the Memory department's chat, or added directly
 * from the Browse view) that every agent can read for context. Deliberately
 * simple (one JSON array, no embeddings/vector search) to stay "optimized"
 * per the product ask — an agent's own reasoning over a few dozen/hundred
 * short entries is enough at this scale, and adding real semantic search
 * later is a additive change, not a rewrite.
 */

function memoryFile(): string {
  return join(getDataDir(), "memory.json");
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  owner: "agent" | "manual";
  /** Set when owner === "agent" — always "memory" today, kept for parity with Portfolio's shape in case another writer is added later. */
  agentKey?: string;
  source: "chat" | "file" | "manual";
  /** Original filename, when source === "file" (the file's extracted text becomes `content`). */
  sourceFilename?: string;
  createdAt: string;
  updatedAt: string;
}

const memoryStores = new Map<string, Map<string, MemoryEntry>>();

function getMemoryStore(): Map<string, MemoryEntry> {
  const file = memoryFile();
  const existing = memoryStores.get(file);
  if (existing) return existing;
  const entries = new Map<string, MemoryEntry>();
  if (docExists(file)) {
    const raw: MemoryEntry[] = readDoc(file)!;
    for (const e of raw) entries.set(e.id, e);
  }
  memoryStores.set(file, entries);
  return entries;
}

function persistMemory() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeDoc(memoryFile(), [...getMemoryStore().values()]);
}

export interface CreateMemoryEntryInput {
  title: string;
  content: string;
  owner: "agent" | "manual";
  agentKey?: string;
  source: "chat" | "file" | "manual";
  sourceFilename?: string;
}

export function createMemoryEntry(input: CreateMemoryEntryInput): MemoryEntry {
  const now = new Date().toISOString();
  const record: MemoryEntry = {
    id: randomUUID(),
    title: input.title,
    content: input.content,
    owner: input.owner,
    agentKey: input.agentKey,
    source: input.source,
    sourceFilename: input.sourceFilename,
    createdAt: now,
    updatedAt: now,
  };
  getMemoryStore().set(record.id, record);
  persistMemory();
  return record;
}

export function listMemoryEntries(filter: { query?: string } = {}): MemoryEntry[] {
  let all = [...getMemoryStore().values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (filter.query) {
    const q = filter.query.toLowerCase();
    all = all.filter((e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  }
  return all;
}

export function getMemoryEntry(id: string): MemoryEntry | undefined {
  return getMemoryStore().get(id);
}

export type MemoryEntryUpdate = Partial<Pick<MemoryEntry, "title" | "content">>;

export function updateMemoryEntry(id: string, patch: MemoryEntryUpdate): MemoryEntry | undefined {
  const record = getMemoryStore().get(id);
  if (!record) return undefined;
  Object.assign(record, patch);
  record.updatedAt = new Date().toISOString();
  persistMemory();
  return record;
}

export function deleteMemoryEntry(id: string): boolean {
  const entries = getMemoryStore();
  if (!entries.has(id)) return false;
  entries.delete(id);
  persistMemory();
  return true;
}
