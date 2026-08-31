import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, runWithTenant } from "./paths.js";
import { listTenantContexts } from "./server/auth.js";

function dataFile(): string {
  return join(getDataDir(), "schedules.json");
}

/**
 * Structured, not a cron string — mirrors the deliberate "allowlist of named
 * things, never freeform" choice already made in tools/n8n.ts. This keeps an
 * LLM (the Calendar agent) from ever having to generate cron syntax, and
 * keeps "is this due today" a plain Date comparison, no cron parser needed.
 */
export type Recurrence =
  | { type: "once"; date: string } // YYYY-MM-DD
  | { type: "daily"; startDate: string; endDate?: string }
  | { type: "weekly"; weekdays: number[]; startDate: string; endDate?: string }; // 0=Sun..6=Sat

export interface ScheduleRecord {
  id: string;
  label: string;
  goal: string;
  /** "ceo" or a specialist key (including "calendar" itself). */
  agentKey: string;
  recurrence: Recurrence;
  /** "HH:MM", 24h, server-local. */
  time: string;
  enabled: boolean;
  createdAt: string;
  /** YYYY-MM-DD of the last occurrence actually fired — prevents double-fire
   * within the same day and drives simple restart catch-up (see tick()). */
  lastFiredDate?: string;
  lastRunId?: string;
}

const stores = new Map<string, Map<string, ScheduleRecord>>();

function getStore(): Map<string, ScheduleRecord> {
  const file = dataFile();
  const existing = stores.get(file);
  if (existing) return existing;
  const schedules = new Map<string, ScheduleRecord>();
  if (existsSync(file)) {
    const raw: ScheduleRecord[] = JSON.parse(readFileSync(file, "utf-8"));
    for (const s of raw) schedules.set(s.id, s);
  }
  stores.set(file, schedules);
  return schedules;
}

function persist() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(dataFile(), JSON.stringify([...getStore().values()], null, 2));
}

export interface CreateScheduleInput {
  label: string;
  goal: string;
  agentKey: string;
  recurrence: Recurrence;
  time: string;
}

export function createSchedule(input: CreateScheduleInput): ScheduleRecord {
  const record: ScheduleRecord = {
    id: randomUUID(),
    label: input.label,
    goal: input.goal,
    agentKey: input.agentKey,
    recurrence: input.recurrence,
    time: input.time,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  getStore().set(record.id, record);
  persist();
  return record;
}

export function listSchedules(): ScheduleRecord[] {
  return [...getStore().values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getSchedule(id: string): ScheduleRecord | undefined {
  return getStore().get(id);
}

export type ScheduleUpdate = Partial<Pick<ScheduleRecord, "label" | "goal" | "agentKey" | "recurrence" | "time" | "enabled">>;

export function updateSchedule(id: string, patch: ScheduleUpdate): ScheduleRecord | undefined {
  const record = getStore().get(id);
  if (!record) return undefined;
  Object.assign(record, patch);
  persist();
  return record;
}

export function deleteSchedule(id: string): boolean {
  const schedules = getStore();
  if (!schedules.has(id)) return false;
  schedules.delete(id);
  persist();
  return true;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isWithinRange(todayStr: string, startDate: string, endDate: string | undefined): boolean {
  if (todayStr < startDate) return false;
  if (endDate && todayStr > endDate) return false;
  return true;
}

function isDueToday(recurrence: Recurrence, now: Date, todayStr: string): boolean {
  if (recurrence.type === "once") return recurrence.date === todayStr;
  if (recurrence.type === "daily") return isWithinRange(todayStr, recurrence.startDate, recurrence.endDate);
  // weekly
  return isWithinRange(todayStr, recurrence.startDate, recurrence.endDate) && recurrence.weekdays.includes(now.getDay());
}

function isPastFireTime(time: string, now: Date): boolean {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
}

/**
 * Injected by initScheduler() rather than statically imported — this module
 * would otherwise have to import server/runRunner.ts, which imports
 * orchestrator.ts, which (via agents.ts / tools/scheduler.ts) imports back
 * into this module to register the scheduler MCP server. Dependency
 * injection from index.ts (which sits outside that cycle) breaks it.
 */
interface RunStarters {
  startCeoRun: (displayGoal: string, promptText: string) => { id: string };
  startSpecialistRun: (agentKey: string, displayGoal: string, promptText: string) => { id: string };
}

let runStarters: RunStarters | null = null;

/**
 * One tick: fires every enabled schedule that's due today, hasn't already
 * fired today, and whose time-of-day has passed. `lastFiredDate` only ever
 * advances to "today", so a schedule missed while the server was down fires
 * exactly once on the next tick after restart — never a backlog of repeats.
 */
function tick() {
  if (!runStarters) return;
  const now = new Date();
  const todayStr = todayKey(now);
  for (const schedule of getStore().values()) {
    if (!schedule.enabled) continue;
    if (schedule.lastFiredDate === todayStr) continue;
    if (!isDueToday(schedule.recurrence, now, todayStr)) continue;
    if (!isPastFireTime(schedule.time, now)) continue;

    const displayGoal = `[Scheduled: ${schedule.label}] ${schedule.goal}`;
    const record =
      schedule.agentKey === "ceo"
        ? runStarters.startCeoRun(displayGoal, schedule.goal)
        : runStarters.startSpecialistRun(schedule.agentKey, displayGoal, schedule.goal);

    schedule.lastFiredDate = todayStr;
    schedule.lastRunId = record.id;
    if (schedule.recurrence.type === "once") schedule.enabled = false;
    persist();
  }
}

const TICK_INTERVAL_MS = 60_000;
let ticking = false;

/** Call once at server startup. Idempotent — a second call is a no-op. */
export function initScheduler(starters: RunStarters) {
  if (ticking) return;
  ticking = true;
  runStarters = starters;
  const tickAllTenants = () => {
    for (const tenant of listTenantContexts()) runWithTenant(tenant, tick);
  };
  tickAllTenants(); // immediate check covers anything due right at/just after startup, and restart catch-up
  setInterval(tickAllTenants, TICK_INTERVAL_MS);
}
