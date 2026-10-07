import { join } from "node:path";
import { getDataDir } from "./paths.js";
import { readDoc, writeDoc } from "./storage.js";

// Per-tenant safety limits. Agents can spend money (LLM calls) and act in the
// outside world (send email, post to social, DM people), so a runaway prompt,
// a scheduler loop, or a leaked automation key must hit a ceiling instead of
// running unbounded. All limits are env/Settings-configurable; set a limit to
// 0 to disable that specific cap.
//
//   MAX_RUNS_PER_DAY              default 200   new agent runs per org per UTC day
//   MAX_COST_USD_PER_DAY          default 0 (off) LLM spend per org per UTC day
//   OUTBOUND_ACTIONS_ENABLED      default true  "false" = kill switch for every outbound tool
//   MAX_OUTBOUND_ACTIONS_PER_DAY  default 100   emails/posts/messages per org per UTC day
//
// Every outbound tool call (allowed or blocked) is written to the tenant's
// audit log (data/audit-log.json, newest last, capped).

/** Tools that act on the outside world on the organization's behalf. */
export const OUTBOUND_TOOLS = new Set([
  "send_email",
  "send_bulk_email",
  "send_ses_email",
  "send_bulk_ses_email",
  "send_whatsapp_message",
  "send_whatsapp_template",
  "send_zernio_message",
  "create_zernio_post",
  "create_postiz_post",
  "create_reddit_post",
  "create_facebook_group_post",
  "create_organization_post",
  "post_folder_image",
  "trigger_n8n_workflow",
]);

const AUDIT_LOG_MAX = 5000;

export interface AuditEntry {
  ts: string;
  tool: string;
  outcome: "allowed" | "blocked" | "failed";
  reason?: string;
  /** Truncated JSON of the tool arguments. */
  args: string;
}

interface DailyUsage {
  runs: number;
  outbound: number;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function limits() {
  return {
    maxRunsPerDay: numberEnv("MAX_RUNS_PER_DAY", 200),
    maxCostUsdPerDay: numberEnv("MAX_COST_USD_PER_DAY", 0),
    outboundEnabled: (process.env.OUTBOUND_ACTIONS_ENABLED ?? "true").toLowerCase() !== "false",
    maxOutboundPerDay: numberEnv("MAX_OUTBOUND_ACTIONS_PER_DAY", 100),
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function usageFile(day = today()): string {
  return join(getDataDir(), "usage", `${day}.json`);
}

function auditFile(): string {
  return join(getDataDir(), "audit-log.json");
}

export function getDailyUsage(): DailyUsage {
  return readDoc<DailyUsage>(usageFile()) ?? { runs: 0, outbound: 0 };
}

function bumpUsage(field: keyof DailyUsage, by: number) {
  const usage = getDailyUsage();
  usage[field] += by;
  writeDoc(usageFile(), usage);
}

export class LimitExceededError extends Error {
  readonly status = 429;
}

/**
 * Throws LimitExceededError if this org can't start another run today.
 * `costTodayUsd` is supplied by the caller (the run store owns cost data).
 */
export function assertCanStartRun(costTodayUsd: number): void {
  const { maxRunsPerDay, maxCostUsdPerDay } = limits();
  const usage = getDailyUsage();
  if (maxRunsPerDay > 0 && usage.runs >= maxRunsPerDay) {
    throw new LimitExceededError(`Daily run limit reached (${maxRunsPerDay} runs). Resets at 00:00 UTC; raise MAX_RUNS_PER_DAY to allow more.`);
  }
  if (maxCostUsdPerDay > 0 && costTodayUsd >= maxCostUsdPerDay) {
    throw new LimitExceededError(`Daily spend limit reached ($${costTodayUsd.toFixed(2)} of $${maxCostUsdPerDay}). Resets at 00:00 UTC; raise MAX_COST_USD_PER_DAY to allow more.`);
  }
  bumpUsage("runs", 1);
}

/** How many real-world actions a call represents — a bulk send counts each recipient. */
export function actionWeight(args: unknown): number {
  if (args && typeof args === "object") {
    for (const value of Object.values(args as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0) return value.length;
    }
  }
  return 1;
}

export function readAuditLog(limit = 200): AuditEntry[] {
  const all = readDoc<AuditEntry[]>(auditFile()) ?? [];
  return all.slice(-Math.min(Math.max(limit, 1), AUDIT_LOG_MAX)).reverse();
}

export function appendAudit(entry: Omit<AuditEntry, "ts" | "args"> & { args: unknown }): void {
  try {
    const log = readDoc<AuditEntry[]>(auditFile()) ?? [];
    let args: string;
    try {
      args = JSON.stringify(entry.args) ?? "";
    } catch {
      args = "[unserializable]";
    }
    log.push({ ts: new Date().toISOString(), tool: entry.tool, outcome: entry.outcome, reason: entry.reason, args: args.slice(0, 500) });
    writeDoc(auditFile(), log.length > AUDIT_LOG_MAX ? log.slice(-AUDIT_LOG_MAX) : log);
  } catch (err) {
    // Auditing must never break the action itself.
    console.error("[guardrails] failed to write audit log:", err);
  }
}

/**
 * Decides whether an outbound tool call may proceed, reserving its quota if
 * so. Returns a refusal message (for the agent to read) when blocked.
 */
export function checkOutbound(tool: string, args: unknown): { ok: true } | { ok: false; message: string } {
  const { outboundEnabled, maxOutboundPerDay } = limits();
  let reason: string | undefined;
  if (!outboundEnabled) {
    reason = "Outbound actions are disabled on this server (OUTBOUND_ACTIONS_ENABLED=false).";
  } else if (maxOutboundPerDay > 0) {
    const weight = actionWeight(args);
    const used = getDailyUsage().outbound;
    if (used + weight > maxOutboundPerDay) {
      reason = `Daily outbound limit reached (${used} of ${maxOutboundPerDay} used, this call needs ${weight}). Resets at 00:00 UTC; raise MAX_OUTBOUND_ACTIONS_PER_DAY to allow more.`;
    } else {
      bumpUsage("outbound", weight);
    }
  }
  if (reason) {
    appendAudit({ tool, outcome: "blocked", reason, args });
    return { ok: false, message: `BLOCKED by guardrail: ${reason} Do not retry; report this to the user.` };
  }
  return { ok: true };
}
