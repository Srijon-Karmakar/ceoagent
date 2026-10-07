import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "../src/providers/toolAdapter.js";
import { readAuditLog } from "../src/guardrails.js";
import { runWithTenant } from "../src/paths.js";

const tenant = { userId: "u", email: "u@x.test", name: "U", organizationId: "org-tool", organizationName: "Org" };
const ok = { content: [{ type: "text" as const, text: "sent, id=123" }] };

afterEach(() => {
  delete process.env.OUTBOUND_ACTIONS_ENABLED;
});

describe("defineTool guardrails", () => {
  it("leaves non-outbound tools untouched", async () => {
    const handler = vi.fn(async () => ok);
    const def = defineTool("list_leads", "d", {}, handler);
    expect(def.handler).toBe(handler);
  });

  it("runs and audits an allowed outbound call", async () => {
    const handler = vi.fn(async () => ok);
    const def = defineTool("send_email", "d", { to: z.string() }, handler);
    await runWithTenant(tenant, async () => {
      const result = await def.handler({ to: "a@b.c" }, undefined);
      expect(result).toBe(ok);
      expect(readAuditLog(1)[0]).toMatchObject({ tool: "send_email", outcome: "allowed" });
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("never calls the real handler when blocked", async () => {
    process.env.OUTBOUND_ACTIONS_ENABLED = "false";
    const handler = vi.fn(async () => ok);
    const def = defineTool("send_whatsapp_message", "d", {}, handler);
    const result = await runWithTenant(tenant, () => def.handler({}, undefined));
    expect(result.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
