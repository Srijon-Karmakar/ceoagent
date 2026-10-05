/**
 * Manually-maintained $/1K-token pricing for the fallback-provider models
 * used by the CEO/specialist agent loop. Unlike Claude's exact
 * `total_cost_usd` (read straight from the SDK's result message in
 * orchestrator.ts), this is an ESTIMATE — it will silently drift stale if
 * OpenAI/DeepSeek change pricing and needs manual upkeep.
 */
interface ModelPricing {
  inputPer1k: number;
  outputPer1k: number;
}

// Prices as of the ai-sdk/openai and ai-sdk/deepseek versions pinned in
// package.json at the time this was written — re-check platform.openai.com
// and platform.deepseek.com if costs look off.
const PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPer1k: 0.0025, outputPer1k: 0.01 },
  "gpt-4o-mini": { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  "deepseek-chat": { inputPer1k: 0.00027, outputPer1k: 0.0011 },
  "deepseek-reasoner": { inputPer1k: 0.00055, outputPer1k: 0.00219 },
};

const FALLBACK_PRICING: ModelPricing = { inputPer1k: 0.001, outputPer1k: 0.003 };

export function estimateCostUsd(
  provider: "openai" | "deepseek" | "ollama" | "codex",
  model: string,
  usage: { inputTokens?: number; outputTokens?: number },
): number {
  // Ollama runs locally — genuinely $0, regardless of which model name is
  // configured (arbitrary, never in the PRICING table above).
  if (provider === "ollama") return 0;
  const pricing = PRICING[model] ?? FALLBACK_PRICING;
  const inputCost = ((usage.inputTokens ?? 0) / 1000) * pricing.inputPer1k;
  const outputCost = ((usage.outputTokens ?? 0) / 1000) * pricing.outputPer1k;
  return inputCost + outputCost;
}
