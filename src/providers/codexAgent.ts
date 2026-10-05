import { randomUUID } from "node:crypto";
import { Codex, type Thread, type ThreadEvent, type ThreadOptions, type Usage } from "@openai/codex-sdk";
import { getEnvValue } from "../server/settings.js";
import { getTenantContext } from "../paths.js";
import { getWorkspaceDir } from "../workspace.js";
import { DEPARTMENTS, buildAgentsRegistry } from "../agents.js";
import { DEVELOPER_INFO_BLOCK } from "../developer/index.js";
import { extractLinearTask, type RunEvent, type RunSource, type LinearTaskRef } from "../orchestrator.js";
import { buildToolDefRegistry, resolveToolDefs } from "./toolRegistry.js";
import { estimateCostUsd } from "./pricing.js";
import type { ToolDef } from "./toolAdapter.js";
import {
  CODEX_MCP_BRIDGE_PATH,
  registerCodexRunToken,
  releaseCodexRunToken,
  setCodexDelegateHandler,
  type CodexDelegateResult,
} from "./codexToolBridge.js";
import { makeSessionId, parseSessionId, getCodexThreadId, saveCodexThreadId } from "./sessionStore.js";

/**
 * Codex's own CLI tools (shell exec, apply_patch) already cover what
 * Read/Write/Edit/Bash/Glob/Grep mean on the Claude path — unlike the
 * OpenAI/DeepSeek/Ollama fallback, these don't need to be dropped or
 * flagged as unavailable, just left out of the MCP bridge's tool set (Codex
 * never sees them as MCP tools, it has native equivalents). WebSearch/
 * WebFetch map onto Codex's own `webSearchEnabled` thread option instead.
 */
const NATIVE_CODEX_BUILTINS = new Set(["Read", "Write", "Edit", "Bash", "Glob", "Grep"]);
const WEB_SEARCH_BUILTINS = new Set(["WebSearch", "WebFetch"]);

function rosterDescription(): string {
  return DEPARTMENTS.map((d) => `- ${d.key} (${d.label}): ${d.tagline}`).join("\n");
}

function buildCodexCeoSystemPrompt(): string {
  return `You are the CEO agent of a small automated organization, running on Codex (OpenAI's coding agent) rather than Claude.

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

/** Same role memoryReadToolDefs/n8nToolDefs play in fallbackAgent.ts — the CEO's own tiny fixed tool set, resolved fresh per call so n8n's connection-gated availability stays current. */
function ceoToolDefs(registry: Map<string, ToolDef>): ToolDef[] {
  return ["mcp__memory__list_memory_entries", "mcp__memory__get_memory_entry", "mcp__n8n__list_n8n_workflows", "mcp__n8n__trigger_n8n_workflow"]
    .map((name) => registry.get(name))
    .filter((d): d is ToolDef => !!d);
}

function nativeBuiltinsNote(toolNames: string[]): string {
  const native = toolNames.filter((t) => NATIVE_CODEX_BUILTINS.has(t));
  if (!native.length) return "";
  return `\n\nNote: you're running on Codex, so file/shell access (${native.join(", ")}) is available through your own native tools, not as separate MCP tools — just use them directly.`;
}

function bridgeUrl(): string {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  return `http://127.0.0.1:${port}${CODEX_MCP_BRIDGE_PATH}`;
}

// Deliberately CODEX_API_KEY only — NOT a fallback to OPENAI_API_KEY. That
// key is scoped to this app's separate OpenAI chat-completion fallback
// (fallbackAgent.ts) and isn't guaranteed to carry Codex/Responses-API
// entitlement; forcing it in here would silently override a working local
// `codex login` session with a key that may not even be valid for Codex
// (confirmed live: an OPENAI_API_KEY lacking Codex access returns "Quota
// exceeded" from a machine whose local login answers fine with no key at
// all). Leave CODEX_API_KEY unset to use local `codex login` auth, same as
// Claude needs no ANTHROPIC_API_KEY when `claude login` is already signed in.
function resolveApiKey(): string | undefined {
  return getEnvValue("CODEX_API_KEY") || undefined;
}

function resolveModel(): string | undefined {
  return getEnvValue("CODEX_CEO_MODEL")?.trim() || undefined;
}

/** One `Codex` client per run — cheap (just config), and keeps each run's bridge token/env isolated. */
function buildCodexClient(bridgeToken: string): Codex {
  const apiKey = resolveApiKey();
  return new Codex({
    ...(apiKey ? { apiKey } : {}),
    env: { ...process.env, CEO_AGENT_MCP_TOKEN: bridgeToken } as Record<string, string>,
    config: {
      mcp_servers: {
        ceo_tools: { url: bridgeUrl(), bearer_token_env_var: "CEO_AGENT_MCP_TOKEN" },
      },
    },
  });
}

