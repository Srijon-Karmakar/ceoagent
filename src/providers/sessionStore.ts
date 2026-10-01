import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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

export type FallbackProviderName = "openai" | "deepseek" | "ollama";

const SESSION_PREFIX = "fallback:";

export function makeSessionId(provider: FallbackProviderName): string {
  return `${SESSION_PREFIX}${provider}:${randomUUID()}`;
}

export function parseSessionId(sessionId: string): { provider: FallbackProviderName } | undefined {
  if (!sessionId.startsWith(SESSION_PREFIX)) return undefined;
  const [, provider] = sessionId.split(":");
  if (provider !== "openai" && provider !== "deepseek" && provider !== "ollama") return undefined;
  return { provider };
}

type SessionFile = Record<string, ModelMessage[]>;

function sessionsFile(): string {
  return join(getDataDir(), "fallbackSessions.json");
}

let cache: SessionFile | undefined;

function load(): SessionFile {
  if (cache) return cache;
  const file = sessionsFile();
  if (!existsSync(file)) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    cache = {};
  }
  return cache!;
}

function persist() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(sessionsFile(), JSON.stringify(load(), null, 2));
}

export function getSessionMessages(sessionId: string): ModelMessage[] {
  return load()[sessionId] ?? [];
}

export function saveSessionMessages(sessionId: string, messages: ModelMessage[]) {
  load()[sessionId] = messages;
  persist();
}
