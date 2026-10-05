import type { Express, Request, Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { runWithTenant, type TenantContext } from "../paths.js";
import type { ToolDef } from "./toolAdapter.js";
import type { RunEvent } from "../orchestrator.js";

/**
 * Exposes this app's canonical tool registry (gmail/linear/crm/memory/etc,
 * the same ToolDef descriptors the Claude path wraps as in-process MCP
 * servers and the OpenAI/DeepSeek/Ollama fallback wraps as AI SDK tools) to
 * the locally-spawned `codex` CLI subprocess over MCP's Streamable HTTP
 * transport — the only way to hand a separate OS process in-process tools,
 * since the Codex SDK (unlike the Claude Agent SDK or the Vercel AI SDK) has
 * no callback hook of its own for running tool code inside this Node
 * process.
 *
 * Each run (CEO or specialist) registers a short-lived random bearer token
 * before starting its Codex thread, scoped to that run's own tenant and
 * resolved tool set. The route below looks the token up per-request and
 * re-establishes tenant context via `runWithTenant()` for the duration of
 * the call, since AsyncLocalStorage context (which every tool handler reads
 * ambiently via getDataDir()/getWorkspaceDir()) never crosses the process
 * boundary to the codex subprocess on its own.
 */
export const CODEX_MCP_BRIDGE_PATH = "/internal/codex-mcp";

export interface CodexRunContext {
  tenant: TenantContext;
  toolDefs: ToolDef[];
  includeDelegate: boolean;
  onEvent: (event: RunEvent) => void;
  /** Stopping the top-level run must also stop a specialist it delegated to, not just the CEO's own turn — forwarded into the nested Codex thread delegate_to_specialist starts. */
  abortController?: AbortController;
}

export type CodexDelegateResult = { text: string; isError: boolean };
export type CodexDelegateHandler = (
  subagentType: string,
  brief: string,
  tenant: TenantContext,
  onEvent: (event: RunEvent) => void,
  abortController?: AbortController,
) => Promise<CodexDelegateResult>;

const runContexts = new Map<string, CodexRunContext>();
let delegateHandler: CodexDelegateHandler | null = null;

export function registerCodexRunToken(token: string, ctx: CodexRunContext): void {
  runContexts.set(token, ctx);
}

export function releaseCodexRunToken(token: string): void {
  runContexts.delete(token);
}

/** Set once by codexAgent.ts at module load — avoids a circular static import between the two files. */
export function setCodexDelegateHandler(handler: CodexDelegateHandler): void {
  delegateHandler = handler;
}

function isLoopbackAddress(req: Request): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function buildServerFor(ctx: CodexRunContext): McpServer {
  const server = new McpServer({ name: "ceo-agent-os-tools", version: "1.0.0" });
  for (const def of ctx.toolDefs) {
    server.tool(def.name, def.description, def.shape, (args: unknown, extra: unknown) =>
      runWithTenant(ctx.tenant, () => def.handler(args, extra)),
    );
  }
  if (ctx.includeDelegate) {
    server.tool(
      "delegate_to_specialist",
      "Delegate a task to a specialist agent and wait for its result. Runs synchronously — the specialist's full final report is returned as this call's result.",
      {
        subagent_type: z.string().describe("Which specialist to delegate to"),
        brief: z.string().describe("A clear, concrete brief for the specialist — not a vague summary"),
      },
      async (args: unknown) => {
        const { subagent_type, brief } = args as { subagent_type: string; brief: string };
        if (!delegateHandler) {
          return { content: [{ type: "text" as const, text: "Error: delegation is not available." }], isError: true };
        }
        const result = await runWithTenant(ctx.tenant, () =>
          delegateHandler!(subagent_type, brief, ctx.tenant, ctx.onEvent, ctx.abortController),
        );
        return { content: [{ type: "text" as const, text: result.text }], isError: result.isError };
      },
    );
  }
  return server;
}

export function mountCodexMcpBridge(app: Express): void {
  app.post(CODEX_MCP_BRIDGE_PATH, async (req: Request, res: Response) => {
    if (!isLoopbackAddress(req)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Forbidden" }, id: null });
      return;
    }
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const ctx = token ? runContexts.get(token) : undefined;
    if (!ctx) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unknown or expired bridge token" }, id: null });
      return;
    }

    const server = buildServerFor(ctx);
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
          id: null,
        });
      }
    }
  });
}
