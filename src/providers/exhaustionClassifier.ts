import { APICallError } from "ai";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Claude Agent SDK error codes that mean "this provider is unavailable right
 * now" — worth cascading to the next provider — vs. codes that mean "this
 * specific request is broken" (a different provider won't fix a malformed
 * request or a token-limit hit, so those are surfaced as real errors
 * instead of being masked by a confusing provider switch).
 */
const CLAUDE_EXHAUSTION_CODES = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
  "billing_error",
  "rate_limit",
  "overloaded",
  "server_error",
]);

/**
 * Structured signal check for messages that already made it into the SDK's
 * AsyncIterable<SDKMessage> stream — reliable, no string-matching needed.
 * Checks assistant messages carrying an `error` code and `api_retry` system
 * messages (emitted while the SDK is already retrying a retryable failure).
 */
export function isClaudeExhaustionMessage(message: SDKMessage): boolean {
  if (message.type === "assistant" && message.error) {
    return CLAUDE_EXHAUSTION_CODES.has(message.error);
  }
  if (message.type === "system" && (message as { subtype?: string }).subtype === "api_retry") {
    const retry = message as unknown as { error?: string };
    return !!retry.error && CLAUDE_EXHAUSTION_CODES.has(retry.error);
  }
  return false;
}

/**
 * String-matching fallback for failures that never reach a typed SDKMessage
 * at all — e.g. `query()`'s returned iterable rejecting before any message
 * arrives. This is exactly the "OAuth session expired and could not be
 * refreshed" case (comes from the bundled claude.exe binary's stderr, not
 * a structured API error) plus generic auth/rate-limit/network phrasing.
 */
export function isClaudeExhaustionThrow(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /oauth session expired|failed to authenticate|rate.?limit|429|insufficient_quota|overloaded|credit balance|billing/i.test(
    message,
  );
}

/**
 * A `SDKResultError` (the terminal "result" message when a run ends in
 * failure) doesn't carry a per-code error like assistant messages do — only
 * a human-readable `errors: string[]`. Same string-matching approach as the
 * pre-stream case above, applied to that joined text.
 */
export function isClaudeExhaustionResult(errors: string[]): boolean {
  return isClaudeExhaustionThrow(new Error(errors.join("; ")));
}

function isOpenAiCompatibleExhaustion(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    // 402 Payment Required is DeepSeek's real status for "Insufficient
    // Balance" — found via a live fault-injection test where this classifier
    // originally missed it and let the error crash the run instead of
    // cascading to the next provider.
    if (err.statusCode === 429 || err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 402) return true;
    if (err.isRetryable) return true;
    if (err.responseBody && /insufficient|balance|quota|credit|rate.?limit|billing/i.test(err.responseBody)) return true;
    return false;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b|\b402\b|insufficient|balance|quota|credit|rate.?limit|unauthorized|billing/i.test(message);
}

export function isOpenAiExhaustionError(err: unknown): boolean {
  return isOpenAiCompatibleExhaustion(err);
}

export function isDeepSeekExhaustionError(err: unknown): boolean {
  return isOpenAiCompatibleExhaustion(err);
}

/**
 * Codex (the `codex` CLI subprocess spawned by @openai/codex-sdk) never
 * surfaces a structured error type to this app — failures arrive as a plain
 * thrown Error (a non-zero exit from the CLI, or a `turn.failed` event's
 * message, see codexAgent.ts). Same string-matching approach as Claude's
 * throw-path classifier above: auth/login expiry, rate limits, and quota/
 * billing phrasing all mean "unavailable right now," not "this request is
 * broken," so they're worth cascading away from.
 */
export function isCodexExhaustionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not logged in|run codex login|authenticat|unauthorized|401|429|rate.?limit|insufficient_quota|quota|usage limit|credit balance|billing/i.test(
    message,
  );
}

/**
 * Ollama is the last link in the chain and has no billing/rate-limit concept
 * of its own — any failure here (not running, model not pulled, connection
 * refused, out of memory) just means "this local instance can't serve the
 * request right now," so it's classified broadly rather than narrowly like
 * the paid providers above: there's nothing after it to wrongly mask a real
 * error by cascading into.
 */
export function isOllamaExhaustionError(_err: unknown): boolean {
  return true;
}
