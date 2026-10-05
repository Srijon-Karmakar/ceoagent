import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent, LinearTaskRef } from "../orchestrator.js";
import type { LlmProviderChoice } from "../providers/llmFallback.js";
import { getDataDir } from "../paths.js";

export interface RunRecord {
  id: string;
  goal: string;
  /** "ceo" for a run through the CEO overview (which may delegate to any number of
   * specialists), or a specific department key for a direct "ask this agent" run. */
  agentKey: string;
  status: "running" | "success" | "error";
  createdAt: string;
  finishedAt?: string;
  costUsd?: number;
  summary?: string;
  events: RunEvent[];
  linearTasks: LinearTaskRef[];
  /** Claude Agent SDK session ID, once known — lets a finished run be
   * resumed later via a reply instead of starting a fresh, context-less run. */
  sessionId?: string;
  /** Hidden from the default task list but not deleted — distinct from
   * `status`, which tracks execution outcome rather than visibility. */
  archived?: boolean;
  /** Pinned tasks float to the top of the task list regardless of recency. */
  pinned?: boolean;
  /** Which LLM this run was pinned to from the model dropdown, or "auto" for
   * the Claude -> OpenAI -> DeepSeek -> Ollama cascade. Persisted so a reply
   * continues on the same provider the original run used — undefined on
   * records created before this field existed, treated as "auto". */
  provider?: LlmProviderChoice;
}

interface RunStore {
  runs: Map<string, RunRecord>;
  emitters: Map<string, EventEmitter>;
  /** One AbortController per in-flight run, created alongside its emitter in
   * createRun/reopenRun and torn down in finishRun — lets cancelRun() signal
   * the actual provider call (Claude's subprocess, the AI SDK's fetch, the
   * Codex CLI's subprocess) to stop early, not just hide the run in the UI. */
  controllers: Map<string, AbortController>;
}

const stores = new Map<string, RunStore>();

function dataFile(): string {
  return join(getDataDir(), "runs.json");
}

function getStore(): RunStore {
  const file = dataFile();
  const existing = stores.get(file);
  if (existing) return existing;
  const store: RunStore = { runs: new Map(), emitters: new Map(), controllers: new Map() };
  if (existsSync(file)) {
    const raw: RunRecord[] = JSON.parse(readFileSync(file, "utf-8"));
    for (const r of raw) {
      if (r.status === "running") r.status = "error";
      store.runs.set(r.id, r);
    }
  }
  stores.set(file, store);
  return store;
}

function persist() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(dataFile(), JSON.stringify([...getStore().runs.values()], null, 2));
}

export function createRun(goal: string, agentKey: string, provider: LlmProviderChoice = "auto"): RunRecord {
  const record: RunRecord = {
    id: randomUUID(),
    goal,
    agentKey,
    status: "running",
    createdAt: new Date().toISOString(),
    events: [],
    linearTasks: [],
    provider,
  };
  const store = getStore();
  store.runs.set(record.id, record);
  store.emitters.set(record.id, new EventEmitter().setMaxListeners(50));
  store.controllers.set(record.id, new AbortController());
  persist();
  return record;
}

/** The AbortController for a run's current turn — undefined once the run has finished (see finishRun). */
export function getRunController(id: string): AbortController | undefined {
  return getStore().controllers.get(id);
}

/**
 * Signals the run's AbortController so the underlying provider call (Claude's
 * subprocess via query()'s abortController option, the AI SDK's fetch via
 * abortSignal, the Codex CLI's subprocess via spawn's signal option) stops
 * early. Does not itself change the record's status/events — runRunner.ts's
 * startRun already reacts to the controller's `aborted` flag once the
 * aborted run() promise settles, and appends the terminal "done" event from
 * there, same as any other outcome.
 */
