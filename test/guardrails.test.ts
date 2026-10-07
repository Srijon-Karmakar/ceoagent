import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LimitExceededError,
  actionWeight,
  assertCanStartRun,
  checkOutbound,
  getDailyUsage,
  readAuditLog,
} from "../src/guardrails.js";
import { runWithTenant, type TenantContext } from "../src/paths.js";

let n = 0;
function freshTenant(): TenantContext {
  n += 1;
  return { userId: `u${n}`, email: `u${n}@x.test`, name: "T", organizationId: `org-${n}-${Date.now()}`, organizationName: "Org" };
}

const ENV_KEYS = ["MAX_RUNS_PER_DAY", "MAX_COST_USD_PER_DAY", "OUTBOUND_ACTIONS_ENABLED", "MAX_OUTBOUND_ACTIONS_PER_DAY"];
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

describe("run limits", () => {
  it("allows runs up to the daily cap, then throws a 429 error", () => {
    process.env.MAX_RUNS_PER_DAY = "2";
    runWithTenant(freshTenant(), () => {
      assertCanStartRun(0);
      assertCanStartRun(0);
      expect(() => assertCanStartRun(0)).toThrow(LimitExceededError);
      expect(getDailyUsage().runs).toBe(2);
    });
  });

  it("counts each tenant separately", () => {
    process.env.MAX_RUNS_PER_DAY = "1";
    runWithTenant(freshTenant(), () => assertCanStartRun(0));
    runWithTenant(freshTenant(), () => expect(() => assertCanStartRun(0)).not.toThrow());
  });

  it("blocks once the daily spend cap is reached", () => {
    process.env.MAX_COST_USD_PER_DAY = "5";
    runWithTenant(freshTenant(), () => {
      expect(() => assertCanStartRun(4.99)).not.toThrow();
      expect(() => assertCanStartRun(5)).toThrow(/spend limit/);
    });
  });

  it("treats 0 as 'no limit'", () => {
    process.env.MAX_RUNS_PER_DAY = "0";
    runWithTenant(freshTenant(), () => {
      for (let i = 0; i < 300; i++) assertCanStartRun(0);
    });
  });
});

describe("outbound actions", () => {
  it("weights bulk sends by recipient count", () => {
    expect(actionWeight({ to: "a@b.c" })).toBe(1);
    expect(actionWeight({ recipients: ["a", "b", "c"] })).toBe(3);
    expect(actionWeight(undefined)).toBe(1);
  });

  it("enforces the daily outbound cap and audits blocked calls", () => {
    process.env.MAX_OUTBOUND_ACTIONS_PER_DAY = "3";
    runWithTenant(freshTenant(), () => {
      expect(checkOutbound("send_email", { to: "a" }).ok).toBe(true);
      expect(checkOutbound("send_bulk_email", { recipients: ["a", "b", "c"] }).ok).toBe(false);
      expect(checkOutbound("send_bulk_email", { recipients: ["a", "b"] }).ok).toBe(true);
      expect(checkOutbound("send_email", { to: "a" }).ok).toBe(false);
      const log = readAuditLog();
      expect(log.filter((e) => e.outcome === "blocked")).toHaveLength(2);
      expect(log[0].tool).toBe("send_email"); // newest first
    });
  });

  it("kill switch blocks everything", () => {
    process.env.OUTBOUND_ACTIONS_ENABLED = "false";
    runWithTenant(freshTenant(), () => {
      const verdict = checkOutbound("send_email", { to: "a" });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.message).toMatch(/disabled/);
    });
  });
});
