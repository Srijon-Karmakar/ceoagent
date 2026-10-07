import type { LinearTaskRef } from "../orchestrator.js";
import { runCeoAgentWithFallback, runSpecialistAgentWithFallback, type LlmProviderChoice } from "../providers/llmFallback.js";
import { createRun, appendEvent, setLinearTasks, setSessionId, finishRun, getRun, getRunController, costSince } from "./store.js";
import { assertCanStartRun } from "../guardrails.js";
import { getEnvValue } from "./settings.js";

// Fires a POST to WEBHOOK_URL (if configured) with the finished run's result,
// so n8n/Zapier can react without polling. Fire-and-forget: a webhook
// receiver being down must never affect the run itself, which has already
// finished by the time this is called.
export function notifyWebhook(record: {
  id: string;
  agentKey: string;
  status: string;
  summary?: string;
  costUsd?: number;
  linearTasks: LinearTaskRef[];
}) {
  const url = getEnvValue("WEBHOOK_URL");
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: record.id,
      agentKey: record.agentKey,
      status: record.status,
      summary: record.summary,
      costUsd: record.costUsd,
      linearTasks: record.linearTasks,
    }),
  }).catch((err) => {
    console.error(`webhook delivery failed for run ${record.id}:`, err instanceof Error ? err.message : err);
  });
}

/**
 * Drives a run to completion against an already-existing record — used both
 * by startCeoRun/startSpecialistRun below (a freshly created record) and by
 * the HTTP layer's reply endpoint (a reopened, already-existing record being
 * resumed via the SDK's session `resume` option, which this module doesn't
 * otherwise need to know about).
 *
 * `run()` receives the record's AbortController so the Stop button
 * (POST /api/runs/:id/cancel -> store.ts's cancelRun) can actually interrupt
 * the in-flight provider call, not just hide the run. Whether an abort
 * surfaces as a rejection (most providers) or as a clean resolution that
 * just stopped partway (observed with at least one provider's abort
 * handling), the controller's own `aborted` flag — not the settled outcome —
 * is what decides whether the run's final event reads "Stopped by user.",
 * so cancellation is labeled correctly either way.
 */
/** Throws LimitExceededError (status 429) when the tenant is over its daily run/spend cap. */
export function enforceRunLimits() {
  const startOfDayUtc = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  assertCanStartRun(costSince(startOfDayUtc));
}

export function startRun(
  record: { id: string },
  run: (abortController: AbortController) => Promise<{ linearTasks: LinearTaskRef[]; sessionId?: string }>,
) {
  const controller = getRunController(record.id) ?? new AbortController();
  run(controller)
    .then((result) => {
      setLinearTasks(record.id, result.linearTasks);
      setSessionId(record.id, result.sessionId);
      if (controller.signal.aborted) {
        appendEvent(record.id, { type: "done", status: "error", error: "Stopped by user.", costUsd: 0, ts: new Date().toISOString() });
      }
    })
    .catch((err) => {
      appendEvent(record.id, {
        type: "done",
        status: "error",
        error: controller.signal.aborted ? "Stopped by user." : err instanceof Error ? err.message : String(err),
        costUsd: 0,
        ts: new Date().toISOString(),
      });
    })
    .finally(() => {
      finishRun(record.id);
      const finished = getRun(record.id);
      if (finished) notifyWebhook(finished);
    });
}

/**
 * Starts a CEO run and returns immediately with the (still-running) record —
 * the run itself continues asynchronously via `startRun` above, updating the
 * record's events/status in the store as it goes. `displayGoal` is what's
 * shown in the UI (run header, history list); `promptText` is what the agent
 * actually receives, which may carry more than the display goal (e.g. an
 * attachment's text, appended by the HTTP layer's `buildPrompt`).
 */
export function startCeoRun(displayGoal: string, promptText: string, provider: LlmProviderChoice = "auto") {
  enforceRunLimits();
  const record = createRun(displayGoal, "ceo", provider);
  startRun(record, (abortController) =>
    runCeoAgentWithFallback(promptText, (event) => appendEvent(record.id, event), undefined, provider, abortController),
  );
  return record;
}

/** Same as `startCeoRun`, but runs one specialist directly, bypassing the CEO. */
export function startSpecialistRun(agentKey: string, displayGoal: string, promptText: string, provider: LlmProviderChoice = "auto") {
  enforceRunLimits();
  const record = createRun(displayGoal, agentKey, provider);
  startRun(record, (abortController) =>
    runSpecialistAgentWithFallback(agentKey, promptText, (event) => appendEvent(record.id, event), undefined, provider, abortController),
  );
  return record;
}
