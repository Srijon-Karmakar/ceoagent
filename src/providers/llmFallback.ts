import { runCeoAgent, runSpecialistAgent, type RunEvent, type RunSource } from "../orchestrator.js";
import { runCeoAgentFallback, runSpecialistAgentFallback, isFallbackProviderConfigured, type FallbackRunResult } from "./fallbackAgent.js";
import {
  isClaudeExhaustionThrow,
  isClaudeExhaustionResult,
  isOpenAiExhaustionError,
  isDeepSeekExhaustionError,
  isOllamaExhaustionError,
} from "./exhaustionClassifier.js";
import { parseSessionId, type FallbackProviderName } from "./sessionStore.js";

export type ProviderName = "claude" | FallbackProviderName;
/** "auto" = today's cascade behavior; anything else is a manual, no-fallback pin to that one provider. */
export type LlmProviderChoice = "auto" | ProviderName;

export const PROVIDER_ORDER: ProviderName[] = ["claude", "openai", "deepseek", "ollama"];
export const PROVIDER_LABELS: Record<ProviderName, string> = {
  claude: "Claude",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  ollama: "Ollama (local)",
};

export function isValidProviderChoice(value: string): value is LlmProviderChoice {
  return value === "auto" || PROVIDER_ORDER.includes(value as ProviderName);
}

function isExhaustionError(provider: ProviderName, err: unknown): boolean {
  if (provider === "claude") return isClaudeExhaustionThrow(err);
  if (provider === "openai") return isOpenAiExhaustionError(err);
  if (provider === "deepseek") return isDeepSeekExhaustionError(err);
  return isOllamaExhaustionError(err);
}

function isConfigured(provider: ProviderName): boolean {
  return provider === "claude" || isFallbackProviderConfigured(provider);
}

interface RunWithFallbackOpts {
  source: RunSource;
  resumeSessionId?: string;
  onEvent: (event: RunEvent) => void;
  run: (provider: ProviderName, resumeSessionId?: string) => Promise<FallbackRunResult>;
  /** A specific provider the user picked from the model dropdown — no cascade, no fallback if it fails. Omit/undefined for today's automatic cascade. */
  forcedProvider?: ProviderName;
}

/**
 * Tries Claude -> OpenAI -> DeepSeek -> Ollama in order, cascading to the
 * next provider only on a classified exhaustion error (rate limit, quota,
 * billing, auth failure, overload) — a non-exhaustion error (a malformed
 * request, an unsupported model) is surfaced immediately instead of being
 * masked by a confusing provider switch. Stateless: every fresh run starts
 * back at Claude, so the app self-heals once Claude recovers rather than
 * needing a manual reset. Resuming an existing fallback-provider session
 * (sessionId prefixed "fallback:<provider>:") skips straight to that one
 * provider — cross-provider context transplant isn't attempted, so a
 * mid-conversation cascade means a reply starts a fresh conversation on
 * whichever provider picks it up.
 *
 * When `forcedProvider` is set (the user picked a specific model from the
 * dropdown instead of "Auto"), all of that is bypassed: only that one
 * provider is tried, and any failure — exhaustion or not — surfaces
 * directly, since a deliberate model pick shouldn't silently run on a
 * different model than the one chosen.
 */
async function runWithFallback(opts: RunWithFallbackOpts): Promise<FallbackRunResult> {
  if (opts.forcedProvider) {
    if (!isConfigured(opts.forcedProvider)) {
      throw new Error(`${PROVIDER_LABELS[opts.forcedProvider]} is not configured.`);
    }
    return opts.run(opts.forcedProvider, opts.resumeSessionId);
  }

  const resumedProvider = opts.resumeSessionId ? parseSessionId(opts.resumeSessionId)?.provider : undefined;
  const order: ProviderName[] = resumedProvider ? [resumedProvider] : PROVIDER_ORDER;

  const emitSwitch = (provider: ProviderName, message: string) => {
    const next = PROVIDER_ORDER[PROVIDER_ORDER.indexOf(provider) + 1];
    if (next && !resumedProvider) {
      opts.onEvent({
        type: "text",
        source: opts.source,
        text: `${PROVIDER_LABELS[provider]} is unavailable right now (${message}) — switching to ${PROVIDER_LABELS[next]}.`,
        ts: new Date().toISOString(),
      });
    }
  };

  const errors: string[] = [];
  for (const provider of order) {
    if (!isConfigured(provider)) {
      errors.push(`${PROVIDER_LABELS[provider]}: not configured`);
      continue;
    }
    try {
      const result = await opts.run(provider, opts.resumeSessionId);
      // Claude's SDK can end a stream with a graceful `result: error` message
      // (drainQuery returns it, doesn't throw) — e.g. a mid-stream rate-limit
      // or billing failure that isn't a pre-stream rejection. Without this
      // check, that case would return an unrecovered failure straight to the
      // caller instead of cascading, even though it's exactly the kind of
      // exhaustion the chain exists to route around. Fallback providers
      // (OpenAI/DeepSeek/Ollama) never return gracefully on error — see
      // fallbackAgent.ts, they always throw — so this only applies to Claude.
      if (provider === "claude" && result.status === "error" && isClaudeExhaustionResult([result.summary ?? ""])) {
        const message = result.summary ?? "unknown error";
        errors.push(`${PROVIDER_LABELS[provider]}: ${message}`);
        emitSwitch(provider, message);
        continue;
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isExhaustionError(provider, err)) throw err;
      errors.push(`${PROVIDER_LABELS[provider]}: ${message}`);
      emitSwitch(provider, message);
    }
  }
  throw new Error(`All LLM providers are currently unavailable:\n${errors.join("\n")}`);
}

export function runCeoAgentWithFallback(
  goal: string,
  onEvent: (event: RunEvent) => void,
  resumeSessionId?: string,
  provider: LlmProviderChoice = "auto",
): Promise<FallbackRunResult> {
  return runWithFallback({
    source: "ceo",
    resumeSessionId,
    onEvent,
    forcedProvider: provider === "auto" ? undefined : provider,
    run: (p, resume) => (p === "claude" ? runCeoAgent(goal, onEvent, resume) : runCeoAgentFallback(p, goal, onEvent, resume)),
  });
}

export function runSpecialistAgentWithFallback(
  agentKey: string,
  goal: string,
  onEvent: (event: RunEvent) => void,
  resumeSessionId?: string,
  provider: LlmProviderChoice = "auto",
): Promise<FallbackRunResult> {
  return runWithFallback({
    source: agentKey,
    resumeSessionId,
    onEvent,
    forcedProvider: provider === "auto" ? undefined : provider,
    run: (p, resume) =>
      p === "claude"
        ? runSpecialistAgent(agentKey, goal, onEvent, resume)
        : runSpecialistAgentFallback(p, agentKey, goal, onEvent, resume),
  });
}
