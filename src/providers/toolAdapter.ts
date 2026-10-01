import { tool as aiTool, type Tool } from "ai";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * The MCP-standard content-block shape every src/tools/*.ts handler already
 * returns — this is exactly what the Claude Agent SDK's own `tool()`
 * requires as a return type, so descriptors stay assignable to both the
 * Claude wrapper and this file's AI SDK wrapper without a cast.
 */
export type McpToolResult = CallToolResult;

/**
 * A provider-agnostic tool descriptor. Every src/tools/*.ts file defines its
 * tools as an array of these first, then:
 *   - wraps each into the Claude Agent SDK's own `tool()` for the Claude
 *     path (unchanged behavior, `createSdkMcpServer({ tools: defs.map(...) })`)
 *   - exports the raw descriptor array for this module to convert into
 *     Vercel AI SDK tools for the OpenAI/DeepSeek fallback path
 * `handler` keeps the exact same signature the Claude SDK's `tool()`
 * expects (args, extra) => Promise<McpToolResult>, so existing handler
 * functions (most of which ignore the unused `extra` param) work unchanged
 * in both places.
 */
// `shape`/`handler` are intentionally type-erased here (not generic on
// `Shape`) so arrays of ToolDef stay homogeneous — e.g. `LINEAR_TOOL_DEFS =
// [createLinearTaskDef, listLinearTasksDef]` — and can be `.map()`ed over
// into either wrapper without TypeScript collapsing each element's distinct
// shape into an unusable union. `defineTool()` below is what keeps call
// sites type-safe despite the erasure: it's generic on `Shape`, so the
// `handler` you actually write is still checked against the exact `shape`
// you pass, before the result is widened to this erased `ToolDef`.
export interface ToolDef {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, extra: unknown) => Promise<McpToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  handler: (args: z.infer<z.ZodObject<Shape>>, extra: unknown) => Promise<McpToolResult>,
): ToolDef {
  return { name, description, shape, handler: handler as ToolDef["handler"] };
}

export function mcpResultText(result: McpToolResult): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Converts one provider-agnostic descriptor into a Vercel AI SDK tool. */
export function toAiSdkTool(def: ToolDef): Tool {
  return aiTool({
    description: def.description,
    inputSchema: z.object(def.shape),
    execute: async (args: unknown) => {
      const result = await def.handler(args, undefined);
      return { text: mcpResultText(result), isError: result.isError ?? false };
    },
  });
}

/** Converts a list of descriptors into the `{name: Tool}` record generateText()/streamText() expect. */
export function toAiSdkTools(defs: ToolDef[]): Record<string, Tool> {
  const record: Record<string, Tool> = {};
  for (const def of defs) record[def.name] = toAiSdkTool(def);
  return record;
}
