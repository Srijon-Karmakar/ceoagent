import { generateText, stepCountIs, tool as aiTool, type LanguageModel, type ModelMessage, type Tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { z } from "zod";
import { getEnvValue } from "../server/settings.js";
import { DEPARTMENTS, buildAgentsRegistry } from "../agents.js";
import { DEVELOPER_INFO_BLOCK } from "../developer/index.js";
import { extractLinearTask, type RunEvent, type RunSource, type LinearTaskRef } from "../orchestrator.js";
import { toAiSdkTools, type ToolDef } from "./toolAdapter.js";
import { buildToolDefRegistry, resolveToolDefs } from "./toolRegistry.js";
import { estimateCostUsd } from "./pricing.js";
import { makeSessionId, parseSessionId, getSessionMessages, saveSessionMessages, type FallbackProviderName } from "./sessionStore.js";

const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_OLLAMA_MODEL = "llama3.1";
const CEO_MAX_STEPS = 15;
const SPECIALIST_MAX_STEPS = 25;
const DELEGATED_SPECIALIST_MAX_STEPS = 20;

function getModel(provider: FallbackProviderName): { model: LanguageModel; modelId: string } {
  if (provider === "openai") {
    const apiKey = getEnvValue("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    const modelId = getEnvValue("OPENAI_CEO_MODEL")?.trim() || DEFAULT_OPENAI_MODEL;
    // .chat(), not the bare factory call — createOpenAI(...)(modelId) defaults
    // to OpenAI's newer stateful Responses API (item_reference, response
    // chaining), which only real OpenAI implements. .chat() is the older,
    // universally-supported Chat Completions shape that DeepSeek and every
    // "OpenAI-compatible" server (including Ollama below) actually speaks —
    // using it for real OpenAI too keeps both links on the same wire format.
    return { model: createOpenAI({ apiKey }).chat(modelId), modelId };
  }
  if (provider === "deepseek") {
    const apiKey = getEnvValue("DEEPSEEK_API_KEY");
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
    const modelId = getEnvValue("DEEPSEEK_CEO_MODEL")?.trim() || DEFAULT_DEEPSEEK_MODEL;
    return { model: createDeepSeek({ apiKey })(modelId), modelId };
  }
  // Ollama exposes an OpenAI-Chat-Completions-compatible endpoint (not the
  // Responses API), so the same AI SDK OpenAI provider works against it —
  // just pointed at the local base URL, with no real API key needed (Ollama
  // ignores it) — as long as .chat() is used, see note above.
  const baseURL = getEnvValue("OLLAMA_BASE_URL");
  if (!baseURL) throw new Error("OLLAMA_BASE_URL is not set");
  const modelId = getEnvValue("OLLAMA_MODEL")?.trim() || DEFAULT_OLLAMA_MODEL;
  return { model: createOpenAI({ baseURL, apiKey: "ollama" }).chat(modelId), modelId };
}

export function isFallbackProviderConfigured(provider: FallbackProviderName): boolean {
  if (provider === "openai") return !!getEnvValue("OPENAI_API_KEY");
  if (provider === "deepseek") return !!getEnvValue("DEEPSEEK_API_KEY");
  return !!getEnvValue("OLLAMA_BASE_URL");
}

function droppedToolsNote(droppedBuiltins: string[]): string {
  if (!droppedBuiltins.length) return "";
  return `\n\nNote: this run is on a fallback LLM provider (Claude is temporarily unavailable), and the following built-in tools are NOT available to you right now: ${droppedBuiltins.join(", ")}. If a task genuinely needs one of these, say so plainly in your reply instead of attempting a workaround or pretending you did it.`;
}

function rosterDescription(): string {
  return DEPARTMENTS.map((d) => `- ${d.key} (${d.label}): ${d.tagline}`).join("\n");
}

function buildFallbackCeoSystemPrompt(): string {
  return `You are the CEO agent of a small automated organization, currently running on a fallback LLM provider because Claude is temporarily unavailable (rate-limited, out of credit, or otherwise unreachable).

You receive a goal or signal (from an email, a request, or a direct instruction) and your job is to:
1. Analyze it: understand what outcome is actually needed.
2. Check the system's permanent memory (list_memory_entries, optionally filtered by a query matching the goal's topic — get_memory_entry for the full text of anything relevant) for established context that bears on this goal: standing instructions, policies, key contacts, prior decisions, anything that shouldn't need repeating. Fold whatever's relevant into your own analysis and into the brief you hand off in step 4, rather than making a specialist rediscover it or you proceeding without it. Skip only when the goal is obviously self-contained and unlikely to depend on anything durable.
3. Decide whether it needs delegation, and to whom. You can delegate to any of these specialists via the delegate_to_specialist tool (pass subagent_type matching one of these keys):
${rosterDescription()}
4. Give whoever you delegate to a clear, concrete brief — not a vague summary. You can delegate to more than one specialist for a single goal if it genuinely spans departments.
5. Do not do specialists' work yourself (don't create Linear tasks, don't write code, don't draft documents) — that's what delegation is for. Your job is analysis, delegation, and reporting.
6. delegate_to_specialist runs synchronously and returns the specialist's full result directly in one call — there is no backgrounding/lost-result concern on this path.
7. If n8n workflow tools are available, you (not a specialist) are the one who triggers cross-cutting automations (e.g. notifying a channel, updating an external system) once delegated work is done — check list_n8n_workflows for what's available before assuming one exists. Don't invent a workflow name; only ever trigger ones that tool actually lists.
8. After delegating (and triggering any relevant automation), summarize back to the user: what was decided, who you delegated to, and what they reported. If a specialist hit a blocker (e.g. a tool isn't configured), say so honestly rather than claiming success.
9. When a specialist reports having sent, posted, or messaged something, only relay that as confirmed if their report cites a concrete identifier (a message ID, post ID) — a report of success with no identifier is not confirmed, and you must say so plainly (e.g. "reported as sent, but I can't confirm — no message ID came back") rather than repeating the claim as fact.

Be decisive. Do not ask clarifying questions unless the goal is genuinely ambiguous about scope or priority.

${DEVELOPER_INFO_BLOCK}`;
}

interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
}

interface RunTurnOpts {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: Record<string, Tool>;
  maxSteps: number;
  source: RunSource;
  onEvent: (event: RunEvent) => void;
  usageAcc: UsageAccumulator;
  abortController?: AbortController;
}

async function runAgentTurn(opts: RunTurnOpts): Promise<{ text: string; responseMessages: ModelMessage[] }> {
  const result = await generateText({
    model: opts.model,
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    stopWhen: stepCountIs(opts.maxSteps),
    abortSignal: opts.abortController?.signal,
    onStepFinish: (step) => {
      const ts = new Date().toISOString();
      for (const part of step.content) {
        if (part.type === "text" && part.text) {
          opts.onEvent({ type: "text", source: opts.source, text: part.text, ts });
        } else if (part.type === "tool-call") {
          opts.onEvent({ type: "tool_use", source: opts.source, name: part.toolName, input: part.input, toolUseId: part.toolCallId, ts });
        } else if (part.type === "tool-result") {
          const output = part.output as { text?: string; isError?: boolean } | undefined;
          opts.onEvent({ type: "tool_result", toolUseId: part.toolCallId, text: output?.text ?? "", isError: output?.isError ?? false, ts });
        } else if (part.type === "tool-error") {
          const err = (part as { error?: unknown }).error;
          opts.onEvent({
            type: "tool_result",
            toolUseId: part.toolCallId,
            text: err instanceof Error ? err.message : String(err),
            isError: true,
            ts,
          });
        }
      }
      opts.usageAcc.inputTokens += step.usage.inputTokens ?? 0;
      opts.usageAcc.outputTokens += step.usage.outputTokens ?? 0;
    },
  });
  return { text: result.text, responseMessages: result.responseMessages };
}

/** Wraps onEvent to also scan every text/tool_result event for a "Created <ID>: <title>\n<url>" Linear task, same convention drainQuery() watches for on the Claude path. */
function withLinearExtraction(onEvent: (event: RunEvent) => void): {
  onEvent: (event: RunEvent) => void;
  linearTasks: LinearTaskRef[];
} {
  const linearTasks: LinearTaskRef[] = [];
  return {
    linearTasks,
    onEvent: (event) => {
      const text = event.type === "text" ? event.text : event.type === "tool_result" && !event.isError ? event.text : undefined;
      if (text) {
        const task = extractLinearTask(text);
        if (task) linearTasks.push(task);
      }
      onEvent(event);
    },
  };
}

function memoryReadToolDefs(registry: Map<string, ToolDef>): ToolDef[] {
  return ["mcp__memory__list_memory_entries", "mcp__memory__get_memory_entry"]
    .map((name) => registry.get(name))
    .filter((d): d is ToolDef => !!d);
}

function n8nToolDefs(registry: Map<string, ToolDef>): ToolDef[] {
  return ["mcp__n8n__list_n8n_workflows", "mcp__n8n__trigger_n8n_workflow"]
    .map((name) => registry.get(name))
    .filter((d): d is ToolDef => !!d);
}

/**
 * The fallback provider's own subagent delegation: a tool whose handler runs
 * a nested, budgeted generateText loop scoped to the target specialist's own
 * prompt + tools, and returns its final text synchronously. This is the
 * fallback-provider equivalent of the Claude Agent SDK's built-in `Agent`
 * tool — there's no SDK-level backgrounding here (it's just an awaited
 * nested call), so none of orchestrator.ts's task_started/task_notification
 * recovery logic is needed.
 */
function buildDelegateTool(
  model: LanguageModel,
  registry: Map<string, ToolDef>,
  onEvent: (event: RunEvent) => void,
  usageAcc: UsageAccumulator,
  abortController?: AbortController,
): Tool {
  const agentKeys = Object.keys(buildAgentsRegistry());
  return aiTool({
    description:
      "Delegate a task to a specialist agent and wait for its result. Runs synchronously — the specialist's full final report is returned as this call's result.",
    inputSchema: z.object({
      subagent_type: z.enum(agentKeys as [string, ...string[]]).describe("Which specialist to delegate to"),
      brief: z.string().describe("A clear, concrete brief for the specialist — not a vague summary"),
    }),
    execute: async ({ subagent_type, brief }) => {
      const registryEntry = buildAgentsRegistry()[subagent_type];
      if (!registryEntry) {
        return { text: `Error: unknown specialist "${subagent_type}"`, isError: true };
      }
      const { defs, droppedBuiltins } = resolveToolDefs(registryEntry.tools ?? [], registry);
      const system = `${registryEntry.prompt}${droppedToolsNote(droppedBuiltins)}`;
      try {
        const result = await runAgentTurn({
          model,
          system,
          messages: [{ role: "user", content: brief }],
          tools: toAiSdkTools(defs),
          maxSteps: DELEGATED_SPECIALIST_MAX_STEPS,
          source: subagent_type,
          onEvent,
          usageAcc,
          abortController,
        });
        return { text: result.text || "(specialist run completed with no final text)", isError: false };
      } catch (err) {
        return { text: `Specialist "${subagent_type}" failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  });
}

export interface FallbackRunResult {
  status: "success" | "error";
  summary?: string;
  costUsd: number;
  linearTasks: LinearTaskRef[];
  sessionId?: string;
}

export async function runCeoAgentFallback(
  provider: FallbackProviderName,
  goal: string,
  onEvent: (event: RunEvent) => void,
  resumeSessionId?: string,
  abortController?: AbortController,
): Promise<FallbackRunResult> {
  const { model, modelId } = getModel(provider);
  const sessionId = resumeSessionId && parseSessionId(resumeSessionId)?.provider === provider ? resumeSessionId : makeSessionId(provider);
  const priorMessages = resumeSessionId ? getSessionMessages(sessionId) : [];
  const usageAcc: UsageAccumulator = { inputTokens: 0, outputTokens: 0 };
  const { onEvent: wrappedOnEvent, linearTasks } = withLinearExtraction(onEvent);

  const registry = buildToolDefRegistry();
  const baseDefs = [...memoryReadToolDefs(registry), ...n8nToolDefs(registry)];
  const tools: Record<string, Tool> = {
    ...toAiSdkTools(baseDefs),
    delegate_to_specialist: buildDelegateTool(model, registry, wrappedOnEvent, usageAcc, abortController),
  };

  const messages: ModelMessage[] = [...priorMessages, { role: "user", content: goal }];
  const ts = new Date().toISOString();

  try {
    const result = await runAgentTurn({
      model,
      system: buildFallbackCeoSystemPrompt(),
      messages,
      tools,
      maxSteps: CEO_MAX_STEPS,
      source: "ceo",
      onEvent: wrappedOnEvent,
      usageAcc,
      abortController,
    });
    saveSessionMessages(sessionId, [...messages, ...result.responseMessages]);
    const costUsd = estimateCostUsd(provider, modelId, usageAcc);
    const summary = result.text || "(completed with no final text)";
    onEvent({ type: "done", status: "success", summary, costUsd, ts: new Date().toISOString() });
    return { status: "success", summary, costUsd, linearTasks, sessionId };
  } catch (err) {
    // Deliberately no onEvent("done") here — this error still has to
    // propagate up through llmFallback.ts's runWithFallback, which either
    // cascades to the next provider (in which case this attempt never truly
    // "finished", the "switching to X" text event already explains why) or
    // is the last one tried, in which case runRunner.ts's own top-level
    // catch emits the one real terminal "done" event. Emitting one here too
    // used to double-count both the event and its cost.
    throw err;
  }
}

export async function runSpecialistAgentFallback(
  provider: FallbackProviderName,
  agentKey: string,
  goal: string,
  onEvent: (event: RunEvent) => void,
  resumeSessionId?: string,
  abortController?: AbortController,
): Promise<FallbackRunResult> {
  const registryEntry = buildAgentsRegistry()[agentKey];
  if (!registryEntry) throw new Error(`Unknown agent: ${agentKey}`);

  const { model, modelId } = getModel(provider);
  const sessionId = resumeSessionId && parseSessionId(resumeSessionId)?.provider === provider ? resumeSessionId : makeSessionId(provider);
  const priorMessages = resumeSessionId ? getSessionMessages(sessionId) : [];
  const usageAcc: UsageAccumulator = { inputTokens: 0, outputTokens: 0 };
  const { onEvent: wrappedOnEvent, linearTasks } = withLinearExtraction(onEvent);

  const registry = buildToolDefRegistry();
  const { defs, droppedBuiltins } = resolveToolDefs(registryEntry.tools ?? [], registry);
  const system = `${registryEntry.prompt}${droppedToolsNote(droppedBuiltins)}`;

  const messages: ModelMessage[] = [...priorMessages, { role: "user", content: goal }];

  try {
    const result = await runAgentTurn({
      model,
      system,
      messages,
      tools: toAiSdkTools(defs),
      maxSteps: SPECIALIST_MAX_STEPS,
      source: agentKey,
      onEvent: wrappedOnEvent,
      usageAcc,
      abortController,
    });
    saveSessionMessages(sessionId, [...messages, ...result.responseMessages]);
    const costUsd = estimateCostUsd(provider, modelId, usageAcc);
    const summary = result.text || "(completed with no final text)";
    onEvent({ type: "done", status: "success", summary, costUsd, ts: new Date().toISOString() });
    return { status: "success", summary, costUsd, linearTasks, sessionId };
  } catch (err) {
    // See the matching comment in runCeoAgentFallback above — no onEvent
    // "done" here, to avoid double-counting a mid-cascade or forced-provider
    // failure that the caller already handles.
    throw err;
  }
}
