import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileToolViolation, isAgentShellAllowed, minimalSubprocessEnv, withShellPolicy } from "../src/agentSandbox.js";
import { buildAgentsRegistry } from "../src/agents.js";
import { verifyWhatsappSignature } from "../src/tools/whatsapp-autoreply.js";
import { getEnvValue, getMaskedSettings, updateSettings } from "../src/server/settings.js";
import { requireAutomationTenant } from "../src/server/auth.js";
import { getGlobalDataDir, getTenantContext, runWithTenant, type TenantContext } from "../src/paths.js";
import { writeDoc } from "../src/storage.js";

const ENV_KEYS = ["ALLOW_AGENT_SHELL", "LINEAR_API_KEY", "ANTHROPIC_API_KEY", "AUTOMATION_API_KEY", "MAX_RUNS_PER_DAY"];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

let n = 0;
function freshTenant(): TenantContext {
  n += 1;
  return { userId: `u${n}`, email: `u${n}@x.test`, name: "T", organizationId: `org-${n}-${Date.now()}`, organizationName: "Org" };
}

describe("agent shell policy", () => {
  it("is off unless ALLOW_AGENT_SHELL=true", () => {
    delete process.env.ALLOW_AGENT_SHELL;
    expect(isAgentShellAllowed()).toBe(false);
    expect(withShellPolicy(["Read", "Bash"])).toEqual(["Read"]);
    process.env.ALLOW_AGENT_SHELL = "true";
    expect(withShellPolicy(["Read", "Bash"])).toEqual(["Read", "Bash"]);
  });

  it("drops Bash from every agent in the registry by default", () => {
    delete process.env.ALLOW_AGENT_SHELL;
    for (const agent of Object.values(buildAgentsRegistry())) {
      expect(agent.tools ?? []).not.toContain("Bash");
    }
    expect(buildAgentsRegistry().developer.prompt).toContain("Shell commands are disabled");
  });

  it("strips server secrets from subprocess env", () => {
    process.env.ANTHROPIC_API_KEY = "sk-secret";
    const env = minimalSubprocessEnv({ CEO_AGENT_MCP_TOKEN: "t" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CEO_AGENT_MCP_TOKEN).toBe("t");
  });
});

describe("workspace guard", () => {
  const ws = mkdtempSync(join(tmpdir(), "ws-"));
  mkdirSync(join(ws, "src"), { recursive: true });

  it("allows paths inside the workspace", () => {
    expect(fileToolViolation("Read", { file_path: "src/a.ts" }, ws)).toBeNull();
    expect(fileToolViolation("Write", { file_path: join(ws, "new/file.txt") }, ws)).toBeNull();
    expect(fileToolViolation("Glob", { pattern: "**/*.ts" }, ws)).toBeNull();
    // Grep's pattern is a content regex, not a path
    expect(fileToolViolation("Grep", { pattern: "/api/..", path: "src" }, ws)).toBeNull();
    expect(fileToolViolation("Grep", { pattern: "x", glob: "../*.env" }, ws)).toMatch(/can't contain/);
  });

  it("blocks escapes via .., absolute paths and patterns", () => {
    expect(fileToolViolation("Read", { file_path: "../../.env" }, ws)).toMatch(/outside your workspace/);
    expect(fileToolViolation("Read", { file_path: tmpdir() }, ws)).toMatch(/outside your workspace/);
    expect(fileToolViolation("Grep", { pattern: "x", path: ".." }, ws)).toMatch(/outside your workspace/);
    expect(fileToolViolation("Glob", { pattern: "../**/*.json" }, ws)).toMatch(/can't contain/);
    expect(fileToolViolation("Glob", { pattern: "/etc/*" }, ws)).toMatch(/relative/);
  });

  it("blocks the app-managed documents store", () => {
    expect(fileToolViolation("Read", { file_path: ".documents/index.json" }, ws)).toMatch(/managed by the app/);
  });

  it("blocks Bash when shell is disabled", () => {
    delete process.env.ALLOW_AGENT_SHELL;
    expect(fileToolViolation("Bash", { command: "ls" }, ws)).toMatch(/disabled/);
  });

  it("follows symlinks that point outside", () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    try {
      symlinkSync(outside, join(ws, "link"), "junction");
    } catch {
      return; // symlinks not permitted on this machine — nothing to test
    }
    expect(fileToolViolation("Read", { file_path: "link/secret.txt" }, ws)).toMatch(/outside your workspace/);
  });
});

describe("WhatsApp webhook signature", () => {
  const body = Buffer.from('{"entry":[]}');
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts a correct signature", () => {
    expect(verifyWhatsappSignature(body, sign("s3cret"), "s3cret")).toBe(true);
  });

  it("rejects wrong, missing or unconfigured signatures", () => {
    expect(verifyWhatsappSignature(body, sign("other"), "s3cret")).toBe(false);
    expect(verifyWhatsappSignature(body, undefined, "s3cret")).toBe(false);
    expect(verifyWhatsappSignature(body, sign("s3cret"), undefined)).toBe(false);
    expect(verifyWhatsappSignature(undefined, sign("s3cret"), "s3cret")).toBe(false);
  });
});

