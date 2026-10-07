import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { readDoc, writeDoc, docExists, deleteDoc } from "../storage.js";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { getDataDir } from "../paths.js";

/**
 * Persists conversation history for the OpenAI/DeepSeek fallback path, since
 * those providers have no SDK-native equivalent of Claude Agent SDK's
 * `resume: sessionId`. Keyed by a synthetic id (see makeSessionId below) so
 * it's unambiguous which provider a given sessionId belongs to — the rest of
 * the app (runRunner.ts, store.ts, the reply API) only ever treats sessionId
 * as an opaque string, so this distinction only matters inside
 * llmFallback.ts/fallbackAgent.ts. Mirrors src/server/store.ts's own
 * file-backed persistence pattern (its own file, not shared with runs.json).
 */

export type FallbackProviderName = "openai" | "deepseek" | "ollama" | "codex";

const SESSION_PREFIX = "fallback:";
const FALLBACK_PROVIDERS = new Set<FallbackProviderName>(["openai", "deepseek", "ollama", "codex"]);

export function makeSessionId(provider: FallbackProviderName): string {
  return `${SESSION_PREFIX}${provider}:${randomUUID()}`;
}

export function parseSessionId(sessionId: string): { provider: FallbackProviderName } | undefined {
  if (!sessionId.startsWith(SESSION_PREFIX)) return undefined;
  const [, provider] = sessionId.split(":");
  if (!FALLBACK_PROVIDERS.has(provider as FallbackProviderName)) return undefined;
  return { provider: provider as FallbackProviderName };
}

type SessionFile = Record<string, ModelMessage[]>;

function sessionsFile(): string {
  return join(getDataDir(), "fallbackSessions.json");
}

let cache: SessionFile | undefined;

function load(): SessionFile {
  if (cache) return cache;
  const file = sessionsFile();
  if (!docExists(file)) {
    cache = {};
    return cache;
  }
  try {
    cache = readDoc(file)!;
  } catch {
    cache = {};
  }
  return cache!;
}

function persist() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeDoc(sessionsFile(), load());
}

export function getSessionMessages(sessionId: string): ModelMessage[] {
  return load()[sessionId] ?? [];
}

export function saveSessionMessages(sessionId: string, messages: ModelMessage[]) {
  load()[sessionId] = messages;
  persist();
}

/**
 * Codex has no SDK-native equivalent of a replayable `ModelMessage[]`
 * conversation — it persists its own thread state under `~/.codex/sessions`,
 * resumed by `threadId` alone (see codexAgent.ts). This just remembers which
 * threadId our own opaque `sessionId` maps to, in its own file so the
 * `ModelMessage[]`-shaped `SessionFile` above stays untouched.
 */
type CodexThreadFile = Record<string, string>;

function codexThreadsFile(): string {
  return join(getDataDir(), "codexThreads.json");
}

let codexThreadCache: CodexThreadFile | undefined;

function loadCodexThreads(): CodexThreadFile {
  if (codexThreadCache) return codexThreadCache;
  const file = codexThreadsFile();
  if (!docExists(file)) {
    codexThreadCache = {};
    return codexThreadCache;
  }
  try {
    codexThreadCache = readDoc(file)!;
  } catch {
    codexThreadCache = {};
  }
  return codexThreadCache!;
}

function persistCodexThreads() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeDoc(codexThreadsFile(), loadCodexThreads());
}

export function getCodexThreadId(sessionId: string): string | undefined {
  return loadCodexThreads()[sessionId];
}

export function saveCodexThreadId(sessionId: string, threadId: string) {
  loadCodexThreads()[sessionId] = threadId;
  persistCodexThreads();
}
