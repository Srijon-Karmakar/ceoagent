import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./paths.js";

function projectsFile(): string {
  return join(getDataDir(), "portfolio-projects.json");
}

function entriesFile(): string {
  return join(getDataDir(), "portfolio-entries.json");
}

export interface PortfolioProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type PortfolioCategory = "blog" | "article" | "collab" | "pr-post" | "email";

export const PORTFOLIO_CATEGORIES: PortfolioCategory[] = ["blog", "article", "collab", "pr-post", "email"];

export type PortfolioEntryStatus = "draft" | "published";

export const PORTFOLIO_ENTRY_STATUSES: PortfolioEntryStatus[] = ["draft", "published"];

export interface PortfolioEntry {
  id: string;
  projectId: string;
  category: PortfolioCategory;
  title: string;
  link?: string;
  status: PortfolioEntryStatus;
  /** ISO date (YYYY-MM-DD), e.g. a publish date. */
  date?: string;
  notes?: string;
  owner: "agent" | "manual";
  /** Which agent created/last touched it, when owner === "agent" — e.g. "sales", "seo", "aeo", "pr", "emails". */
  agentKey?: string;
  createdAt: string;
  updatedAt: string;
}

const projectStores = new Map<string, Map<string, PortfolioProject>>();
const entryStores = new Map<string, Map<string, PortfolioEntry>>();

function getProjectStore(): Map<string, PortfolioProject> {
  const file = projectsFile();
  const existing = projectStores.get(file);
  if (existing) return existing;
  const projects = new Map<string, PortfolioProject>();
  if (existsSync(file)) {
    const raw: PortfolioProject[] = JSON.parse(readFileSync(file, "utf-8"));
    for (const p of raw) projects.set(p.id, p);
  }
  projectStores.set(file, projects);
  return projects;
}

function persistProjects() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(projectsFile(), JSON.stringify([...getProjectStore().values()], null, 2));
}

function getEntryStore(): Map<string, PortfolioEntry> {
  const file = entriesFile();
  const existing = entryStores.get(file);
  if (existing) return existing;
  const entries = new Map<string, PortfolioEntry>();
  if (existsSync(file)) {
    const raw: PortfolioEntry[] = JSON.parse(readFileSync(file, "utf-8"));
    for (const e of raw) entries.set(e.id, e);
  }
  entryStores.set(file, entries);
  return entries;
}

function persistEntries() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(entriesFile(), JSON.stringify([...getEntryStore().values()], null, 2));
}

export function createProject(name: string): PortfolioProject {
  const now = new Date().toISOString();
  const record: PortfolioProject = { id: randomUUID(), name, createdAt: now, updatedAt: now };
  getProjectStore().set(record.id, record);
  persistProjects();
  return record;
}

export function listProjects(): PortfolioProject[] {
  return [...getProjectStore().values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getProject(id: string): PortfolioProject | undefined {
  return getProjectStore().get(id);
}

export function renameProject(id: string, name: string): PortfolioProject | undefined {
  const record = getProjectStore().get(id);
  if (!record) return undefined;
  record.name = name;
  record.updatedAt = new Date().toISOString();
  persistProjects();
  return record;
}

export function deleteProject(id: string): boolean {
  const projects = getProjectStore();
  if (!projects.has(id)) return false;
  projects.delete(id);
  persistProjects();
  deleteEntriesByProject(id);
  return true;
}

export interface CreatePortfolioEntryInput {
  projectId: string;
  category: PortfolioCategory;
  title: string;
  link?: string;
  status?: PortfolioEntryStatus;
  date?: string;
  notes?: string;
  owner: "agent" | "manual";
  agentKey?: string;
}

export function createEntry(input: CreatePortfolioEntryInput): PortfolioEntry {
  const now = new Date().toISOString();
  const record: PortfolioEntry = {
    id: randomUUID(),
    projectId: input.projectId,
    category: input.category,
    title: input.title,
    link: input.link,
    status: input.status ?? "draft",
    date: input.date,
    notes: input.notes,
    owner: input.owner,
    agentKey: input.agentKey,
    createdAt: now,
    updatedAt: now,
  };
  getEntryStore().set(record.id, record);
  persistEntries();
  return record;
}

export function listEntries(filter: { projectId?: string; category?: PortfolioCategory } = {}): PortfolioEntry[] {
  let all = [...getEntryStore().values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter.projectId) all = all.filter((e) => e.projectId === filter.projectId);
  if (filter.category) all = all.filter((e) => e.category === filter.category);
  return all;
}

export function getEntry(id: string): PortfolioEntry | undefined {
  return getEntryStore().get(id);
}

export type PortfolioEntryUpdate = Partial<
  Pick<PortfolioEntry, "projectId" | "category" | "title" | "link" | "status" | "date" | "notes">
>;

export function updateEntry(id: string, patch: PortfolioEntryUpdate): PortfolioEntry | undefined {
  const record = getEntryStore().get(id);
  if (!record) return undefined;
  Object.assign(record, patch);
  record.updatedAt = new Date().toISOString();
  persistEntries();
  return record;
}

export function deleteEntry(id: string): boolean {
  const entries = getEntryStore();
  if (!entries.has(id)) return false;
  entries.delete(id);
  persistEntries();
  return true;
}

function deleteEntriesByProject(projectId: string) {
  const entries = getEntryStore();
  let changed = false;
  for (const [id, entry] of entries) {
    if (entry.projectId === projectId) {
      entries.delete(id);
      changed = true;
    }
  }
  if (changed) persistEntries();
}