describe("org settings never inherit operator accounts", () => {
  it("shares model keys but not account credentials", () => {
    process.env.ANTHROPIC_API_KEY = "sk-operator-anthropic";
    process.env.LINEAR_API_KEY = "lin-operator";
    process.env.MAX_RUNS_PER_DAY = "7";
    runWithTenant(freshTenant(), () => {
      expect(getEnvValue("ANTHROPIC_API_KEY")).toBe("sk-operator-anthropic");
      expect(getEnvValue("LINEAR_API_KEY")).toBeUndefined();
      expect(getEnvValue("MAX_RUNS_PER_DAY")).toBe("7"); // server config, not a Settings field
      updateSettings({ LINEAR_API_KEY: "lin-org-own" });
      expect(getEnvValue("LINEAR_API_KEY")).toBe("lin-org-own");
    });
    expect(getEnvValue("LINEAR_API_KEY")).toBe("lin-operator"); // no tenant = single-tenant install
  });

  it("never shows an org any fragment of the operator's keys", () => {
    process.env.ANTHROPIC_API_KEY = "sk-operator-anthropic-1234";
    runWithTenant(freshTenant(), () => {
      const field = getMaskedSettings().find((f) => f.envVar === "ANTHROPIC_API_KEY")!;
      expect(field.isSet).toBe(true);
      expect(field.masked).toBe("provided by server");
    });
  });
});

describe("automation API keys are per organization", () => {
  function call(headers: Record<string, string>) {
    let status = 0;
    let tenantSeen: TenantContext | undefined;
    const req = { header: (h: string) => headers[h] } as never;
    const res = { status: (s: number) => ((status = s), { json: () => undefined }) } as never;
    requireAutomationTenant(req, res, () => {
      status = 200;
      tenantSeen = getTenantContext();
    });
    return { status, tenantSeen };
  }

  it("accepts an org's own key and rejects it for another org", () => {
    const a = freshTenant();
    const b = freshTenant();
    writeDoc(join(getGlobalDataDir(), "tenants.json"), {
      users: { [a.userId]: { ...a, createdAt: "", updatedAt: "" }, [b.userId]: { ...b, createdAt: "", updatedAt: "" } },
    });
    runWithTenant(a, () => updateSettings({ AUTOMATION_API_KEY: "key-for-a" }));
    process.env.AUTOMATION_API_KEY = "operator-global-key";

    const ok = call({ "X-Organization-Id": a.organizationId, "X-API-Key": "key-for-a" });
    expect(ok.status).toBe(200);
    expect(ok.tenantSeen?.organizationId).toBe(a.organizationId);

    expect(call({ "X-Organization-Id": b.organizationId, "X-API-Key": "key-for-a" }).status).toBe(401);
    expect(call({ "X-Organization-Id": b.organizationId, "X-API-Key": "operator-global-key" }).status).toBe(401);
    expect(call({ "X-Organization-Id": "nope", "X-API-Key": "key-for-a" }).status).toBe(401);
  });
});
