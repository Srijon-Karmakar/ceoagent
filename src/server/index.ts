import "dotenv/config";
import express from "express";
import multer from "multer";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSettingsIntoEnv, getMaskedSettings, updateSettings, getEnvValue } from "./settings.js";
import {
  clearSessionCookie,
  createOAuthStateToken,
  findTenantByOrganizationId,
  getPublicAuthConfig,
  isSupabaseAuthConfigured,
  readRequestTenant,
  requireAuth,
  requireAutomationTenant,
  restoreTenant,
  resolveAuthFlowTenant,
  setSessionCookie,
} from "./auth.js";
import { getBaseDir, getTenantContext, runWithTenant } from "../paths.js";
import { DEPARTMENTS, buildAgentsRegistry } from "../agents.js";
import { listDocuments, getDocument } from "../tools/documents.js";
import { parseAttachment } from "../tools/attachments.js";
import { getAnalytics } from "./analytics.js";
import { runCeoAgent, runSpecialistAgent } from "../orchestrator.js";
import { startCeoRun as runRunnerStartCeoRun, startSpecialistRun as runRunnerStartSpecialistRun, startRun } from "./runRunner.js";
import {
  createSchedule,
  listSchedules,
  updateSchedule,
  deleteSchedule,
  initScheduler,
  type Recurrence,
} from "../scheduler.js";
import {
  createLead,
  listLeads,
  updateLead,
  addLeadActivity,
  deleteLead,
  LEAD_STAGES,
  type LeadStage,
} from "../crm.js";
import {
  listPlaybookItems,
  updatePlaybookItem,
  deletePlaybookItem,
  PLAYBOOK_TABS,
  PLAYBOOK_ITEM_TYPES,
  type PlaybookTab,
  type PlaybookItemType,
} from "../playbook.js";
import {
  createProject as createPortfolioProject,
  listProjects as listPortfolioProjects,
  renameProject as renamePortfolioProject,
  deleteProject as deletePortfolioProject,
  createEntry as createPortfolioEntry,
  listEntries as listPortfolioEntries,
  updateEntry as updatePortfolioEntry,
  deleteEntry as deletePortfolioEntry,
  createNote as createPortfolioNote,
  listNotes as listPortfolioNotes,
  updateNote as updatePortfolioNote,
  deleteNote as deletePortfolioNote,
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_ENTRY_STATUSES,
  PORTFOLIO_NOTE_TABS,
  type PortfolioCategory,
  type PortfolioEntryStatus,
  type PortfolioNoteTab,
} from "../portfolio.js";
import {
  getGmailAuthUrl,
  handleGmailCallback,
  isGmailConnected,
  disconnectGmail,
} from "../tools/gmail.js";
import {
  getInstagramAuthUrl,
  handleInstagramCallback,
  isInstagramConnected,
  disconnectInstagram,
} from "../tools/instagram.js";
import {
  getLinkedinAuthUrl,
  handleLinkedinCallback,
  isLinkedinConnected,
  disconnectLinkedin,
} from "../tools/linkedin.js";
import {
  getFacebookAuthUrl,
  handleFacebookCallback,
  isFacebookConnected,
  disconnectFacebook,
} from "../tools/facebook.js";
import { isZernioConnected } from "../tools/zernio.js";
import { isPostizConnected } from "../tools/postiz.js";
import { isScrapegraphConnected } from "../tools/scrapegraph.js";
import { isHunterConnected } from "../tools/hunter.js";
import {
  getCanvaAuthUrl,
  handleCanvaCallback,
  isCanvaConnected,
  disconnectCanva,
} from "../tools/canva.js";
import { getToolsCatalog } from "./toolsCatalog.js";
import { isImageGenConfigured } from "../tools/image-gen.js";
import { getPostImagesDir } from "../tools/post-images.js";
import { isWhatsappConnected } from "../tools/whatsapp.js";
import { isWhatsappWebhookConfigured, markMessageSeen, handleIncomingWhatsappMessage } from "../tools/whatsapp-autoreply.js";
import { isRedditConnected } from "../tools/reddit.js";
import { filesRouter } from "./filesRoutes.js";
import {
  appendEvent,
  reopenRun,
  getRun,
  listRuns,
  listRunsFor,
  archiveRun,
  unarchiveRun,
  deleteRun,
  subscribe,
} from "./store.js";

// Packaged installs ship with no .env file — this fills process.env from the
// Settings screen's persisted values (data/settings.json) instead. A dev
// .env (already loaded above via dotenv/config) always takes priority.
// Also supports a .env placed in the packaged app's writable app-data folder,
// which is useful before Supabase auth is configured and Settings is gated.
function loadAppDataEnv() {
  const envFile = join(getBaseDir(), ".env");
  if (existsSync(envFile)) loadDotenv({ path: envFile, override: false });
}

loadAppDataEnv();
loadSettingsIntoEnv();

function monitorElectronParent() {
  if (process.env.CEO_AGENT_SERVER_CHILD !== "1") return;
  const parentPid = Number(process.env.CEO_AGENT_PARENT_PID);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;

  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 5000);
  timer.unref();
}

monitorElectronParent();

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_KEYS = new Set(Object.keys(buildAgentsRegistry()));