export function cancelRun(id: string): boolean {
  const record = getStore().runs.get(id);
  if (!record || record.status !== "running") return false;
  const controller = getStore().controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * Records a message from the agent run and notifies live subscribers.
 *
 * IMPORTANT: a "done" event marks the end of one agentic *turn*, not
 * necessarily the end of the run — the CEO agent can end its turn while a
 * subagent it spawned (e.g. the manager) keeps working in the background and
 * reports back later, producing a further "done" once that settles. Do not
 * treat "done" as run-terminal here; that's what `finishRun` is for, called
 * only once the orchestrator's async generator has fully drained.
 */
export function appendEvent(id: string, event: RunEvent) {
  const { runs, emitters } = getStore();
  const record = runs.get(id);
  if (!record) return;
  record.events.push(event);
  persist();
  emitters.get(id)?.emit("event", event);
}

/**
 * Marks a run as truly finished — call this only after runCeoAgent's promise
 * resolves (or rejects), i.e. the whole run including any backgrounded
 * subagent work has settled. Derives final status/summary from the last
 * "done" event recorded (cost is summed across ALL "done" events, so a
 * run that's been continued via replies reports its true total rather than
 * just the latest turn), and closes out any live SSE subscribers.
 */
export function finishRun(id: string) {
  const { runs, emitters, controllers } = getStore();
  const record = runs.get(id);
  if (!record) return;
  const doneEvents = record.events.filter((e): e is Extract<RunEvent, { type: "done" }> => e.type === "done");
  const lastDone = doneEvents[doneEvents.length - 1];
  if (lastDone) {
    record.status = lastDone.status;
    record.finishedAt = lastDone.ts;
    record.costUsd = doneEvents.reduce((sum, e) => sum + e.costUsd, 0);
    record.summary = lastDone.status === "success" ? lastDone.summary : lastDone.error;
  } else {
    record.status = "error";
    record.finishedAt = new Date().toISOString();
    record.summary = "Run ended without a result.";
  }
  persist();
  emitters.get(id)?.emit("close", record);
  emitters.delete(id);
  controllers.delete(id);
}

export function setLinearTasks(id: string, tasks: LinearTaskRef[]) {
  const record = getStore().runs.get(id);
  if (!record) return;
  record.linearTasks = tasks;
  persist();
}

export function setSessionId(id: string, sessionId: string | undefined) {
  if (!sessionId) return;
  const record = getStore().runs.get(id);
  if (!record) return;
  record.sessionId = sessionId;
  persist();
}

/**
 * Re-opens an already-finished run so a reply can continue it in place —
 * same run record, same id, same event log, just resumed rather than
 * starting a fresh context-less run. Recreates the emitter finishRun tore
 * down, so the run can stream and be finished again normally.
 */
export function reopenRun(id: string): boolean {
  const { runs, emitters, controllers } = getStore();
  const record = runs.get(id);
  if (!record) return false;
  record.status = "running";
  emitters.set(id, new EventEmitter().setMaxListeners(50));
  controllers.set(id, new AbortController());
  persist();
  return true;
}

export function archiveRun(id: string): boolean {
  const record = getStore().runs.get(id);
  if (!record) return false;
  record.archived = true;
  persist();
  return true;
}

export function unarchiveRun(id: string): boolean {
  const record = getStore().runs.get(id);
  if (!record) return false;
  record.archived = false;
  persist();
  return true;
}

export function pinRun(id: string): boolean {
  const record = getStore().runs.get(id);
  if (!record) return false;
  record.pinned = true;
  persist();
  return true;
}

export function unpinRun(id: string): boolean {
  const record = getStore().runs.get(id);
  if (!record) return false;
  record.pinned = false;
  persist();
  return true;
}

/** Hard delete — removes the record entirely, including its transcript and
 * cost history, and cannot be undone (callers should confirm with the user
 * first). Distinct from archiveRun, which only hides a run reversibly. */
export function deleteRun(id: string): boolean {
  const { runs, emitters, controllers } = getStore();
  if (!runs.has(id)) return false;
  runs.delete(id);
  emitters.get(id)?.removeAllListeners();
  emitters.delete(id);
  controllers.delete(id);
  persist();
  return true;
}

export function getRun(id: string): RunRecord | undefined {
  return getStore().runs.get(id);
}

export function listRuns(): RunRecord[] {
  return [...getStore().runs.values()].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Runs relevant to one department: either run directly against it, or a CEO
 * run that delegated to it at some point (detected from event sources).
 */
export function listRunsFor(agentKey: string): RunRecord[] {
  return listRuns().filter(
    (r) => r.agentKey === agentKey || r.events.some((e) => "source" in e && e.source === agentKey),
  );
}

export function subscribe(
  id: string,
  onEvent: (e: RunEvent) => void,
  onClose: (finalRecord: RunRecord) => void,
) {
  const emitter = getStore().emitters.get(id);
  if (!emitter) return () => {};
  emitter.on("event", onEvent);
  emitter.on("close", onClose);
  return () => {
    emitter.off("event", onEvent);
    emitter.off("close", onClose);
  };
}