function threadOptionsFor(toolNames: string[]): ThreadOptions {
  const model = resolveModel();
  return {
    workingDirectory: getWorkspaceDir(),
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write",
    networkAccessEnabled: true,
    approvalPolicy: "never",
    webSearchEnabled: toolNames.some((t) => WEB_SEARCH_BUILTINS.has(t)),
    ...(model ? { model } : {}),
  };
}

function mcpToolResultText(result: { content: Array<{ type: string; text?: string }> } | undefined): string {
  if (!result) return "";
  return result.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

interface DrainResult {
  status: "success" | "error";
  summary?: string;
  usage: Usage | null;
  linearTasks: LinearTaskRef[];
}

async function drainCodexEvents(events: AsyncGenerator<ThreadEvent>, source: RunSource, onEvent: (event: RunEvent) => void): Promise<DrainResult> {
  const linearTasks: LinearTaskRef[] = [];
  let finalResponse = "";
  let usage: Usage | null = null;
  let failure: string | undefined;

  const recordText = (text: string) => {
    const ts = new Date().toISOString();
    onEvent({ type: "text", source, text, ts });
    const task = extractLinearTask(text);
    if (task) linearTasks.push(task);
  };

  for await (const event of events) {
    const ts = new Date().toISOString();
    if (event.type === "turn.completed") {
      usage = event.usage;
    } else if (event.type === "turn.failed") {
      failure = event.error.message;
    } else if (event.type === "error") {
      failure = event.message;
    } else if (event.type === "item.completed") {
      const item = event.item;
      if (item.type === "agent_message") {
        finalResponse = item.text;
        recordText(item.text);
      } else if (item.type === "command_execution") {
        onEvent({ type: "tool_use", source, name: "shell", input: { command: item.command }, toolUseId: item.id, ts });
        const text = `${item.aggregated_output}${item.exit_code !== undefined ? `\n(exit ${item.exit_code})` : ""}`;
        onEvent({ type: "tool_result", toolUseId: item.id, text, isError: item.status === "failed", ts });
      } else if (item.type === "file_change") {
        onEvent({ type: "tool_use", source, name: "apply_patch", input: { changes: item.changes }, toolUseId: item.id, ts });
        const text = item.changes.map((c) => `${c.kind} ${c.path}`).join("\n");
        onEvent({ type: "tool_result", toolUseId: item.id, text, isError: item.status === "failed", ts });
      } else if (item.type === "mcp_tool_call") {
        onEvent({ type: "tool_use", source, name: `${item.server}__${item.tool}`, input: item.arguments, toolUseId: item.id, ts });
        const text = item.status === "failed" ? item.error?.message ?? "tool call failed" : mcpToolResultText(item.result);
        onEvent({ type: "tool_result", toolUseId: item.id, text, isError: item.status === "failed", ts });
        if (item.status !== "failed") {
          const task = extractLinearTask(text);
          if (task) linearTasks.push(task);
        }
      } else if (item.type === "web_search") {
        onEvent({ type: "tool_use", source, name: "web_search", input: { query: item.query }, toolUseId: item.id, ts });
        onEvent({ type: "tool_result", toolUseId: item.id, text: `Searched: ${item.query}`, isError: false, ts });
      } else if (item.type === "error") {
        recordText(`[error] ${item.message}`);
      }
      // "reasoning" and "todo_list" items are deliberately not surfaced — internal
      // planning detail, not an action worth showing in the run's event timeline.
    }
  }

  if (failure) return { status: "error", summary: failure, usage, linearTasks };
  return { status: "success", summary: finalResponse || "(completed with no final text)", usage, linearTasks };
}

export interface CodexRunResult {
  status: "success" | "error";
  summary?: string;
  costUsd: number;
  linearTasks: LinearTaskRef[];
  sessionId?: string;
}

/**
 * Codex has no dedicated pricing table entry (unlike gpt-4o/deepseek-chat in
 * pricing.ts) since actual billing depends on which account/plan is
 * authenticated (API key vs. a ChatGPT plan's included usage) — falls
 * through to pricing.ts's generic FALLBACK_PRICING, same as any other
 * unrecognized model id, rather than hardcoding a possibly-wrong $0.
 */
function estimateCodexCostUsd(usage: Usage | null): number {
  if (!usage) return 0;
  return estimateCostUsd("codex", resolveModel() ?? "codex-default", {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  });
}

/**
 * Throws on failure rather than returning `{status: "error"}` — matching
 * every non-Claude provider's convention (see fallbackAgent.ts), so
 * llmFallback.ts's generic catch-block cascade (via isCodexExhaustionError)
 * actually gets a chance to run. Claude is the one path allowed to return a
 * graceful error result instead of throwing, and llmFallback.ts has one
 * special-cased check just for that; codex doesn't need its own equivalent
 * as long as it always throws here.
 */
async function runThread(
  thread: Thread,
  prompt: string,
  source: RunSource,
  onEvent: (event: RunEvent) => void,
  sessionId: string,
  abortController?: AbortController,
): Promise<CodexRunResult> {
  const { events } = await thread.runStreamed(prompt, abortController ? { signal: abortController.signal } : undefined);
  const result = await drainCodexEvents(events, source, onEvent);
  if (thread.id) saveCodexThreadId(sessionId, thread.id);
  const costUsd = estimateCodexCostUsd(result.usage);
  if (result.status === "error") {
    throw new Error(result.summary ?? "Codex run failed");
  }
  const ts = new Date().toISOString();
  onEvent({ type: "done", status: "success", summary: result.summary, costUsd, ts });
  return { status: "success", summary: result.summary, costUsd, linearTasks: result.linearTasks, sessionId };
}

function startOrResumeThread(codex: Codex, sessionId: string, options: ThreadOptions): { thread: Thread; isResuming: boolean } {
  const storedThreadId = getCodexThreadId(sessionId);
  return storedThreadId
    ? { thread: codex.resumeThread(storedThreadId, options), isResuming: true }
    : { thread: codex.startThread(options), isResuming: false };
}

/** Codex's Thread.run() has no separate system-prompt input (unlike Claude's `systemPrompt` option or the AI SDK's `system`) — instructions only fit into the user turn itself, so they're prepended once when a thread starts and omitted on every resumed turn to avoid re-sending the whole prompt each time. */
function buildPrompt(instructions: string, goal: string, isResuming: boolean): string {
  return isResuming ? goal : `${instructions}\n\n---\n\n${goal}`;
}

export async function runCeoAgentCodex(
  goal: string,
  onEvent: (event: RunEvent) => void,
  resumeSessionId?: string,
  abortController?: AbortController,
): Promise<CodexRunResult> {
  const tenant = getTenantContext();
  if (!tenant) throw new Error("runCeoAgentCodex requires tenant context");

  const sessionId = resumeSessionId && parseSessionId(resumeSessionId)?.provider === "codex" ? resumeSessionId : makeSessionId("codex");
  const toolNames = ["mcp__memory__list_memory_entries", "mcp__memory__get_memory_entry", "mcp__n8n__list_n8n_workflows", "mcp__n8n__trigger_n8n_workflow"];
  const registry = buildToolDefRegistry();
  const toolDefs = ceoToolDefs(registry);

  const bridgeToken = randomUUID();
  registerCodexRunToken(bridgeToken, { tenant, toolDefs, includeDelegate: true, onEvent, abortController });
  try {
    const codex = buildCodexClient(bridgeToken);
    const { thread, isResuming } = startOrResumeThread(codex, sessionId, threadOptionsFor(toolNames));
    const prompt = buildPrompt(buildCodexCeoSystemPrompt(), goal, isResuming);
    return await runThread(thread, prompt, "ceo", onEvent, sessionId, abortController);
  } finally {
    releaseCodexRunToken(bridgeToken);
  }
}

export async function runSpecialistAgentCodex(
  agentKey: string,
  goal: string,
  onEvent: (event: RunEvent) => void,
  resumeSessionId?: string,
  abortController?: AbortController,
): Promise<CodexRunResult> {
  const tenant = getTenantContext();
  if (!tenant) throw new Error("runSpecialistAgentCodex requires tenant context");

  const registryEntry = buildAgentsRegistry()[agentKey];
  if (!registryEntry) throw new Error(`Unknown agent: ${agentKey}`);

  const sessionId = resumeSessionId && parseSessionId(resumeSessionId)?.provider === "codex" ? resumeSessionId : makeSessionId("codex");
  const toolNames = registryEntry.tools ?? [];
  const registry = buildToolDefRegistry();
  const { defs } = resolveToolDefs(toolNames, registry);

  const bridgeToken = randomUUID();
  registerCodexRunToken(bridgeToken, { tenant, toolDefs: defs, includeDelegate: false, onEvent, abortController });
  try {
    const codex = buildCodexClient(bridgeToken);
    const { thread, isResuming } = startOrResumeThread(codex, sessionId, threadOptionsFor(toolNames));
    const prompt = buildPrompt(`${registryEntry.prompt}${nativeBuiltinsNote(toolNames)}`, goal, isResuming);
    return await runThread(thread, prompt, agentKey, onEvent, sessionId, abortController);
  } finally {
    releaseCodexRunToken(bridgeToken);
  }
}

/**
 * Wired into codexToolBridge.ts's delegate_to_specialist tool — a nested
 * Codex thread scoped to the target specialist. Its own tool_use/tool_result/
 * text events are forwarded into the same onEvent stream the top-level CEO
 * run is using (mirrors fallbackAgent.ts's buildDelegateTool), so the UI
 * shows the specialist's actual work, not just the summary returned here.
 */
setCodexDelegateHandler(async (subagentType, brief, _tenant, onEvent, abortController): Promise<CodexDelegateResult> => {
  try {
    const result = await runSpecialistAgentCodex(subagentType, brief, onEvent, undefined, abortController);
    return { text: result.summary ?? "(specialist run completed with no final text)", isError: result.status === "error" };
  } catch (err) {
    return { text: `Specialist "${subagentType}" failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
});