function defaultPort(): number {
  return process.env.PORT ? Number(process.env.PORT) : 3000;
}

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(), // parsed in-memory and discarded — never written to disk
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

app.get("/api/auth/config", (_req, res) => {
  res.json(getPublicAuthConfig());
});

app.post("/api/auth/session", (req, res) => {
  const accessToken = typeof req.body?.access_token === "string" ? req.body.access_token : "";
  if (!accessToken) {
    res.status(400).json({ error: "access_token is required" });
    return;
  }
  setSessionCookie(res, accessToken);
  res.status(204).end();
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

app.get("/api/auth/me", (req, res) => {
  readRequestTenant(req)
    .then((tenant) => res.json(tenant))
    .catch(() => res.status(401).json({ error: "authentication required" }));
});

app.use("/api/automation", requireAutomationTenant);
app.use("/api", requireAuth);

// --- Uploads: extracts text from an uploaded file for the client to attach
// to a goal, rather than the app storing it or an agent needing a file tool.

app.post("/api/uploads", upload.single("file"), restoreTenant, async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "file is required" });
    return;
  }
  try {
    const { text, truncated } = await parseAttachment(req.file.buffer, req.file.originalname);
    res.json({ filename: req.file.originalname, text, truncated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

interface AttachmentInput {
  filename: string;
  text: string;
  truncated?: boolean;
}

function readAttachment(body: unknown): AttachmentInput | undefined {
  const a = (body as { attachment?: unknown })?.attachment;
  if (!a || typeof a !== "object") return undefined;
  const { filename, text, truncated } = a as Record<string, unknown>;
  if (typeof filename !== "string" || typeof text !== "string") return undefined;
  return { filename, text, truncated: truncated === true };
}

// The goal stored on the run record (shown in the UI — history list, run
// header) stays short; the agent gets that same text plus the attachment
// appended, so a 50,000-character file dump never has to render as a page
// heading.
function buildPrompt(goal: string, attachment: AttachmentInput | undefined): string {
  if (!attachment) return goal;
  const note = attachment.truncated ? " (truncated)" : "";
  return `${goal}\n\n--- Attached file: ${attachment.filename}${note} ---\n${attachment.text}\n--- end of attachment ---`;
}

// --- Runs: CEO overview (delegates to whichever specialists fit) ---

function startCeoRun(goal: string, attachment: AttachmentInput | undefined) {
  return runRunnerStartCeoRun(goal, buildPrompt(goal, attachment));
}

function startSpecialistRun(key: string, goal: string, attachment: AttachmentInput | undefined) {
  return runRunnerStartSpecialistRun(key, goal, buildPrompt(goal, attachment));
}

app.post("/api/runs", (req, res) => {
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  const record = startCeoRun(goal, readAttachment(req.body));
  res.status(201).json({ id: record.id });
});

// --- Runs: direct to one specialist, bypassing the CEO ---

app.post("/api/agents/:key/runs", (req, res) => {
  const { key } = req.params;
  if (!AGENT_KEYS.has(key)) {
    res.status(404).json({ error: `unknown agent: ${key}` });
    return;
  }
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  const record = startSpecialistRun(key, goal, readAttachment(req.body));
  res.status(201).json({ id: record.id });
});

// --- Automation: same run-creation, gated by a shared API key instead of
// being reachable by anyone loading the page. This is the surface external
// automation tools (n8n, Zapier) call — kept separate from /api/runs and
// /api/agents/:key/runs above so the browser UI never needs to carry a
// secret client-side.

app.post("/api/automation/runs", (req, res) => {
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  const record = startCeoRun(goal, readAttachment(req.body));
  res.status(201).json({ id: record.id });
});

app.post("/api/automation/agents/:key/runs", (req, res) => {
  const { key } = req.params;
  if (!AGENT_KEYS.has(key)) {
    res.status(404).json({ error: `unknown agent: ${key}` });
    return;
  }
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  const record = startSpecialistRun(key, goal, readAttachment(req.body));
  res.status(201).json({ id: record.id });
});

// --- Reply: continue a finished run's same agent conversation, instead of
// starting a fresh one with no memory of what was already said. ---

app.post("/api/runs/:id/reply", (req, res) => {
  const record = getRun(req.params.id);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (record.status === "running") {
    res.status(409).json({ error: "this run is still in progress" });
    return;
  }
  if (!record.sessionId) {
    res.status(409).json({ error: "this run can't be continued (no session was captured for it)" });
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  reopenRun(record.id);
  res.status(202).json({ id: record.id });

  const resumeSessionId = record.sessionId;
  const agentKey = record.agentKey;
  startRun(record, () =>
    agentKey === "ceo"
      ? runCeoAgent(message, (event) => appendEvent(record.id, event), resumeSessionId)
      : runSpecialistAgent(agentKey, message, (event) => appendEvent(record.id, event), resumeSessionId),
  );
});

app.get("/api/departments", (_req, res) => {
  res.json(DEPARTMENTS);
});

app.get("/api/analytics", (_req, res) => {
  res.json(getAnalytics());
});

// --- Schedules: the Calendar department's "click a date/range" automations.
// Structured recurrence (never a raw cron string) parsed from the request
// body — same "read this file's routes, this is the deterministic surface;
// the Calendar agent's MCP tools in tools/scheduler.ts are the natural-
// language surface" split as the rest of this app's tool-vs-route pattern.

function parseRecurrence(body: unknown): Recurrence | { error: string } {
  const r = (body as { recurrence?: unknown })?.recurrence;
  if (!r || typeof r !== "object") return { error: "recurrence is required" };
  const { type, date, startDate, endDate, weekdays } = r as Record<string, unknown>;
  if (type === "once") {
    if (typeof date !== "string" || !date) return { error: "recurrence.date is required for type=once" };
    return { type: "once", date };
  }
  if (type === "daily") {
    if (typeof startDate !== "string" || !startDate) return { error: "recurrence.startDate is required for type=daily" };
    return { type: "daily", startDate, endDate: typeof endDate === "string" ? endDate : undefined };
  }
  if (type === "weekly") {
    if (typeof startDate !== "string" || !startDate) return { error: "recurrence.startDate is required for type=weekly" };
    if (!Array.isArray(weekdays) || !weekdays.every((d) => typeof d === "number" && d >= 0 && d <= 6) || weekdays.length === 0) {
      return { error: "recurrence.weekdays must be a non-empty array of numbers 0-6 for type=weekly" };
    }
    return { type: "weekly", weekdays, startDate, endDate: typeof endDate === "string" ? endDate : undefined };
  }
  return { error: 'recurrence.type must be "once", "daily", or "weekly"' };
}

app.get("/api/schedule", (_req, res) => {
  res.json(listSchedules());
});

app.post("/api/schedule", (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  const goal = typeof req.body?.goal === "string" ? req.body.goal.trim() : "";
  const agentKey = typeof req.body?.agentKey === "string" ? req.body.agentKey : "";
  const time = typeof req.body?.time === "string" ? req.body.time : "";
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  if (agentKey !== "ceo" && !AGENT_KEYS.has(agentKey)) {
    res.status(404).json({ error: `unknown agent: ${agentKey}` });
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    res.status(400).json({ error: 'time must be 24h "HH:MM"' });
    return;
  }
  const recurrence = parseRecurrence(req.body);
  if ("error" in recurrence) {
    res.status(400).json({ error: recurrence.error });
    return;
  }
  const record = createSchedule({ label, goal, agentKey, recurrence, time });
  res.status(201).json(record);
});

app.patch("/api/schedule/:id", (req, res) => {
  const patch: Record<string, unknown> = {};
  if (typeof req.body?.label === "string") patch.label = req.body.label.trim();
  if (typeof req.body?.goal === "string") patch.goal = req.body.goal.trim();
  if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
  if (typeof req.body?.time === "string") {
    if (!/^\d{2}:\d{2}$/.test(req.body.time)) {
      res.status(400).json({ error: 'time must be 24h "HH:MM"' });
      return;
    }
    patch.time = req.body.time;
  }
  if (typeof req.body?.agentKey === "string") {
    if (req.body.agentKey !== "ceo" && !AGENT_KEYS.has(req.body.agentKey)) {
      res.status(404).json({ error: `unknown agent: ${req.body.agentKey}` });
      return;
    }
    patch.agentKey = req.body.agentKey;
  }
  if (req.body?.recurrence !== undefined) {
    const recurrence = parseRecurrence(req.body);
    if ("error" in recurrence) {
      res.status(400).json({ error: recurrence.error });
      return;
    }
    patch.recurrence = recurrence;
  }
  const record = updateSchedule(req.params.id, patch);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

app.delete("/api/schedule/:id", (req, res) => {
  const ok = deleteSchedule(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

// --- Leads: the CRM department's pipeline. Same "deterministic REST route
// for the UI, natural-language MCP tools (tools/crm.ts) for the agent" split
// as schedules above.

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

app.get("/api/leads", (req, res) => {
  const stage = typeof req.query.stage === "string" ? req.query.stage : undefined;
  const includeArchived = req.query.archived === "true";
  let leads = listLeads();
  if (!includeArchived) leads = leads.filter((l) => !l.archived);
  if (stage) leads = leads.filter((l) => l.stage === stage);
  res.json(leads);
});

app.post("/api/leads", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!source) {
    res.status(400).json({ error: "source is required" });
    return;
  }
  if (req.body?.stage !== undefined && !LEAD_STAGES.includes(req.body.stage)) {
    res.status(400).json({ error: `stage must be one of: ${LEAD_STAGES.join(", ")}` });
    return;
  }
  const record = createLead({
    name,
    source,
    company: typeof req.body?.company === "string" ? req.body.company : undefined,
    email: typeof req.body?.email === "string" ? req.body.email : undefined,
    phone: typeof req.body?.phone === "string" ? req.body.phone : undefined,
    title: typeof req.body?.title === "string" ? req.body.title : undefined,
    stage: req.body?.stage as LeadStage | undefined,
    value: typeof req.body?.value === "number" ? req.body.value : undefined,
    currency: typeof req.body?.currency === "string" ? req.body.currency : undefined,
    owner: typeof req.body?.owner === "string" ? req.body.owner : undefined,
    tags: isStringArray(req.body?.tags) ? req.body.tags : undefined,
    followUpAt: typeof req.body?.followUpAt === "string" ? req.body.followUpAt : undefined,
    notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
  });
  res.status(201).json(record);
});

app.patch("/api/leads/:id", (req, res) => {
  const patch: Record<string, unknown> = {};
  for (const field of ["name", "company", "email", "phone", "title", "source", "owner", "followUpAt", "currency", "notes"] as const) {
    if (typeof req.body?.[field] === "string") patch[field] = req.body[field];
  }
  if (req.body?.stage !== undefined) {
    if (!LEAD_STAGES.includes(req.body.stage)) {
      res.status(400).json({ error: `stage must be one of: ${LEAD_STAGES.join(", ")}` });
      return;
    }
    patch.stage = req.body.stage;
  }
  if (typeof req.body?.value === "number") patch.value = req.body.value;
  if (isStringArray(req.body?.tags)) patch.tags = req.body.tags;
  if (typeof req.body?.archived === "boolean") patch.archived = req.body.archived;
  const record = updateLead(req.params.id, patch);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

app.post("/api/leads/:id/activity", (req, res) => {
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (!note) {
    res.status(400).json({ error: "note is required" });
    return;
  }
  const record = addLeadActivity(req.params.id, note);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

app.delete("/api/leads/:id", (req, res) => {
  const ok = deleteLead(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

// --- Playbook: Sales/Marketing checklists of agent-produced deliverables
// (AI-generated copy, images, videos, email/script drafts). Rows are
// created by the specialist agents (tools/playbook.ts) — this REST surface
// only reads, and lets a human edit fields or toggle done/delete a row.

app.get("/api/playbook", (req, res) => {
  const tab = typeof req.query.tab === "string" ? req.query.tab : undefined;
  if (tab !== undefined && !PLAYBOOK_TABS.includes(tab as PlaybookTab)) {
    res.status(400).json({ error: `tab must be one of: ${PLAYBOOK_TABS.join(", ")}` });
    return;
  }
  res.json(listPlaybookItems(tab as PlaybookTab | undefined));
});

app.patch("/api/playbook/:id", (req, res) => {
  const patch: Record<string, unknown> = {};
  for (const field of ["platform", "link", "details", "notes"] as const) {
    if (typeof req.body?.[field] === "string") patch[field] = req.body[field];
  }
  if (req.body?.type !== undefined) {
    if (!PLAYBOOK_ITEM_TYPES.includes(req.body.type as PlaybookItemType)) {
      res.status(400).json({ error: `type must be one of: ${PLAYBOOK_ITEM_TYPES.join(", ")}` });
      return;
    }
    patch.type = req.body.type;
  }
  if (typeof req.body?.done === "boolean") patch.done = req.body.done;
  const record = updatePlaybookItem(req.params.id, patch);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

app.delete("/api/playbook/:id", (req, res) => {
  const ok = deletePlaybookItem(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

// --- Portfolio: editable project/product tabs, each holding entries across
// five fixed categories (blog/article/collab/pr-post/email), plus freeform
// markdown notes under "project-details"/"database" tabs — durable project
// memory (tech stack, credentials locations, config values) agents read for
// context. Same REST-for-UI, MCP-tools-for-agent split as leads/playbook
// above.

app.get("/api/portfolio/projects", (_req, res) => {
  res.json(listPortfolioProjects());
});

app.post("/api/portfolio/projects", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  res.status(201).json(createPortfolioProject(name));
});

app.patch("/api/portfolio/projects/:id", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const record = renamePortfolioProject(req.params.id, name);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

app.delete("/api/portfolio/projects/:id", (req, res) => {
  const ok = deletePortfolioProject(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/portfolio/entries", (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  if (category !== undefined && !PORTFOLIO_CATEGORIES.includes(category as PortfolioCategory)) {
    res.status(400).json({ error: `category must be one of: ${PORTFOLIO_CATEGORIES.join(", ")}` });
    return;
  }
  res.json(listPortfolioEntries({ projectId, category: category as PortfolioCategory | undefined }));
});

app.post("/api/portfolio/entries", (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!PORTFOLIO_CATEGORIES.includes(req.body?.category as PortfolioCategory)) {
    res.status(400).json({ error: `category must be one of: ${PORTFOLIO_CATEGORIES.join(", ")}` });
    return;
  }
  if (req.body?.status !== undefined && !PORTFOLIO_ENTRY_STATUSES.includes(req.body.status as PortfolioEntryStatus)) {
    res.status(400).json({ error: `status must be one of: ${PORTFOLIO_ENTRY_STATUSES.join(", ")}` });
    return;
  }
  const record = createPortfolioEntry({
    projectId,
    title,
    category: req.body.category as PortfolioCategory,
    status: req.body?.status as PortfolioEntryStatus | undefined,
    link: typeof req.body?.link === "string" ? req.body.link : undefined,
    date: typeof req.body?.date === "string" ? req.body.date : undefined,
    notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
    recipient: typeof req.body?.recipient === "string" ? req.body.recipient : undefined,
    subject: typeof req.body?.subject === "string" ? req.body.subject : undefined,
    messageId: typeof req.body?.messageId === "string" ? req.body.messageId : undefined,
    owner: "manual",
  });
  res.status(201).json(record);
});

app.patch("/api/portfolio/entries/:id", (req, res) => {
  const patch: Record<string, unknown> = {};
  for (const field of ["projectId", "title", "link", "date", "notes", "recipient", "subject", "messageId"] as const) {
    if (typeof req.body?.[field] === "string") patch[field] = req.body[field];
  }
  if (req.body?.category !== undefined) {
    if (!PORTFOLIO_CATEGORIES.includes(req.body.category as PortfolioCategory)) {
      res.status(400).json({ error: `category must be one of: ${PORTFOLIO_CATEGORIES.join(", ")}` });
      return;
    }
    patch.category = req.body.category;
  }
  if (req.body?.status !== undefined) {
    if (!PORTFOLIO_ENTRY_STATUSES.includes(req.body.status as PortfolioEntryStatus)) {
      res.status(400).json({ error: `status must be one of: ${PORTFOLIO_ENTRY_STATUSES.join(", ")}` });
      return;
    }
    patch.status = req.body.status;
  }
  const record = updatePortfolioEntry(req.params.id, patch);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

app.delete("/api/portfolio/entries/:id", (req, res) => {
  const ok = deletePortfolioEntry(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/portfolio/notes", (req, res) => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const tab = typeof req.query.tab === "string" ? req.query.tab : undefined;
  if (tab !== undefined && !PORTFOLIO_NOTE_TABS.includes(tab as PortfolioNoteTab)) {
    res.status(400).json({ error: `tab must be one of: ${PORTFOLIO_NOTE_TABS.join(", ")}` });
    return;
  }
  res.json(listPortfolioNotes({ projectId, tab: tab as PortfolioNoteTab | undefined }));
});

app.post("/api/portfolio/notes", (req, res) => {
  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!PORTFOLIO_NOTE_TABS.includes(req.body?.tab as PortfolioNoteTab)) {
    res.status(400).json({ error: `tab must be one of: ${PORTFOLIO_NOTE_TABS.join(", ")}` });
    return;
  }
  const record = createPortfolioNote({
    projectId,
    title,
    tab: req.body.tab as PortfolioNoteTab,
    content: typeof req.body?.content === "string" ? req.body.content : undefined,
    owner: "manual",
  });
  res.status(201).json(record);
});

app.patch("/api/portfolio/notes/:id", (req, res) => {
  const patch: Record<string, unknown> = {};
  for (const field of ["title", "content"] as const) {
    if (typeof req.body?.[field] === "string") patch[field] = req.body[field];
  }
  const record = updatePortfolioNote(req.params.id, patch);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

app.delete("/api/portfolio/notes/:id", (req, res) => {
  const ok = deletePortfolioNote(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/runs", (req, res) => {
  const agentKey = typeof req.query.agentKey === "string" ? req.query.agentKey : undefined;
  const showArchived = req.query.archived === "true";
  const runs = (agentKey ? listRunsFor(agentKey) : listRuns())
    .filter((r) => Boolean(r.archived) === showArchived)
    .map((r) => ({
      id: r.id,
      goal: r.goal,
      agentKey: r.agentKey,
      status: r.status,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      costUsd: r.costUsd,
      summary: r.summary,
      linearTasks: r.linearTasks,
      archived: Boolean(r.archived),
    }));
  res.json(runs);
});

app.get("/api/runs/:id", (req, res) => {
  const record = getRun(req.params.id);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(record);
});

// --- Archive/delete: archive is reversible (hides a run from the default
// list without losing its transcript); delete is permanent, so it's blocked
// on running (in case an emitter is still live) and expected to be
// confirmed client-side before this ever gets called. ---

app.post("/api/runs/:id/archive", (req, res) => {
  const record = getRun(req.params.id);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (record.status === "running") {
    res.status(409).json({ error: "can't archive a run in progress" });
    return;
  }
  archiveRun(record.id);
  res.json({ ok: true });
});

app.post("/api/runs/:id/unarchive", (req, res) => {
  const ok = unarchiveRun(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ ok: true });
});

app.delete("/api/runs/:id", (req, res) => {
  const record = getRun(req.params.id);
  if (!record) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (record.status === "running") {
    res.status(409).json({ error: "can't delete a run in progress" });
    return;
  }
  deleteRun(record.id);
  res.json({ ok: true });
});

app.get("/api/runs/:id/stream", (req, res) => {
  const record = getRun(req.params.id);
  if (!record) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Replay everything already recorded, so a client that connects mid-run
  // (or after it finished) still sees the full transcript. Skipped when
  // reconnecting after a reply (?replay=0) — the client already has that
  // history from the original connection and only wants what's new.
  if (req.query.replay !== "0") {
    for (const event of record.events) send(event);
  }

  if (record.status !== "running") {
    send({
      type: "run_finished",
      status: record.status,
      summary: record.summary,
      costUsd: record.costUsd,
      linearTasks: record.linearTasks,
      sessionId: record.sessionId,
    });
    res.end();
    return;
  }

  const unsubscribe = subscribe(
    record.id,
    (event) => send(event),
    (finalRecord) => {
      send({
        type: "run_finished",
        status: finalRecord.status,
        summary: finalRecord.summary,
        costUsd: finalRecord.costUsd,
        linearTasks: finalRecord.linearTasks,
        sessionId: finalRecord.sessionId,
      });
      res.end();
    },
  );

  req.on("close", unsubscribe);
});

// --- Documents (deliverables produced by HR/Finance/Sales/Analysis) ---

app.get("/api/documents", (req, res) => {
  const agentKey = typeof req.query.agentKey === "string" ? req.query.agentKey : undefined;
  res.json(listDocuments(agentKey));
});

app.get("/api/documents/:id", (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(doc);
});

// --- Files: the human-facing folder browser (data/, deliverables/,
// workspace/) — separate from the /api/documents deliverable feed above. ---

app.use("/api/files", filesRouter);

// --- Settings: API keys/credentials, replacing hand-edited .env for
// packaged installs. Values are never echoed back — only a masked
// placeholder plus whether each field is currently set. ---

app.get("/api/settings", (_req, res) => {
  res.json(getMaskedSettings());
});

app.post("/api/settings", (req, res) => {
  res.json(updateSettings(req.body ?? {}));
});

// --- Account connections ---

// The connect links below are opened in the user's real OS browser (see the
// OAuth-state-token comment in auth.ts), which doesn't carry this request's
// session cookie — so the tenant has to be encoded into the link itself.
function oauthConnectUrl(path: string): string {
  if (!isSupabaseAuthConfigured()) return path;
  const tenant = getTenantContext();
  if (!tenant) return path;
  return `${path}?state=${encodeURIComponent(createOAuthStateToken(tenant))}`;
}

app.get("/api/accounts", (_req, res) => {
  res.json([
    { key: "gmail", label: "Gmail", connected: isGmailConnected(), connectUrl: oauthConnectUrl("/auth/gmail") },
    { key: "instagram", label: "Instagram", connected: isInstagramConnected(), connectUrl: oauthConnectUrl("/auth/instagram") },
    { key: "linkedin", label: "LinkedIn", connected: isLinkedinConnected(), connectUrl: oauthConnectUrl("/auth/linkedin") },
    { key: "facebook", label: "Facebook", connected: isFacebookConnected(), connectUrl: oauthConnectUrl("/auth/facebook") },
    {
      key: "zernio",
      label: "Zernio (social & messaging)",
      connected: isZernioConnected(),
      configOnly: true,
      configHint: "Set your Zernio API key in the Settings screen. Get a key at zernio.com → Settings → API Keys, and link platform accounts from Zernio's own dashboard.",
      signupUrl: "https://zernio.com",
    },
    {
      key: "postiz",
      label: "Postiz (social scheduling)",
      connected: isPostizConnected(),
      configOnly: true,
      configHint: "Set your Postiz API key in the Settings screen. Get one at your Postiz dashboard → Settings → Developers → Apps, and link platform accounts (X, LinkedIn, Facebook, TikTok, YouTube, Threads, etc.) from Postiz's own dashboard. Leave the base URL blank to use Postiz's cloud API, or set it if you're self-hosting Postiz.",
      signupUrl: "https://postiz.com",
    },
    {
      key: "scrapegraph",
      label: "ScrapeGraphAI (structured web extraction)",
      connected: isScrapegraphConnected(),
      configOnly: true,
      configHint: "Set your ScrapeGraphAI API key in the Settings screen. Get one at your ScrapeGraphAI dashboard. Used by the Analysis, SEO, AEO, and CRM agents to pull reliably-shaped data (pricing, specs, contact details, existing schema markup) from pages instead of just free-text summaries.",
      signupUrl: "https://scrapegraphai.com",
    },
    {
      key: "whatsapp",
      label: "WhatsApp (direct)",
      connected: isWhatsappConnected(),
      configOnly: true,
      configHint: "Set your WhatsApp access token, phone number ID, business account ID, webhook verify token, OpenAI API key, and WhatsApp AI handoff settings in the Settings screen. Generate a permanent System User token for the WABA in Meta Business Suite -> Business Settings -> System Users.",
      signupUrl: "https://business.facebook.com/settings",
    },
    {
      key: "image_gen",
      label: "AI image generation (OpenAI / Hugging Face / free fallback)",
      connected: isImageGenConfigured(),
      configOnly: true,
      configHint: `Works out of the box with no key at all, via a free public fallback (Pollinations) — "connected" here just means a paid/higher-quality provider is configured. Set an OpenAI API key for the best quality, and/or a Hugging Face API key (free tier) as a second choice; generation automatically tries OpenAI first, then Hugging Face, then the free fallback, whichever succeeds. Also requires a Zernio API key, since generated images are posted through Zernio. To post your own images instead of generating them, just drop .jpg/.jpeg/.png files in ${getPostImagesDir()} — no extra config needed.`,
      signupUrl: "https://platform.openai.com/api-keys",
    },
    {
      key: "reddit",
      label: "Reddit (SEO/AEO blog posting)",
      connected: isRedditConnected(),
      configOnly: true,
      configHint: "Set your Reddit client ID/secret, account username/password, and allowed subreddits (comma-separated) in the Settings screen. Create a \"script\" type app at reddit.com/prefs/apps to get a client ID/secret. The posting account must NOT have 2FA enabled — this auth method can't complete a 2FA challenge. The SEO and AEO agents can post to any subreddit in your allowed list without asking first, so only add subreddits you're comfortable with that.",
      signupUrl: "https://www.reddit.com/prefs/apps",
    },
    {
      key: "hunter",
      label: "Hunter.io (email finder)",
      connected: isHunterConnected(),
      configOnly: true,
      configHint: "Set your Hunter.io API key in the Settings screen. Get one free at hunter.io (50 free credits/month) — used by the CRM agent to find real, verified contact emails at a prospect's domain instead of guessing.",
      signupUrl: "https://hunter.io/users/sign_up?from=api",
    },
    {
      key: "canva",
      label: "Canva (design)",
      connected: isCanvaConnected(),
      connectUrl: oauthConnectUrl("/auth/canva"),
    },
  ]);
});

// --- Tools: what each connected integration can actually do, with an
// example prompt — same connection data as /api/accounts, described from a
// "what can I ask for" angle instead of a connect/disconnect one. ---

app.get("/api/tools", (_req, res) => {
  res.json(getToolsCatalog());
});

// WhatsApp Cloud API webhook — Meta's one-time verification handshake when
// you set the callback URL in the App Dashboard.
function handleWhatsappMessages(req: express.Request, res: express.Response) {
  res.sendStatus(200);
  if (!isWhatsappConnected() || !isWhatsappWebhookConfigured()) return;
  const entries = req.body?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const contacts = change.value?.contacts ?? [];
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text" || !message.text?.body) continue;
        if (!markMessageSeen(message.id)) continue;
        const contact = contacts.find((c: { wa_id?: string; profile?: { name?: string } }) => c.wa_id === message.from);
        const profileName = contact?.profile?.name;
        handleIncomingWhatsappMessage(message.from, message.text.body, {
          messageId: message.id,
          profileName: typeof profileName === "string" ? profileName : undefined,
        }).catch((err) =>
          console.error("[webhook/whatsapp] auto-reply failed:", err),
        );
      }
    }
  }
}

app.get("/webhook/whatsapp/:organizationId", (req, res) => {
  const tenant = findTenantByOrganizationId(req.params.organizationId);
  if (!tenant) {
    res.sendStatus(404);
    return;
  }
  runWithTenant(tenant, () => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token && token === getEnvValue("WHATSAPP_WEBHOOK_VERIFY_TOKEN")) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });
});

app.post("/webhook/whatsapp/:organizationId", (req, res) => {
  const tenant = findTenantByOrganizationId(req.params.organizationId);
  if (!tenant) {
    res.sendStatus(404);
    return;
  }
  runWithTenant(tenant, () => handleWhatsappMessages(req, res));
});

app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && token === getEnvValue("WHATSAPP_WEBHOOK_VERIFY_TOKEN")) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WhatsApp Cloud API webhook — inbound messages. Acks Meta with 200
// immediately (Meta retries/duplicates on anything else), then handles the
// auto-reply asynchronously so the client still gets a near-instant answer
// without holding the webhook connection open.
app.post("/webhook/whatsapp", (req, res) => {
  handleWhatsappMessages(req, res);
});

// No requireAuth here: these routes are opened in the user's real OS
// browser (see below), which doesn't carry this app's session cookie. Each
// handler instead resolves its tenant from the signed `state` token that
// oauthConnectUrl() embedded in the link — see resolveAuthFlowTenant in
// auth.ts for why.

// OAuth connect links open with target="_blank" so Electron's main process
// (setWindowOpenHandler in electron/main.cjs) can route them to the user's
// real OS browser instead of its embedded webview, which Google and others
// block sign-in from. That means the callback lands in a separate browser
// tab/process from the app window — redirecting it back to "/" would just
// open a confusing second copy of the whole app in that tab, so it gets a
// small standalone success page instead. The app window itself picks up the
// new connection via polling (see startAccountConnectPoll in app.js).
function oauthSuccessPage(label: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${label} connected</title>
    <style>
      html, body { height: 100%; margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #1f2428; }
      body { display: grid; place-items: center; }
      main { width: min(420px, calc(100vw - 48px)); text-align: center; }
      h1 { margin: 0 0 10px; font-size: 22px; font-weight: 650; }
      p { margin: 0; color: #5d656b; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${label} connected</h1>
      <p>You can close this tab and return to CEO Agent OS.</p>
    </main>
    <script>try { window.close(); } catch {}</script>
  </body>
</html>`;
}

// The state token is threaded through as the OAuth `state` param so the
// provider echoes it back on the callback request below, letting that
// request resolve the same tenant with no cookie involved.
async function runInAuthFlowTenant<T>(req: express.Request, fn: () => T | Promise<T>): Promise<T> {
  const tenant = await resolveAuthFlowTenant(req);
  return tenant ? runWithTenant(tenant, fn) : fn();
}

function stateParam(req: express.Request): string | undefined {
  return typeof req.query.state === "string" ? req.query.state : undefined;
}

app.get("/auth/gmail", async (req, res) => {
  try {
    const url = await runInAuthFlowTenant(req, () => getGmailAuthUrl(stateParam(req)));
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : String(err));
  }
});

app.get("/auth/gmail/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  try {
    if (!code) throw new Error("Missing authorization code");
    await runInAuthFlowTenant(req, () => handleGmailCallback(code));
    res.send(oauthSuccessPage("Gmail"));
  } catch (err) {
    res.status(500).send(`Gmail connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

app.post("/api/accounts/gmail/disconnect", (_req, res) => {
  disconnectGmail();
  res.status(204).end();
});

app.get("/auth/instagram", async (req, res) => {
  try {
    const url = await runInAuthFlowTenant(req, () => getInstagramAuthUrl(stateParam(req)));
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : String(err));
  }
});

app.get("/auth/instagram/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  try {
    if (!code) throw new Error("Missing authorization code");
    await runInAuthFlowTenant(req, () => handleInstagramCallback(code));
    res.send(oauthSuccessPage("Instagram"));
  } catch (err) {
    res.status(500).send(`Instagram connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

app.post("/api/accounts/instagram/disconnect", (_req, res) => {
  disconnectInstagram();
  res.status(204).end();
});

app.get("/auth/linkedin", async (req, res) => {
  try {
    const url = await runInAuthFlowTenant(req, () => getLinkedinAuthUrl(stateParam(req)));
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : String(err));
  }
});

app.get("/auth/linkedin/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  const oauthErrorDescription = typeof req.query.error_description === "string" ? req.query.error_description : "";
  try {
    if (oauthError) throw new Error(`${oauthError}${oauthErrorDescription ? `: ${oauthErrorDescription}` : ""}`);
    // A bare redirect with neither `code` nor `error` (LinkedIn's own hosted
    // error page redirecting here after showing the user a generic failure,
    // rather than LinkedIn passing the reason through) usually means the
    // redirect_uri LinkedIn was sent doesn't exactly match an entry in the
    // app's "Authorized redirect URLs for your app" list — check that first.
    if (!code) throw new Error("Missing authorization code — LinkedIn didn't report a reason. Check that this app's Authorized redirect URLs (LinkedIn Developer Portal → Auth) includes exactly this URL, and that the Community Management API product is approved.");
    await runInAuthFlowTenant(req, () => handleLinkedinCallback(code));
    res.send(oauthSuccessPage("LinkedIn"));
  } catch (err) {
    res.status(500).send(`LinkedIn connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

app.post("/api/accounts/linkedin/disconnect", (_req, res) => {
  disconnectLinkedin();
  res.status(204).end();
});

app.get("/auth/facebook", async (req, res) => {
  try {
    const url = await runInAuthFlowTenant(req, () => getFacebookAuthUrl(stateParam(req)));
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : String(err));
  }
});

app.get("/auth/facebook/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  const oauthErrorDescription = typeof req.query.error_description === "string" ? req.query.error_description : "";
  try {
    if (oauthError) throw new Error(`${oauthError}${oauthErrorDescription ? `: ${oauthErrorDescription}` : ""}`);
    if (!code) throw new Error("Missing authorization code — check that this app's Valid OAuth Redirect URIs (Meta App Dashboard → Facebook Login → Settings) includes exactly this URL.");
    await runInAuthFlowTenant(req, () => handleFacebookCallback(code));
    res.send(oauthSuccessPage("Facebook"));
  } catch (err) {
    res.status(500).send(`Facebook connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

app.post("/api/accounts/facebook/disconnect", (_req, res) => {
  disconnectFacebook();
  res.status(204).end();
});

app.get("/auth/canva", async (req, res) => {
  try {
    const url = await runInAuthFlowTenant(req, () => getCanvaAuthUrl(stateParam(req)));
    res.redirect(url);
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : String(err));
  }
});

app.get("/auth/canva/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  const oauthErrorDescription = typeof req.query.error_description === "string" ? req.query.error_description : "";
  try {
    if (oauthError) throw new Error(`${oauthError}${oauthErrorDescription ? `: ${oauthErrorDescription}` : ""}`);
    if (!code) throw new Error("Missing authorization code");
    await runInAuthFlowTenant(req, () => handleCanvaCallback(code));
    res.send(oauthSuccessPage("Canva"));
  } catch (err) {
    res.status(500).send(`Canva connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});

app.post("/api/accounts/canva/disconnect", (_req, res) => {
  disconnectCanva();
  res.status(204).end();
});

// Catches multer errors (oversized file, etc.) as clean JSON instead of
// falling through to Express's default HTML error page.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

export function startServer(port = defaultPort()): Promise<number> {
  return new Promise((resolve, reject) => {
    initScheduler({ startCeoRun: runRunnerStartCeoRun, startSpecialistRun: runRunnerStartSpecialistRun });
    const server = app.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      process.env.PORT = String(actualPort);
      console.log(`CEO Agent OS running at http://localhost:${actualPort}`);
      resolve(actualPort);
    });
    server.once("error", reject);
  });
}

// Auto-start only when this file is the process entry point (`tsx
// src/server/index.ts`, i.e. dev/`npm start`) — not when Electron's main
// process imports startServer() itself to control startup order (settings
// must load into process.env before the server binds).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  startServer();
}
