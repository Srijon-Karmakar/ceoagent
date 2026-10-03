// ---------- State ----------

const state = {
  view: { type: "overview" }, // {type:"overview"} | {type:"department", key} | utility views such as accounts/documents/files
  theme: "light", // "light" | "dark" — set for real in initTheme() before first render
  departments: [],
  accounts: [],
  tools: [], // ToolCatalogEntry[] from /api/tools — loaded when the Tools view is active
  settings: [], // MaskedField[] from /api/settings — loaded when the Settings view is active
  runs: [],
  showArchived: false, // toggles the sidebar's Tasks lists between active and archived runs
  selectedRunId: null,
  selectedRun: null,
  documents: [],
  liveLinearTasks: [],
  sidebarOpen: false,
  analytics: null,
  logNearBottom: true, // whether the log feed should auto-follow new events
  toolOverrides: new Map(), // toolUseId -> explicit user expand/collapse choice
  goalExpanded: false, // whether the run-detail header shows the full goal text or a clamped preview
  attachments: [], // { filename, text, truncated, path? }[] — parsed files pending on the goal form; path is set for .html/.htm uploads (workspace-relative, for import_email_template_from_file)
  attaching: false, // true while an upload (or batch of uploads) is being parsed server-side
  attachError: null, // error message from the most recent failed upload(s), cleared on next attempt
  goalDrafts: {}, // goalDraftKey(view) -> in-progress #goal-input text, kept per-view so switching tabs (which re-renders the composer) doesn't lose what you were typing
  selectedModel: "auto", // "auto" | "claude" | "openai" | "deepseek" | "ollama" — model-picker dropdown on the goal composer; "auto" is today's Claude->OpenAI->DeepSeek->Ollama cascade, anything else pins to that one model with no fallback
  modelPickerOpen: false, // whether the model-picker's popover menu (triggered by the cpu icon button) is currently showing
  memoryHeroError: null, // error message from a failed "Feed Me" submit (e.g. request too large), cleared on next attempt
  confirmModal: null, // { title, message, confirmLabel, danger, onConfirm } | null
  schedules: [], // ScheduleRecord[] from /api/schedule — loaded when the Calendar department view is active
  calendarCursor: null, // Date (first-of-month currently displayed by the mini calendar / month panel) — lazily set on first render
  calendarSelectedDate: null, // "YYYY-MM-DD" | null — drives the detail panel; lazily set to today on first render
  calendarStatusFilter: "all", // "all" | "active" | "disabled" — filters which schedules render everywhere in the calendar view
  calendarRangeMode: false, // when true, two clicks pick a date range instead of one click just selecting a date
  calendarPendingStart: null, // "YYYY-MM-DD" | null — first click of a range, while awaiting the second
  scheduleModal: null, // draft object | null — see openScheduleModal()/openEditScheduleModal()
  leads: [], // LeadRecord[] from /api/leads — loaded when the CRM department view is active
  leadStageFilter: "all", // "all" | "open" | "won" | "lost" — filters which leads render in board/table
  leadModal: null, // draft object | null — see openLeadModal()/openEditLeadModal()
  crmTab: "board", // "board" | "table" | "stats" — which CRM sub-view is showing
  leadSearch: "", // free-text search across name/company/email/phone/owner/tags/notes
  leadFilters: { source: "all", followUp: "all" }, // "all" | specific source; "all"|"due"|"has"|"none"
  leadSort: { key: "createdAt", dir: "desc" }, // table view column sort
  leadImportModal: null, // { fileName, rows, submitting, error } | null — CSV import preview
  playbookItems: [], // PlaybookItem[] from /api/playbook — loaded when a Playbook view (sales|marketing) is active
  playbookModal: null, // draft object | null — see openEditPlaybookModal()
  contentCalendarItems: [], // PlaybookItem[] across both tabs, from /api/playbook (no tab param) — loaded when the Content Calendar view is active
  contentCalendarCursor: null, // Date (first-of-month) — lazily set on first render, separate from calendarCursor
  contentCalendarSelectedDate: null, // "YYYY-MM-DD" | null — lazily set to today on first render
  contentCalendarTypeFilter: "all", // "all" | one of PLAYBOOK_ITEM_TYPES
  portfolioProjects: [], // PortfolioProject[] from /api/portfolio/projects — loaded when the Portfolio view is active
  portfolioActiveProjectId: null, // id of the selected project tab, or null if none exist yet
  portfolioEntries: [], // PortfolioEntry[] for the active project only — reloaded on project switch
  portfolioCategoryFilter: "blog", // one of PORTFOLIO_TABS (a PortfolioCategory, or a PORTFOLIO_NOTE_TABS value) at a time
  portfolioEntryModal: null, // draft object | null — see openPortfolioEntryModal()
  portfolioProjectModal: null, // { mode: "add"|"rename", id?, name, submitting, error } | null
  portfolioNotes: [], // PortfolioNote[] for the active project only — reloaded on project switch, alongside portfolioEntries
  portfolioOpenNoteId: null, // id of the note currently drilled into, or null to show the notes list
  portfolioNoteDraft: null, // { title, content, mode: "preview"|"edit", dirty, saving, error } | null — local edit buffer for the open note
  portfolioOpenEntryId: null, // id of the portfolio entry currently drilled into, or null to show the table
  portfolioEntryDraft: null, // local edit buffer for the open entry, same shape as portfolioNoteDraft plus category/status/date/link/subject/recipient/messageId
  memoryEntries: [], // MemoryEntry[] from /api/memory — loaded when the Browse Memory view is active
  memoryOpenEntryId: null, // id of the memory entry currently drilled into, or null to show the list
  memoryEntryDraft: null, // { title, content, mode: "preview"|"edit", dirty, saving, error } | null — local edit buffer for the open entry
  guardedDeleteModal: null, // { title, message, requireText, confirmLabel, onConfirm, inputValue } | null — a delete confirm that also requires typing requireText to match before it enables, see openGuardedDeleteModal()
  memoryHeroInput: "", // controlled value for the Memory hero's own textarea (unlike the generic #goal-input, this needs to be tracked live so the hero can show "Watching..." while you type)
  memoryHeroSubmitting: false, // true from the moment "Feed Me" is clicked until submitGoal() resolves (covers the network round-trip before a run record even exists)
  filesChildren: new Map(), // virtual path ("" = roots) -> FileEntry[] already fetched, so re-expanding a folder is instant
  filesExpanded: new Set(), // virtual paths of folders currently expanded in the tree
  filesSelectedPath: null, // virtual path of the selected file/folder, or null
  filesSelectedEntry: null, // the FileEntry for filesSelectedPath
  filesPreview: null, // { kind: "text"|"image"|"pdf"|"none", ... } | "loading" | null — see loadFilePreview()
  filesUploadTarget: null, // virtual path the next Upload click saves into (defaults to the selected/open folder)
  filesUploading: false,
  filesError: null,
  folderModal: null, // { targetPath, name, error, submitting } | null — see openNewFolderModal()
  auth: {
    loading: true,
    mode: "login",
    config: null,
    user: null,
    recoveryAccessToken: null,
    error: null,
    message: null,
    submitting: false,
  },
};

let eventSource = null;
let lastRenderKey = null;
let memoryOrbCleanup = null;
const AUTH_STORAGE_KEY = "ceo_agent_supabase_session";

const NAV_STATIC = {
  overview: { key: "overview", label: "Overview", icon: "pie-chart" },
  files: { key: "files", label: "Files", icon: "folder" },
  accounts: { key: "accounts", label: "Accounts", icon: "plug-zap" },
  tools: { key: "tools", label: "Tools", icon: "wrench" },
  settings: { key: "settings", label: "Settings", icon: "settings" },
  portfolio: { key: "portfolio", label: "Portfolio", icon: "briefcase" },
  documents: { key: "documents", label: "Documents", icon: "file-text" },
};

// Shared by render() and renderNav() — Accounts/Files/Settings/Tools are
// full-width utility pages with no goal composer or run history, unlike
// Overview/a department. Takes the whole view object (not just .type) since
// the Memory department is the one exception that needs its .key too — it's
// a "department" view type but replaces the standard composer+run-history
// sidebar with its own full-page hero UI (see renderMemoryHero()).
function isFullWidthView(view) {
  if (view.type === "department" && view.key === "memory") return true;
  return (
    view.type === "accounts" ||
    view.type === "files" ||
    view.type === "settings" ||
    view.type === "tools" ||
    view.type === "documents" ||
    view.type === "playbook" ||
    view.type === "content-calendar" ||
    view.type === "portfolio" ||
    view.type === "memory-browse"
  );
}

// ---------- Helpers ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function brandTagline() {
  return state.auth.user?.organizationName || "Organization workspace";
}

function authRedirectUrl(kind) {
  const url = new URL(window.location.href);
  url.search = `?auth=${encodeURIComponent(kind)}`;
  url.hash = "";
  return url.toString();
}

function readAuthRedirectParams() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  if (hash.has("access_token") || hash.has("error") || hash.has("error_description") || hash.has("type")) return hash;
  if (search.has("access_token") || search.has("error") || search.has("error_description") || search.has("type")) return search;
  return null;
}

async function handleAuthRedirect() {
  const params = readAuthRedirectParams();
  if (!params) return false;

  const error = params.get("error_description") || params.get("error") || params.get("error_code");
  if (error) {
    state.auth.error = error;
    state.auth.mode = "login";
    window.history.replaceState(null, "", window.location.pathname);
    return true;
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const type = params.get("type") || new URLSearchParams(window.location.search).get("auth");
  if (type !== "recovery" || !accessToken) return false;

  const expiresIn = Number(params.get("expires_in") || 3600);
  const expiresAt = Number(params.get("expires_at") || Math.floor(Date.now() / 1000) + expiresIn);
  saveAuthSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
  });
  await syncBackendSession(accessToken);
  state.auth.recoveryAccessToken = accessToken;
  state.auth.mode = "reset";
  state.auth.error = null;
  state.auth.message = null;
  window.history.replaceState(null, "", window.location.pathname);
  return true;
}

function statusLabel(status) {
  return { running: "Running", success: "Done", error: "Failed" }[status] ?? status;
}

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleString() : "";
}

function formatClock(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

// Local-date (not UTC) YYYY-MM-DD, matching what the server's scheduler
// compares against — Date#toISOString would shift near midnight in
// timezones behind UTC and silently pick the wrong day.
function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseYmd(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"];
const LEAD_STAGE_LABELS = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

// Mirrors PROVIDER_ORDER/PROVIDER_LABELS in src/providers/llmFallback.ts — kept
// as a small local literal since the frontend has no build-time import of the
// backend's provider module. "auto" (today's cascade) is always the default.
const MODEL_OPTIONS = [
  { value: "auto", label: "Auto", description: "Claude → OpenAI → DeepSeek → Ollama" },
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "ollama", label: "Ollama (local)" },
];

const PLAYBOOK_ITEM_TYPES = ["ai-generative", "image", "carousel", "video", "reel", "email-script"];
const PLAYBOOK_TYPE_LABELS = {
  "ai-generative": "AI Generative",
  image: "Image",
  carousel: "Carousel",
  video: "Video",
  reel: "Reel",
  "email-script": "Email/Script",
};
const PLAYBOOK_TYPE_COLORS = {
  "ai-generative": { light: "#8a7a1f", dark: "#c9b23f" },
  image: { light: "#0891b2", dark: "#22b8cf" },
  carousel: { light: "#c2298a", dark: "#e058ac" },
  video: { light: "#2a5fd6", dark: "#5b85e8" },
  reel: { light: "#d64545", dark: "#e87373" },
  "email-script": { light: "#4a3aa7", dark: "#9085e9" },
};
function playbookTypeColor(type) {
  const pair = PLAYBOOK_TYPE_COLORS[type];
  return pair ? pair[state.theme] : "var(--accent)";
}

const PORTFOLIO_CATEGORIES = ["blog", "article", "collab", "pr-post", "email"];
const PORTFOLIO_CATEGORY_LABELS = {
  blog: "Blogs",
  article: "Articles",
  collab: "Collabs",
  "pr-post": "PR posts",
  email: "Emails",
};

// Freeform markdown notes — a separate model from PORTFOLIO_CATEGORIES
// entries above (no link/status/date), rendered as a list of notes you open
// to read/edit rather than a table. Still shown as tabs alongside the
// category tabs in the Portfolio toolbar — see PORTFOLIO_TABS below.
const PORTFOLIO_NOTE_TABS = ["project-details", "database"];
const PORTFOLIO_NOTE_TAB_LABELS = {
  "project-details": "Project details",
  database: "Database",
};

const PORTFOLIO_TABS = [...PORTFOLIO_CATEGORIES, ...PORTFOLIO_NOTE_TABS];
const PORTFOLIO_TAB_LABELS = { ...PORTFOLIO_CATEGORY_LABELS, ...PORTFOLIO_NOTE_TAB_LABELS };

const PORTFOLIO_STATUSES = ["draft", "published"];
const PORTFOLIO_STATUS_LABELS = { draft: "Draft", published: "Published" };

function describeRecurrence(r) {
  if (r.type === "once") return `once on ${r.date}`;
  const range = `${r.startDate}${r.endDate ? ` to ${r.endDate}` : " onward"}`;
  if (r.type === "daily") return `daily, ${range}`;
  return `weekly on ${r.weekdays.map((d) => WEEKDAY_NAMES[d]).join("/")}, ${range}`;
}

// Whether a recurrence covers a given calendar day — mirrors scheduler.ts's
// isDueToday (minus the time-of-day check, which only matters for firing,
// not for which cells get a dot).
function scheduleActiveOn(schedule, dateStr, dateObj) {
  const r = schedule.recurrence;
  if (r.type === "once") return r.date === dateStr;
  if (dateStr < r.startDate) return false;
  if (r.endDate && dateStr > r.endDate) return false;
  if (r.type === "daily") return true;
  return r.weekdays.includes(dateObj.getDay());
}

function scheduleAgentColor(agentKey) {
  if (agentKey === "ceo") return "var(--accent)";
  return deptColor(agentKey) || "var(--accent)";
}

function matchesStatusFilter(schedule) {
  if (state.calendarStatusFilter === "active") return schedule.enabled;
  if (state.calendarStatusFilter === "disabled") return !schedule.enabled;
  return true;
}

function filteredSchedules() {
  return state.schedules.filter(matchesStatusFilter);
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Agent text is markdown (Claude formats its responses that way). marked
// renders it to HTML; DOMPurify sanitizes it before it ever touches
// innerHTML, since tool results can carry arbitrary web/file content that
// later gets quoted back in an agent's own reply.
function renderMarkdown(text) {
  if (!text) return "";
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked.parse(text, { breaks: true }));
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

async function fetchJSON(url, opts) {
  if (!url.startsWith("/api/auth/")) {
    await refreshStoredSessionIfNeeded();
  }
  const res = await fetch(url, opts);
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    await resetToSignedOut("Your session expired. Sign in again.");
  }
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

function saveAuthSession(session) {
  if (!session?.access_token) return;
  const expiresAt = session.expires_at
    ? session.expires_at * 1000
    : Date.now() + (session.expires_in ?? 3600) * 1000;
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: expiresAt,
    }),
  );
}

function readStoredAuthSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

async function refreshStoredSessionIfNeeded(force = false) {
  const saved = readStoredAuthSession();
  if (!saved?.refresh_token) return null;
  if (!force && saved.expires_at && saved.expires_at - Date.now() > 120_000) return saved;
  const result = await supabaseAuthRequest("token?grant_type=refresh_token", {
    refresh_token: saved.refresh_token,
  });
  saveAuthSession(result);
  await syncBackendSession(result.access_token);
  return readStoredAuthSession();
}

async function supabaseAuthRequest(path, body) {
  const config = state.auth.config;
  if (!config?.enabled) throw new Error("Supabase authentication is not configured.");
  const res = await fetch(`${config.supabaseUrl}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.msg || json.message || `Supabase auth failed (${res.status})`);
  }
  return json;
}

async function updateSupabasePassword(password) {
  const config = state.auth.config;
  const accessToken = state.auth.recoveryAccessToken || readStoredAuthSession()?.access_token;
  if (!config?.enabled) throw new Error("Supabase authentication is not configured.");
  if (!accessToken) throw new Error("Password reset session is missing. Request a new reset link.");
  const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: config.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.msg || json.message || `Password reset failed (${res.status})`);
  }
  return json;
}

async function loadAuthConfig() {
  state.auth.config = await fetchJSON("/api/auth/config");
}

async function syncBackendSession(accessToken) {
  await fetchJSON("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
  });
}

async function loadCurrentUser() {
  try {
    state.auth.user = await fetchJSON("/api/auth/me");
  } catch {
    try {
      await refreshStoredSessionIfNeeded(true);
      state.auth.user = await fetchJSON("/api/auth/me");
    } catch {
      state.auth.user = null;
    }
  } finally {
    state.auth.loading = false;
  }
}

async function resetToSignedOut(message) {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  state.auth.user = null;
  state.auth.mode = "login";
  state.auth.recoveryAccessToken = null;
  state.auth.message = message ?? null;
  state.auth.error = null;
  state.auth.loading = false;
  state.runs = [];
  state.selectedRunId = null;
  state.selectedRun = null;
  state.accounts = [];
  state.tools = [];
  state.settings = [];
  state.documents = [];
}

async function handleAuthSubmit(form) {
  state.auth.submitting = true;
  state.auth.error = null;
  state.auth.message = null;
  render();
  try {
    if (state.auth.mode === "forgot") {
      const email = form.email.value.trim();
      if (!email) throw new Error("Email is required.");
      await supabaseAuthRequest("recover", {
        email,
        redirect_to: authRedirectUrl("recovery"),
      });
      state.auth.mode = "login";
      state.auth.message = "If an account exists for that email, a reset link has been sent.";
      return;
    }

    if (state.auth.mode === "reset") {
      const password = form.password.value;
      const confirmPassword = form.confirmPassword.value;
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (password !== confirmPassword) throw new Error("Passwords do not match.");
      await updateSupabasePassword(password);
      await fetchJSON("/api/auth/logout", { method: "POST" }).catch(() => null);
      await resetToSignedOut("Password updated. Sign in with your new password.");
      return;
    }

    const email = form.email.value.trim();
    const password = form.password.value;
    if (state.auth.mode === "signup") {
      const name = form.name.value.trim();
      const organizationName = form.organizationName.value.trim();
      if (!name || !organizationName) throw new Error("Name and organization are required.");
      const result = await supabaseAuthRequest("signup", {
        email,
        password,
        data: { name, organization_name: organizationName },
      });
      const accessToken = result.access_token || result.session?.access_token;
      if (!accessToken) {
        await resetToSignedOut("Check your email to confirm your account, then sign in.");
        return;
      }
      saveAuthSession(result.session ?? result);
      await syncBackendSession(accessToken);
    } else {
      const result = await supabaseAuthRequest("token?grant_type=password", { email, password });
      saveAuthSession(result);
      await syncBackendSession(result.access_token);
    }
    await loadCurrentUser();
    await loadAppData();
  } catch (err) {
    state.auth.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.auth.submitting = false;
    render();
  }
}

async function logout() {
  await fetchJSON("/api/auth/logout", { method: "POST" }).catch(() => null);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  await resetToSignedOut(null);
  render();
}

function departmentMeta(key) {
  return state.departments.find((d) => d.key === key);
}

function deptColor(key) {
  const meta = departmentMeta(key);
  return meta ? meta.color[state.theme] : null;
}

function sourceLabel(source) {
  if (source === "ceo") return "CEO";
  if (source === "user") return "You";
  return departmentMeta(source)?.label ?? capitalize(source);
}

function avatarInitial(source) {
  return (sourceLabel(source) || "?").slice(0, 1).toUpperCase();
}

// ---------- Theme ----------

function initTheme() {
  const saved = localStorage.getItem("theme");
  state.theme = saved === "light" || saved === "dark" ? saved : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
}

function systemPrefersDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

// Matches the CSS `@media (min-width: 720px)` breakpoint (style.css) that
// turns .sidebar from an off-canvas drawer into a permanent column — below
// it, render() moves the composer out of that drawer into .main instead.
const MOBILE_LAYOUT_QUERY = "(max-width: 719.98px)";

function isMobileLayout() {
  return window.matchMedia?.(MOBILE_LAYOUT_QUERY).matches ?? false;
}

// Matches the CSS `@media (min-width: 860px)` breakpoint that shows
// .header-menu (File/Settings/Portfolio/Documents/Accounts/Tools). Below
// it .header-menu is display:none with no replacement, so those 6
// destinations were unreachable on any phone and most tablets — this
// flag drives folding the same links into the sidebar instead (see
// renderSidebar), which is already visible there (an off-canvas drawer
// below 720px, a permanent column from 720-859px).
const NAV_COLLAPSED_QUERY = "(max-width: 859.98px)";

function isNavCollapsed() {
  return window.matchMedia?.(NAV_COLLAPSED_QUERY).matches ?? false;
}

// Re-render only when crossing the breakpoint (not on every resize pixel),
// so the composer hops between .sidebar and .main as the viewport crosses
// 720px without spamming re-renders.
function initResponsiveLayout() {
  window.matchMedia?.(MOBILE_LAYOUT_QUERY).addEventListener("change", () => render());
  window.matchMedia?.(NAV_COLLAPSED_QUERY).addEventListener("change", () => render());
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("theme", state.theme);
  document.documentElement.setAttribute("data-theme", state.theme);
  render(); // chart colors and department accents are theme-dependent — full re-render
}

// Identifies a view for the purpose of keying state.goalDrafts — distinct
// departments/playbooks each get their own draft slot.
function goalDraftKey(view) {
  return `${view.type}:${view.key ?? ""}`;
}

function viewLabel() {
  if (state.view.type === "overview") return NAV_STATIC.overview.label;
  if (state.view.type === "files") return NAV_STATIC.files.label;
  if (state.view.type === "accounts") return NAV_STATIC.accounts.label;
  if (state.view.type === "tools") return NAV_STATIC.tools.label;
  if (state.view.type === "settings") return NAV_STATIC.settings.label;
  if (state.view.type === "portfolio") return NAV_STATIC.portfolio.label;
  if (state.view.type === "playbook") return state.view.key === "sales" ? "Sales Playbook" : "Marketing Playbook";
  if (state.view.type === "content-calendar") return "Content Calendar";
  return departmentMeta(state.view.key)?.label ?? state.view.key;
}

// ---------- Data loading ----------

async function loadDepartments() {
  state.departments = await fetchJSON("/api/departments");
}

async function loadAccounts() {
  state.accounts = await fetchJSON("/api/accounts");
}

async function loadTools() {
  state.tools = await fetchJSON("/api/tools");
}

async function loadSettings() {
  state.settings = await fetchJSON("/api/settings");
}

async function loadAnalytics() {
  state.analytics = await fetchJSON("/api/analytics");
}

async function loadRunsForCurrentView() {
  const archivedParam = `archived=${state.showArchived}`;
  if (state.view.type === "overview") {
    state.runs = await fetchJSON(`/api/runs?${archivedParam}`);
  } else if (state.view.type === "department") {
    state.runs = await fetchJSON(
      `/api/runs?agentKey=${encodeURIComponent(state.view.key)}&${archivedParam}`,
    );
  } else {
    state.runs = [];
  }
}

async function loadAppData() {
  await Promise.all([loadDepartments(), loadAccounts()]);
  await Promise.all([loadRunsForCurrentView(), loadAnalytics()]);
}

async function toggleArchivedFilter() {
  state.showArchived = !state.showArchived;
  await loadRunsForCurrentView();
  render();
}

// Archive/unarchive/delete all refresh the current task list afterward, and
// clear the open run detail if that's the run just acted on — archived runs
// stay viewable via the Archived toggle, but a deleted one no longer exists.
async function archiveRun(id) {
  await fetchJSON(`/api/runs/${id}/archive`, { method: "POST" });
  await loadRunsForCurrentView();
  if (state.selectedRunId === id) {
    state.selectedRunId = null;
    state.selectedRun = null;
  }
  render();
}

async function unarchiveRun(id) {
  await fetchJSON(`/api/runs/${id}/unarchive`, { method: "POST" });
  await loadRunsForCurrentView();
  if (state.selectedRunId === id) {
    state.selectedRunId = null;
    state.selectedRun = null;
  }
  render();
}

async function pinRun(id) {
  await fetchJSON(`/api/runs/${id}/pin`, { method: "POST" });
  await loadRunsForCurrentView();
  if (state.selectedRun && state.selectedRun.id === id) state.selectedRun.pinned = true;
  render();
}

async function unpinRun(id) {
  await fetchJSON(`/api/runs/${id}/unpin`, { method: "POST" });
  await loadRunsForCurrentView();
  if (state.selectedRun && state.selectedRun.id === id) state.selectedRun.pinned = false;
  render();
}

function deleteRun(id) {
  openConfirmModal({
    title: "Delete this task?",
    message: "Its log and cost history will be permanently removed. This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeleteRun(id),
  });
}

async function performDeleteRun(id) {
  await fetchJSON(`/api/runs/${id}`, { method: "DELETE" });
  await loadRunsForCurrentView();
  if (state.selectedRunId === id) {
    state.selectedRunId = null;
    state.selectedRun = null;
  }
  render();
}

// ---------- Confirm modal ----------
//
// A single reusable centered dialog for anything that needs a yes/no gate
// before a destructive action, replacing window.confirm() with UI that
// matches the app instead of the browser's native prompt.
function openConfirmModal({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  state.confirmModal = { title, message, confirmLabel, danger, onConfirm };
  render();
}

function closeConfirmModal() {
  state.confirmModal = null;
  render();
}

function renderConfirmModal() {
  const m = state.confirmModal;
  if (!m) return "";
  return `
    <div class="confirm-backdrop" id="confirm-backdrop">
      <div class="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <h3 id="confirm-modal-title">${escapeHtml(m.title)}</h3>
        <p class="confirm-modal-message">${escapeHtml(m.message)}</p>
        <div class="confirm-modal-actions">
          <button type="button" class="confirm-btn confirm-btn-cancel" id="confirm-modal-cancel">Cancel</button>
          <button type="button" class="confirm-btn ${m.danger ? "confirm-btn-danger" : "confirm-btn-primary"}" id="confirm-modal-confirm">${escapeHtml(m.confirmLabel)}</button>
        </div>
      </div>
    </div>
  `;
}

// A stricter sibling of openConfirmModal for permanent/hard-to-recover
// deletes (memory entries today) — the Delete button stays disabled until
// the user types the entity's exact title, so it can't be dismissed away
// with the same single reflex click as an ordinary confirm.
function openGuardedDeleteModal({ title, message, requireText, confirmLabel = "Delete", onConfirm }) {
  state.guardedDeleteModal = { title, message, requireText, confirmLabel, onConfirm, inputValue: "" };
  render();
}

function closeGuardedDeleteModal() {
  state.guardedDeleteModal = null;
  render();
}

function renderGuardedDeleteModal() {
  const m = state.guardedDeleteModal;
  if (!m) return "";
  const matches = m.inputValue === m.requireText;
  return `
    <div class="confirm-backdrop" id="guarded-delete-backdrop">
      <div class="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="guarded-delete-title">
        <h3 id="guarded-delete-title">${escapeHtml(m.title)}</h3>
        <p class="confirm-modal-message">${escapeHtml(m.message)}</p>
        <p class="confirm-modal-message">Type <strong>${escapeHtml(m.requireText)}</strong> to confirm.</p>
        <input type="text" class="guarded-delete-input" id="guarded-delete-input" value="${escapeHtml(m.inputValue)}" autocomplete="off" placeholder="${escapeHtml(m.requireText)}" />
        <div class="confirm-modal-actions">
          <button type="button" class="confirm-btn confirm-btn-cancel" id="guarded-delete-cancel">Cancel</button>
          <button type="button" class="confirm-btn confirm-btn-danger" id="guarded-delete-confirm" ${matches ? "" : "disabled"}>${escapeHtml(m.confirmLabel)}</button>
        </div>
      </div>
    </div>
  `;
}

async function loadDocumentsForCurrentView() {
  if (state.view.type === "department") {
    state.documents = await fetchJSON(`/api/documents?agentKey=${encodeURIComponent(state.view.key)}`);
  } else if (state.view.type === "documents") {
    state.documents = await fetchJSON("/api/documents");
  } else {
    state.documents = [];
  }
}

async function loadSchedules() {
  state.schedules = await fetchJSON("/api/schedule");
}

async function loadLeads() {
  state.leads = await fetchJSON("/api/leads");
}

async function loadPlaybookItems(tab) {
  state.playbookItems = await fetchJSON(`/api/playbook?tab=${encodeURIComponent(tab)}`);
}

// Separate from state.playbookItems (tab-scoped, owned by the Playbook view)
// so the two views never clobber each other's data when switching back and
// forth without a full reload in between.
async function loadContentCalendarItems() {
  state.contentCalendarItems = await fetchJSON("/api/playbook");
}

// Shared by savePlaybookModal/togglePlaybookDone/performDeletePlaybookItem —
// the edit modal is reachable from both the Playbook view (tab-scoped) and
// the Content Calendar (all-items), so the reload after a mutation has to
// match whichever view is actually open.
async function reloadPlaybookData() {
  if (state.view.type === "content-calendar") {
    await loadContentCalendarItems();
  } else {
    await loadPlaybookItems(state.view.key);
  }
}

async function loadPortfolioProjects() {
  state.portfolioProjects = await fetchJSON("/api/portfolio/projects");
  if (!state.portfolioProjects.some((p) => p.id === state.portfolioActiveProjectId)) {
    state.portfolioActiveProjectId = state.portfolioProjects[0]?.id ?? null;
  }
  await Promise.all([loadPortfolioEntries(), loadPortfolioNotes()]);
}

async function loadPortfolioEntries() {
  if (!state.portfolioActiveProjectId) {
    state.portfolioEntries = [];
    return;
  }
  state.portfolioEntries = await fetchJSON(`/api/portfolio/entries?projectId=${encodeURIComponent(state.portfolioActiveProjectId)}`);
}

async function loadPortfolioNotes() {
  if (!state.portfolioActiveProjectId) {
    state.portfolioNotes = [];
    return;
  }
  state.portfolioNotes = await fetchJSON(`/api/portfolio/notes?projectId=${encodeURIComponent(state.portfolioActiveProjectId)}`);
}

// ---------- Memory (Browse view) ----------

async function loadMemoryEntries() {
  state.memoryEntries = await fetchJSON("/api/memory");
}

// ---------- Files view ----------

async function loadFilesDir(virtualPath) {
  const data = await fetchJSON(`/api/files/list?path=${encodeURIComponent(virtualPath)}`);
  state.filesChildren.set(virtualPath, data.entries);
  return data.entries;
}

async function loadFilesRoot() {
  state.filesError = null;
  try {
    await loadFilesDir("");
  } catch (err) {
    state.filesError = err instanceof Error ? err.message : String(err);
  }
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  ".md", ".txt", ".csv", ".json", ".js", ".ts", ".html", ".css", ".log", ".yml", ".yaml",
]);
const IMAGE_PREVIEW_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function fileIconFor(name) {
  const ext = extOf(name);
  if (IMAGE_PREVIEW_EXTENSIONS.has(ext)) return "image";
  if (ext === ".pdf") return "file-text";
  if ([".xlsx", ".xls", ".csv"].includes(ext)) return "file-spreadsheet";
  if ([".doc", ".docx"].includes(ext)) return "file-text";
  if ([".ppt", ".pptx"].includes(ext)) return "presentation";
  if (TEXT_PREVIEW_EXTENSIONS.has(ext)) return "file-text";
  return "file";
}

async function toggleFilesFolder(path) {
  if (state.filesExpanded.has(path)) {
    state.filesExpanded.delete(path);
    render();
    return;
  }
  state.filesExpanded.add(path);
  render();
  if (!state.filesChildren.has(path)) {
    try {
      await loadFilesDir(path);
    } catch (err) {
      state.filesError = err instanceof Error ? err.message : String(err);
    }
    render();
  }
}

async function selectFilesEntry(entry) {
  state.filesSelectedPath = entry.path;
  state.filesSelectedEntry = entry;
  state.filesError = null;
  if (entry.type === "dir") {
    state.filesUploadTarget = entry.path;
    state.filesPreview = null;
    await toggleFilesFolder(entry.path);
    return;
  }
  // A file's own folder is where "Upload" should land next, not the file itself.
  state.filesUploadTarget = entry.path.split("/").slice(0, -1).join("/");
  state.filesPreview = "loading";
  render();
  await loadFilePreview(entry);
}

async function loadFilePreview(entry) {
  const ext = extOf(entry.name);
  try {
    if (IMAGE_PREVIEW_EXTENSIONS.has(ext)) {
      state.filesPreview = { kind: "image", url: `/api/files/raw?path=${encodeURIComponent(entry.path)}` };
    } else if (ext === ".pdf") {
      state.filesPreview = { kind: "pdf", url: `/api/files/raw?path=${encodeURIComponent(entry.path)}` };
    } else if (TEXT_PREVIEW_EXTENSIONS.has(ext) && (entry.size ?? 0) <= MAX_TEXT_PREVIEW_BYTES) {
      const res = await fetch(`/api/files/raw?path=${encodeURIComponent(entry.path)}`);
      const text = await res.text();
      state.filesPreview = { kind: ext === ".md" ? "markdown" : "text", text };
    } else {
      state.filesPreview = { kind: "none" };
    }
  } catch (err) {
    state.filesPreview = { kind: "none" };
    state.filesError = err instanceof Error ? err.message : String(err);
  }
  render();
}

function formatFileSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function deleteFilesEntry(path) {
  const name = path.split("/").pop();
  openConfirmModal({
    title: `Delete "${name}"?`,
    message: "This permanently removes it from disk. This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeleteFilesEntry(path),
  });
}

async function performDeleteFilesEntry(path) {
  const parentPath = path.split("/").slice(0, -1).join("/");
  state.filesError = null;
  try {
    const res = await fetch(`/api/files/entry?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `delete failed (${res.status})`);
    }
    state.filesChildren.delete(path);
    state.filesExpanded.delete(path);
    state.filesChildren.delete(parentPath);
    if (state.filesSelectedPath === path || state.filesSelectedPath?.startsWith(`${path}/`)) {
      state.filesSelectedPath = null;
      state.filesSelectedEntry = null;
      state.filesPreview = null;
    }
    await loadFilesDir(parentPath);
  } catch (err) {
    state.filesError = err instanceof Error ? err.message : String(err);
  } finally {
    render();
  }
}

async function uploadFilesToTarget(fileList) {
  const target = state.filesUploadTarget || state.filesSelectedPath;
  if (!target || !fileList?.length) return;
  state.filesUploading = true;
  state.filesError = null;
  render();
  try {
    const formData = new FormData();
    formData.append("path", target);
    for (const file of fileList) formData.append("files", file);
    const res = await fetch("/api/files/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `upload failed (${res.status})`);
    }
    state.filesChildren.delete(target);
    state.filesExpanded.add(target);
    await loadFilesDir(target);
  } catch (err) {
    state.filesError = err instanceof Error ? err.message : String(err);
  } finally {
    state.filesUploading = false;
    render();
  }
}

function openNewFolderModal(targetPath) {
  state.folderModal = { targetPath, name: "", error: null, submitting: false };
  render();
  document.getElementById("folder-modal-input")?.focus();
}

function closeFolderModal() {
  state.folderModal = null;
  render();
}

async function submitNewFolder() {
  const m = state.folderModal;
  const input = document.getElementById("folder-modal-input");
  const name = (input?.value ?? m?.name ?? "").trim();
  if (!m || !name) return;
  m.submitting = true;
  m.error = null;
  render();
  try {
    const res = await fetch("/api/files/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: m.targetPath, name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `create folder failed (${res.status})`);
    }
    const { entry } = await res.json();
    state.filesChildren.delete(m.targetPath);
    state.filesExpanded.add(m.targetPath);
    await loadFilesDir(m.targetPath);
    state.folderModal = null;
    await selectFilesEntry(entry);
  } catch (err) {
    if (state.folderModal) {
      state.folderModal.error = err instanceof Error ? err.message : String(err);
      state.folderModal.submitting = false;
    }
    render();
  }
}

function renderFolderModal() {
  const m = state.folderModal;
  if (!m) return "";
  return `
    <div class="confirm-backdrop" id="folder-modal-backdrop">
      <div class="confirm-modal folder-modal" role="dialog" aria-modal="true" aria-labelledby="folder-modal-title">
        <h3 id="folder-modal-title">New folder</h3>
        <form id="folder-modal-form">
          <input type="text" id="folder-modal-input" placeholder="Folder name" value="${escapeHtml(m.name)}" autocomplete="off" />
          ${m.error ? `<p class="folder-modal-error">${escapeHtml(m.error)}</p>` : ""}
          <div class="confirm-modal-actions">
            <button type="button" class="confirm-btn confirm-btn-cancel" id="folder-modal-cancel">Cancel</button>
            <button type="submit" class="confirm-btn confirm-btn-primary" id="folder-modal-confirm" ${m.submitting ? "disabled" : ""}>${m.submitting ? "Creating…" : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// ---------- View switching ----------

async function switchView(view) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  state.view = view;
  state.selectedRunId = null;
  state.selectedRun = null;
  state.liveLinearTasks = [];
  state.sidebarOpen = false;
  state.showArchived = false;
  state.calendarPendingStart = null;
  state.scheduleModal = null;
  state.leadModal = null;
  state.playbookModal = null;
  state.portfolioEntryModal = null;
  state.portfolioProjectModal = null;
  state.portfolioOpenNoteId = null;
  state.portfolioNoteDraft = null;
  state.portfolioOpenEntryId = null;
  state.portfolioEntryDraft = null;
  state.memoryOpenEntryId = null;
  state.memoryEntryDraft = null;
  state.guardedDeleteModal = null;
  state.memoryHeroInput = "";
  state.memoryHeroSubmitting = false;
  render();
  const loaders = [loadRunsForCurrentView(), loadDocumentsForCurrentView()];
  if (view.type === "overview") loaders.push(loadAnalytics());
  if (view.type === "department" && view.key === "calendar") loaders.push(loadSchedules());
  if (view.type === "department" && view.key === "crm") loaders.push(loadLeads());
  if (view.type === "playbook") loaders.push(loadPlaybookItems(view.key));
  if (view.type === "content-calendar") loaders.push(loadContentCalendarItems());
  if (view.type === "files") loaders.push(loadFilesRoot());
  if (view.type === "settings") loaders.push(loadSettings());
  if (view.type === "tools") loaders.push(loadTools());
  if (view.type === "portfolio") loaders.push(loadPortfolioProjects());
  if (view.type === "memory-browse") loaders.push(loadMemoryEntries());
  await Promise.all(loaders);

  // A department page with real run history but nothing selected used to
  // just show a blank "submit a goal" prompt — auto-open the most recent
  // run instead, so landing on e.g. Manager never looks empty when it
  // isn't. Overview/Calendar/CRM/Memory are exempt: each already has its own
  // "nothing selected" dashboard (bento overview, calendar grid, lead
  // kanban board, the Memory hero — see renderMain) that this would
  // otherwise always hide behind the latest run's log. Memory in particular
  // must never auto-open a past run — its hero UI treats "a run is
  // selected" as "I was just fed something, show Analysing/Done," which
  // would misfire showing stale state on every visit otherwise.
  const hasOwnDashboard = view.type === "department" && (view.key === "calendar" || view.key === "crm" || view.key === "memory");
  if (view.type === "department" && !hasOwnDashboard && state.runs.length > 0) {
    await selectRun(state.runs[0].id);
    return;
  }

  render();
}

async function selectRun(id) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  state.selectedRunId = id;
  state.sidebarOpen = false;
  state.logNearBottom = true;
  state.toolOverrides = new Map();
  state.goalExpanded = false;
  const run = await fetchJSON(`/api/runs/${id}`);
  state.selectedRun = run;
  state.liveLinearTasks = [...run.linearTasks];
  render();

  // The GET above already has every event recorded so far — replay=0 so the
  // stream only adds what happens *after* this point instead of re-sending
  // (and re-appending) the same history a second time.
  eventSource = new EventSource(`/api/runs/${id}/stream?replay=0`);
  eventSource.onmessage = (msg) => handleStreamEvent(JSON.parse(msg.data));
  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
  };
}

function extractLinearTask(text) {
  const match = text.match(/^Created (\S+): (.+?)\n(https?:\/\/\S+)/);
  if (!match) return null;
  return { identifier: match[1], title: match[2], url: match[3] };
}

function handleStreamEvent(event) {
  if (!state.selectedRun) return;

  if (event.type === "tool_result" && !event.isError) {
    const task = extractLinearTask(event.text);
    if (task && !state.liveLinearTasks.some((t) => t.identifier === task.identifier)) {
      state.liveLinearTasks.push(task);
    }
  }

  if (event.type !== "run_finished") {
    state.selectedRun.events.push(event);
  } else {
    state.selectedRun.status = event.status;
    state.selectedRun.costUsd = event.costUsd;
    state.selectedRun.summary = event.summary;
    state.selectedRun.linearTasks = state.liveLinearTasks;
    state.selectedRun.sessionId = event.sessionId ?? state.selectedRun.sessionId;
    loadRunsForCurrentView().then(render);
    loadDocumentsForCurrentView().then(render);
  }

  render();
}

function memoryHeroStatus() {
  if (state.selectedRun) {
    if (state.selectedRun.status === "running") return "analysing";
    if (state.selectedRun.status === "success") return "done";
    if (state.selectedRun.status === "error") return "error";
  }
  if (state.memoryHeroSubmitting) return "analysing";
  if (state.memoryHeroInput.trim()) return "watching";
  return "thinking";
}

const MEMORY_HERO_STATUS_TEXT = {
  thinking: "The Brain",
  watching: "Watching…",
  analysing: "Analysing…",
  done: "Done..",
  error: "Hmm, that didn't work",
};

const MEMORY_HERO_LOTTIE_MARKERS = {
  thinking: "jump",
  watching: "alert",
  analysing: "thinking",
  done: "yes",
  error: "no",
};

// The Memory agent's prompt (agents.ts) always ends its reply with a short,
// concrete confirmation of what it stored — that's exactly what belongs
// here, so pull the run's last assistant text message rather than
// fabricating a generic "saved!" that could be wrong (e.g. if it actually
// answered a question instead of storing anything).
function memoryHeroConfirmation() {
  const run = state.selectedRun;
  if (!run) return "";
  if (run.status === "error") return run.summary || "Nothing was saved — something went wrong.";
  const textEvents = (run.events || []).filter((e) => e.type === "text");
  const last = textEvents[textEvents.length - 1];
  return (last?.text || run.summary || "Saved.").trim();
}

// ---------- Actions ----------

async function submitGoal(goal) {
  // The record's own displayed goal stays exactly what was typed — the
  // server appends each attachment's text only to what the agent receives,
  // so a large file dump never ends up rendered as a run's heading.
  const attachments = state.attachments.length ? state.attachments : undefined;
  const provider = state.selectedModel || "auto";
  let id;
  if (state.view.type === "overview") {
    ({ id } = await fetchJSON("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, attachments, provider }),
    }));
  } else if (state.view.type === "department") {
    ({ id } = await fetchJSON(`/api/agents/${state.view.key}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, attachments, provider }),
    }));
  } else {
    return;
  }
  state.attachments = [];
  state.attachError = null;
  await loadRunsForCurrentView();
  render();
  await selectRun(id);
}

// Uploads every file from a (possibly multi-select) FileList in parallel and
// appends each successfully parsed one to state.attachments — additive, not
// replacing, so picking files in two batches (or dragging more in later)
// keeps what's already attached. One bad file (wrong type, too large) is
// reported without discarding the others that parsed fine.
async function uploadAttachments(fileList) {
  const files = Array.from(fileList ?? []);
  if (!files.length) return;

  state.attaching = true;
  state.attachError = null;
  render();

  // Unlike fetchJSON, this hits a plain fetch (multipart body, not JSON) —
  // it still needs the same proactive session refresh, or a token that's
  // about to expire fails only here while every other request keeps working.
  await refreshStoredSessionIfNeeded();

  let sawAuthFailure = false;
  const results = await Promise.allSettled(
    files.map(async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (res.status === 401) sawAuthFailure = true;
      // A failed-auth or proxy/5xx response can come back as an HTML error
      // page rather than JSON — parse defensively instead of letting a raw
      // "Unexpected token '<'" surface as the error message.
      let data = null;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Upload failed (${res.status})`);
      }
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status})`);
      return { filename: data.filename, text: data.text, truncated: data.truncated, path: data.path };
    }),
  );

  if (sawAuthFailure) {
    state.attaching = false;
    await resetToSignedOut("Your session expired. Sign in again.");
    return;
  }

  for (const result of results) {
    if (result.status === "fulfilled") state.attachments.push(result.value);
  }
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length) {
    state.attachError = failures.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason))).join("; ");
  }

  state.attaching = false;
  render();
}

function removeAttachment(index) {
  state.attachments.splice(index, 1);
  render();
}

// Continues a finished run's same agent session (via the server's resume
// endpoint) instead of submitGoal's fresh-run path. Re-fetches the record
// (now flipped back to "running" with the same event history) and opens a
// new stream that skips replay — that history is already in hand, only new
// events from here are wanted.
async function sendReply(id, message) {
  await fetchJSON(`/api/runs/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  const run = await fetchJSON(`/api/runs/${id}`);
  state.selectedRun = run;
  state.liveLinearTasks = [...run.linearTasks];
  state.logNearBottom = true;
  render();

  eventSource = new EventSource(`/api/runs/${id}/stream?replay=0`);
  eventSource.onmessage = (msg) => handleStreamEvent(JSON.parse(msg.data));
  eventSource.onerror = () => {
    eventSource?.close();
    eventSource = null;
  };
}

async function disconnectAccount(key) {
  await fetchJSON(`/api/accounts/${key}/disconnect`, { method: "POST" });
  await loadAccounts();
  render();
}

// Connect links open target="_blank" — main.cjs's setWindowOpenHandler routes
// that to the OS's real browser instead of Electron's embedded webview
// (Google and others block OAuth sign-in from an embedded one). Since the
// app window never navigates away, we can't rely on the callback redirecting
// back to it; instead poll until the account flips to connected, then
// refresh state and ask the main process to bring the window forward.
const accountConnectPolls = new Map();

function startAccountConnectPoll(key) {
  if (accountConnectPolls.has(key)) return;
  const startedAt = Date.now();
  const intervalId = setInterval(async () => {
    if (Date.now() - startedAt > 2 * 60 * 1000) {
      clearInterval(intervalId);
      accountConnectPolls.delete(key);
      return;
    }
    try {
      const accounts = await fetchJSON("/api/accounts");
      const match = accounts.find((a) => a.key === key);
      if (match?.connected) {
        clearInterval(intervalId);
        accountConnectPolls.delete(key);
        state.accounts = accounts;
        window.ceoAgent?.focusWindow?.();
        render();
      }
    } catch {
      // Transient fetch errors while polling aren't worth surfacing — the next tick retries.
    }
  }, 1500);
  accountConnectPolls.set(key, intervalId);
}

// ---------- Calendar / scheduled automations ----------

// Lazily initializes the three pieces of "where are we looking" state to
// today, once — separate from state.scheduleModal (what's being created/
// edited) and state.calendarPendingStart (an in-progress range selection).
function ensureCalendarState() {
  if (!state.calendarCursor) {
    const now = new Date();
    state.calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (!state.calendarSelectedDate) {
    state.calendarSelectedDate = ymd(new Date());
  }
}

function shiftCalendarMonth(delta) {
  ensureCalendarState();
  state.calendarCursor = new Date(state.calendarCursor.getFullYear(), state.calendarCursor.getMonth() + delta, 1);
  render();
}

function goToToday() {
  const now = new Date();
  state.calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  state.calendarSelectedDate = ymd(now);
  render();
}

function setCalendarStatusFilter(filter) {
  state.calendarStatusFilter = filter;
  render();
}

function toggleCalendarRangeMode() {
  state.calendarRangeMode = !state.calendarRangeMode;
  state.calendarPendingStart = null;
  render();
}

function clearCalendarSelection() {
  state.calendarPendingStart = null;
  render();
}

// Shared by every clickable date cell (mini calendar and the big month
// grid): a plain click just selects the date (drives the detail panel and
// keeps the detail panel focused) — it never opens the create
// modal by surprise. Creating happens explicitly via the toolbar's "+"
// button, the detail panel's "+" button, or completing a 2-click range
// selection, which is unambiguously an intent to create.
function selectCalendarDate(dateStr) {
  if (state.calendarRangeMode) {
    if (!state.calendarPendingStart) {
      state.calendarPendingStart = dateStr;
      render();
      return;
    }
    const start = state.calendarPendingStart < dateStr ? state.calendarPendingStart : dateStr;
    const end = state.calendarPendingStart < dateStr ? dateStr : state.calendarPendingStart;
    state.calendarPendingStart = null;
    openScheduleModal(start, end);
    return;
  }
  state.calendarSelectedDate = dateStr;
  render();
}

function defaultScheduleAgentKey() {
  return state.departments.find((d) => d.key !== "calendar")?.key ?? state.departments[0]?.key ?? "ceo";
}

function openScheduleModal(start, end) {
  const isRange = start !== end;
  state.scheduleModal = {
    id: null,
    label: "",
    goal: "",
    agentKey: defaultScheduleAgentKey(),
    time: "09:00",
    recurrenceType: isRange ? "daily" : "once",
    date: start,
    startDate: start,
    endDate: end,
    weekdays: [],
    submitting: false,
    error: null,
  };
  render();
}

// Opens the same modal pre-filled from an existing ScheduleRecord, so
// clicking an automation (in the week grid or the detail panel) edits it
// in place rather than only offering toggle/delete from a list.
function openEditScheduleModal(schedule) {
  const r = schedule.recurrence;
  state.scheduleModal = {
    id: schedule.id,
    label: schedule.label,
    goal: schedule.goal,
    agentKey: schedule.agentKey,
    time: schedule.time,
    recurrenceType: r.type,
    date: r.type === "once" ? r.date : "",
    startDate: r.type !== "once" ? r.startDate : "",
    endDate: r.type !== "once" ? (r.endDate ?? "") : "",
    weekdays: r.type === "weekly" ? r.weekdays : [],
    submitting: false,
    error: null,
  };
  render();
}

function closeScheduleModal() {
  state.scheduleModal = null;
  render();
}

// Reads the live form values back into state.scheduleModal before a
// recurrence-type change forces a re-render — render() rebuilds the whole
// modal from state, and without this, whatever the user had already typed
// into label/goal/etc. would be silently discarded by that rebuild.
function syncScheduleModalFromForm() {
  const form = document.getElementById("schedule-form");
  if (!form || !state.scheduleModal) return;
  const weekdays = [...form.querySelectorAll('input[name="weekday"]:checked')].map((cb) => Number(cb.value));
  Object.assign(state.scheduleModal, {
    label: form.label.value,
    goal: form.goal.value,
    agentKey: form.agentKey.value,
    time: form.time.value,
    date: form.date ? form.date.value : state.scheduleModal.date,
    startDate: form.startDate ? form.startDate.value : state.scheduleModal.startDate,
    endDate: form.endDate ? form.endDate.value : state.scheduleModal.endDate,
    weekdays,
  });
}

function changeScheduleRecurrenceType(type) {
  syncScheduleModalFromForm();
  state.scheduleModal.recurrenceType = type;
  render();
}

function buildRecurrenceFromModal(m) {
  if (m.recurrenceType === "once") return { type: "once", date: m.date };
  if (m.recurrenceType === "daily") return { type: "daily", startDate: m.startDate, endDate: m.endDate || undefined };
  return { type: "weekly", weekdays: m.weekdays, startDate: m.startDate, endDate: m.endDate || undefined };
}

async function submitScheduleModal() {
  syncScheduleModalFromForm();
  const m = state.scheduleModal;
  if (!m.label.trim() || !m.goal.trim() || !m.time) {
    m.error = "Label, goal, and time are all required.";
    render();
    return;
  }
  if (m.recurrenceType === "once" && !m.date) {
    m.error = "Pick a date.";
    render();
    return;
  }
  if (m.recurrenceType !== "once" && !m.startDate) {
    m.error = "Pick a start date.";
    render();
    return;
  }
  if (m.recurrenceType === "weekly" && m.weekdays.length === 0) {
    m.error = "Pick at least one weekday.";
    render();
    return;
  }
  m.error = null;
  m.submitting = true;
  render();
  const body = {
    label: m.label.trim(),
    goal: m.goal.trim(),
    agentKey: m.agentKey,
    time: m.time,
    recurrence: buildRecurrenceFromModal(m),
  };
  try {
    if (m.id) {
      await fetchJSON(`/api/schedule/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetchJSON("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    await loadSchedules();
    state.scheduleModal = null;
    render();
  } catch (err) {
    m.submitting = false;
    m.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function toggleSchedule(id, enabled) {
  await fetchJSON(`/api/schedule/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  await loadSchedules();
  render();
}

function deleteSchedule(id) {
  openConfirmModal({
    title: "Delete this automation?",
    message: "It will stop running and its schedule will be permanently removed. This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeleteSchedule(id),
  });
}

async function performDeleteSchedule(id) {
  await fetchJSON(`/api/schedule/${id}`, { method: "DELETE" });
  if (state.scheduleModal?.id === id) state.scheduleModal = null;
  await loadSchedules();
  render();
}

// Toggle/close the mobile drawer by mutating the existing nodes rather than
// calling render() — a full re-render replaces the sidebar element outright,
// which would skip the CSS slide transition (a brand-new node has no prior
// state to animate from).
function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  document.getElementById("sidebar")?.classList.toggle("open", state.sidebarOpen);
  document.getElementById("sidebar-backdrop")?.classList.toggle("open", state.sidebarOpen);
}

function closeSidebar() {
  state.sidebarOpen = false;
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("open");
}

// ---------- Rendering ----------

function renderAuthView() {
  if (state.auth.loading) {
    return `
      <main class="auth-screen">
        <section class="auth-panel">
          <div class="auth-brand">
            <span class="brand-logo">CeoAgent</span>
            <span class="brand-tagline">${escapeHtml(brandTagline())}</span>
          </div>
          <div class="auth-loading">Loading secure workspace...</div>
        </section>
      </main>
    `;
  }

  const mode = state.auth.mode;
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const configMissing = state.auth.config && !state.auth.config.enabled;
  const title = isSignup
    ? "Create your workspace"
    : isForgot
      ? "Reset your password"
      : isReset
        ? "Set a new password"
        : "Sign in to your workspace";
  const description = isSignup
    ? "Start a separated organization workspace with its own agents, files, runs, and settings."
    : isForgot
      ? "Enter your account email and we'll send a password reset link."
      : isReset
        ? "Choose a new password for your account."
        : "Continue into your organization workspace.";
  const submitLabel = state.auth.submitting
    ? "Please wait..."
    : isSignup
      ? "Create account"
      : isForgot
        ? "Send reset link"
        : isReset
          ? "Reset password"
          : "Sign in";
  return `
    <main class="auth-screen">
      <section class="auth-panel">
        <div class="auth-brand">
          <span class="brand-logo">CeoAgent</span>
          <span class="brand-tagline">${escapeHtml(brandTagline())}</span>
        </div>
        <div class="auth-copy">
          <h1>${title}</h1>
          <p>${description}</p>
        </div>
        ${
          configMissing
            ? `<div class="auth-error">Supabase auth is not configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY.</div>`
            : ""
        }
        ${state.auth.error ? `<div class="auth-error">${escapeHtml(state.auth.error)}</div>` : ""}
        ${state.auth.message ? `<div class="auth-message">${escapeHtml(state.auth.message)}</div>` : ""}
        <form id="auth-form" class="auth-form">
          ${
            isSignup && !isForgot && !isReset
              ? `
                <label>Name<input name="name" type="text" autocomplete="name" required /></label>
                <label>Organization<input name="organizationName" type="text" autocomplete="organization" required /></label>
              `
              : ""
          }
          ${
            !isReset
              ? `<label>Email<input name="email" type="email" autocomplete="email" required /></label>`
              : ""
          }
          ${
            !isForgot
              ? `
                <label>${isReset ? "New password" : "Password"}
                  <span class="auth-password-field">
                    <input id="auth-password-input" name="password" type="password" autocomplete="${isSignup || isReset ? "new-password" : "current-password"}" minlength="8" required />
                    <button type="button" id="auth-password-toggle" aria-label="Show password" data-visible="false">
                      <i data-lucide="eye"></i>
                    </button>
                  </span>
                </label>
              `
              : ""
          }
          ${
            isReset
              ? `
                <label>Confirm new password
                  <span class="auth-password-field">
                    <input id="auth-confirm-password-input" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
                    <button type="button" id="auth-confirm-password-toggle" aria-label="Show password" data-visible="false">
                      <i data-lucide="eye"></i>
                    </button>
                  </span>
                </label>
              `
              : ""
          }
          <button type="submit" class="auth-submit" ${state.auth.submitting || configMissing ? "disabled" : ""}>
            ${submitLabel}
          </button>
        </form>
        <div class="auth-secondary-actions">
          ${
            mode === "login"
              ? `
                <button type="button" class="auth-switch" id="auth-forgot-switch">Forgot password?</button>
                <button type="button" class="auth-switch" id="auth-mode-switch">New organization? Create an account</button>
              `
              : isReset
                ? `<button type="button" class="auth-switch" id="auth-reset-cancel">Back to sign in</button>`
                : `<button type="button" class="auth-switch" id="auth-mode-switch">Already have an account? Sign in</button>`
          }
        </div>
      </section>
    </main>
  `;
}

function attachAuthHandlers() {
  document.getElementById("auth-mode-switch")?.addEventListener("click", () => {
    state.auth.mode = state.auth.mode === "login" ? "signup" : "login";
    state.auth.error = null;
    state.auth.message = null;
    render();
  });
  document.getElementById("auth-forgot-switch")?.addEventListener("click", () => {
    state.auth.mode = "forgot";
    state.auth.error = null;
    state.auth.message = null;
    render();
  });
  document.getElementById("auth-reset-cancel")?.addEventListener("click", async () => {
    await fetchJSON("/api/auth/logout", { method: "POST" }).catch(() => null);
    await resetToSignedOut(null);
    render();
  });
  document.getElementById("auth-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleAuthSubmit(e.target);
  });
  const attachPasswordToggle = (buttonId, inputId) => {
    document.getElementById(buttonId)?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      const input = document.getElementById(inputId);
      if (!input) return;
      const visible = btn.dataset.visible === "true";
      input.type = visible ? "password" : "text";
      btn.dataset.visible = visible ? "false" : "true";
      btn.setAttribute("aria-label", visible ? "Show password" : "Hide password");
      btn.innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}"></i>`;
      if (window.lucide) window.lucide.createIcons();
    });
  };
  attachPasswordToggle("auth-password-toggle", "auth-password-input");
  attachPasswordToggle("auth-confirm-password-toggle", "auth-confirm-password-input");
}

function render() {
  const app = document.getElementById("app");

  if (state.auth.loading || !state.auth.user || state.auth.mode === "reset") {
    app.innerHTML = renderAuthView();
    attachAuthHandlers();
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // render() fully replaces #app's markup on every SSE event, which would
  // otherwise reset .log's scroll to the top each time. Capture whether the
  // reader was following the bottom (or had scrolled up to read history)
  // before the swap, then restore it after.
  const prevLog = app.querySelector(".log");
  const wasNearBottom = prevLog
    ? prevLog.scrollHeight - prevLog.scrollTop - prevLog.clientHeight < 48
    : true;
  const prevScrollTop = prevLog?.scrollTop ?? 0;

  // Same problem as .log's scroll above, for text inputs bound live to state
  // (e.g. the CRM search box) — a full innerHTML replace on every keystroke
  // would otherwise drop focus and cursor position after each character.
  const prevFocused = document.activeElement;
  const prevFocusId = prevFocused && prevFocused.id ? prevFocused.id : null;
  const prevSelStart = prevFocused?.selectionStart;
  const prevSelEnd = prevFocused?.selectionEnd;

  destroyMemoryOrb();
  const showSidebar = !isFullWidthView(state.view);
  const mobile = isMobileLayout();
  const navCollapsed = isNavCollapsed();
  app.innerHTML = `
    <div class="layout">
      ${renderIconRail()}
      <div class="content-area">
        ${renderHeader(mobile)}
        <div class="body-row">
          ${showSidebar ? `<div class="sidebar-backdrop${state.sidebarOpen ? " open" : ""}" id="sidebar-backdrop"></div>` : ""}
          ${showSidebar ? renderSidebar(mobile, navCollapsed) : ""}
          <main class="main">
            ${showSidebar && mobile ? renderComposer() : ""}
            ${renderMain()}
          </main>
        </div>
      </div>
    </div>
    <div id="nav-tooltip"></div>
    ${renderConfirmModal()}
    ${renderGuardedDeleteModal()}
    ${renderFolderModal()}
  `;
  attachHandlers();
  if (window.lucide) window.lucide.createIcons();
  initMemoryOrb();
  initLenis();

  if (prevFocusId) {
    const el = document.getElementById(prevFocusId);
    if (el && typeof el.focus === "function") {
      el.focus();
      if (typeof prevSelStart === "number" && typeof el.setSelectionRange === "function") {
        try {
          el.setSelectionRange(prevSelStart, prevSelEnd);
        } catch {
          // setSelectionRange throws on input types that don't support it (e.g. number/date)
        }
      }
    }
  }

  // Only replay the entrance animation on a genuine navigation (different
  // view/department/run), not on every SSE event during an active run —
  // render() fires on every streamed token, and re-fading the whole panel
  // each time would flicker rather than feel smooth.
  const renderKey = `${state.view.type}:${state.view.key ?? ""}:${state.selectedRunId ?? ""}`;
  animateEntrance(renderKey !== lastRenderKey);
  lastRenderKey = renderKey;

  const newLog = app.querySelector(".log");
  if (newLog) {
    if (wasNearBottom) {
      newLog.scrollTop = newLog.scrollHeight;
      state.logNearBottom = true;
    } else {
      newLog.scrollTop = prevScrollTop;
      updateJumpButton(newLog);
    }
  }
}

// ---------- Motion: GSAP entrance + Lenis smooth scroll ----------

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// Bento cells get a staggered fade+rise whenever they're present — always,
// not gated on viewChanged, because the Overview renders once showing a
// "Loading analytics…" placeholder (no .bento-cell yet) and again once
// loadAnalytics() resolves (see switchView()); the cells only actually
// exist starting on that *second* render, which has the same view identity
// as the first, so gating on "did the view change" would miss them
// entirely. Safe to run unconditionally since bento cells only ever appear
// on the Overview, which isn't re-rendered by SSE traffic.
//
// Every other view's root content element only fades on a genuine
// navigation (viewChanged) — render() also fires on every SSE event while
// a run is streaming, and re-fading the whole run-detail panel each time
// would flicker instead of feeling smooth.
function animateEntrance(viewChanged) {
  if (!window.gsap || prefersReducedMotion()) return;
  const cells = document.querySelectorAll(".bento-cell");
  if (cells.length) {
    gsap.fromTo(
      cells,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.5, ease: "power2.out", stagger: 0.06 },
    );
    return;
  }
  if (!viewChanged) return;
  // .main's last child is always the actual view content (.dashboard,
  // .run-detail, .empty-state, .accounts-view) — its first child is the
  // composer on mobile (see render()), which shouldn't replay this fade.
  const mainChild = document.querySelector(".main")?.lastElementChild;
  if (mainChild) {
    gsap.fromTo(mainChild, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
  }
}

const lenisInstances = new Map();
let lenisRafStarted = false;

function startLenisRaf() {
  if (lenisRafStarted) return;
  lenisRafStarted = true;
  function raf(time) {
    for (const instance of lenisInstances.values()) instance.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
}

// .main is fully recreated on every render() (the whole #app subtree is), so
// its Lenis instance is torn down and rebuilt each time too — cheap enough
// given Lenis is just a scroll-position interpolator. Scoped to .main only:
// .log has its own hand-tuned scroll-preservation/jump-button logic (see
// render()'s scroll-restore block and updateJumpButton()) built and debugged
// earlier in this project, and Lenis's virtual scroll model risks fighting
// that rather than complementing it — not worth the risk for a secondary
// scroll surface.
function initLenis() {
  for (const instance of lenisInstances.values()) instance.destroy();
  lenisInstances.clear();
  if (!window.Lenis || prefersReducedMotion()) return;
  const mainEl = document.querySelector(".main");
  if (!mainEl || !mainEl.firstElementChild) return;
  lenisInstances.set(
    "main",
    new window.Lenis({ wrapper: mainEl, content: mainEl.firstElementChild, autoRaf: false, lerp: 0.12 }),
  );
  startLenisRaf();
}

function renderControlIcon(icon, label) {
  if (icon.includes(".")) {
    return `<img class="local-icon" src="/icon/${escapeHtml(icon)}" alt="" aria-hidden="true" />`;
  }
  return `<i data-lucide="${icon}"></i>`;
}

// A department's animated "face" — a metallic gradient sphere + two eyes,
// colored from its existing DEPARTMENTS[].color (see deptColor()) and
// expressioned via data-mood (idle/watching/thinking/analysing/done/error —
// see the .bot-face rules in style.css). Three independent animation
// layers run at once: eye blink, a gentle idle float, and a metallic shine
// sweep (bot-blink/bot-float/bot-shine in style.css). Reused at icon-rail,
// department-hero, and run-detail size — one function, one markup shape, so
// every size/mood stays in sync by construction.
//
// Each department moves on its own schedule, not a shared one: a stable
// hash of its key (not Math.random()) drives animation-duration/-delay for
// all three layers, with different multipliers so blink/float/shine don't
// sync to each other either. Stable because render() rebuilds this markup
// from scratch on every SSE event / state change — Math.random() would
// restart (and desync) every bot's cycle on every single render.
function botFaceMarkup(deptKey, { size = 44, mood = "idle" } = {}) {
  const accent = deptColor(deptKey) || "var(--accent)";
  let seed = 0;
  for (const ch of deptKey || "") seed += ch.charCodeAt(0);
  const blinkDur = (4.4 + (seed % 9) * 0.35).toFixed(2);
  const blinkDelay = (-((seed % 11) * 0.6)).toFixed(2);
  const floatDur = (3.4 + (seed % 7) * 0.4).toFixed(2);
  const floatDelay = (-((seed % 5) * 0.9)).toFixed(2);
  const shineDur = (5.5 + (seed % 6) * 0.9).toFixed(2);
  const shineDelay = (-((seed % 8) * 1.1)).toFixed(2);
  const eye = `<span class="bot-eye" style="animation-duration:${blinkDur}s;animation-delay:${blinkDelay}s"></span>`;
  const faceStyle =
    `--bot-size:${size}px;--bot-accent:${escapeHtml(accent)};` +
    `--bot-shine-dur:${shineDur}s;--bot-shine-delay:${shineDelay}s;` +
    `animation-duration:${floatDur}s;animation-delay:${floatDelay}s`;
  return `<span class="bot-face" data-mood="${escapeHtml(mood)}" style="${faceStyle}">${eye}${eye}</span>`;
}

function destroyMemoryOrb() {
  if (memoryOrbCleanup) {
    memoryOrbCleanup();
    memoryOrbCleanup = null;
  }
}

function initMemoryOrb() {
  const container = document.getElementById("memory-hero-orb");
  if (!container) return;
  if (!window.lottie) {
    container.classList.add("orb-failed");
    return;
  }

  const animation = window.lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: true,
    autoplay: false,
    path: "/AI_animation/AI.json",
    rendererSettings: {
      preserveAspectRatio: "xMidYMid meet",
      progressiveLoad: true,
    },
  });

  const playStatusSegment = () => {
    const markerName = MEMORY_HERO_LOTTIE_MARKERS[memoryHeroStatus()] || "jump";
    if (container.dataset.lottieMarker === markerName) return;
    const marker = animation.animationData?.markers?.find((m) => m.cm === markerName);
    if (!marker) return;
    container.dataset.lottieMarker = markerName;
    const start = marker.tm;
    const end = marker.tm + marker.dr;
    // The idle "jump" bounce reads as a nervous tic on an infinite loop —
    // every other state (watching/analysing/done/error) is meant to hold
    // its loop until the status changes again, but idle plays its bounce
    // twice and then just holds its last frame. lottie-web's `loop`
    // accepts a play count, not just a boolean, for exactly this.
    animation.loop = markerName === "jump" ? 2 : true;
    animation.playSegments([start, end], true);
  };

  animation.addEventListener("DOMLoaded", playStatusSegment);
  container._memoryLottiePlayStatus = playStatusSegment;
  memoryOrbCleanup = () => {
    delete container._memoryLottiePlayStatus;
    animation.destroy();
  };
}

function syncMemoryHeroInputUi() {
  const status = memoryHeroStatus();
  const statusEl = document.querySelector(".memory-hero-status-text");
  if (statusEl) {
    statusEl.dataset.status = status;
    statusEl.textContent = MEMORY_HERO_STATUS_TEXT[status];
  }
  const submitBtn = document.getElementById("memory-hero-submit");
  if (submitBtn) submitBtn.disabled = state.memoryHeroSubmitting || state.attaching || !state.memoryHeroInput.trim();
  const orb = document.getElementById("memory-hero-orb");
  if (orb) {
    orb.dataset.status = status;
    orb._memoryLottiePlayStatus?.();
  }
}

function navButton(key, label, icon, isActive, viewObj, accentColor, isBot) {
  const style = accentColor ? ` style="--icon-accent:${accentColor}"` : "";
  const content = isBot ? botFaceMarkup(key, { size: 34 }) : renderControlIcon(icon, label);
  return `
    <button class="nav-icon${isActive ? " active" : ""}${isBot ? " nav-icon--bot" : ""}" data-nav='${escapeHtml(JSON.stringify(viewObj))}' data-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"${style}>
      ${content}
    </button>
  `;
}

// Vertical icon rail — leftmost column of the whole shell (see render()),
// spanning full height rather than sitting above just .main. Holds every
// nav destination (Overview/Files/departments/Accounts/Settings); the
// theme toggle and the mobile drawer trigger live in renderHeader() instead
// (see there for why), so this function no longer renders either.
function renderIconRail() {
  const isOverview = state.view.type === "overview";
  const targetRail = [
    { key: "manager", icon: "manager.png" },
    { key: "hr", icon: "hr.png" },
    { key: "developer", icon: "developer.webp" },
    { key: "sales", icon: "sales.webp" },
    { key: "crm", icon: "crm.webp" },
    { key: "seo", icon: "seo.webp" },
    { key: "analysis", icon: "analysis.webp" },
    { key: "aeo", icon: "AEO.webp" },
    { key: "finance", icon: "finance.webp" },
    { key: "pr", icon: "pr.webp" },
  ];

  const deptButtons = targetRail
    .map((item) => {
      const d = departmentMeta(item.key);
      if (!d) return "";
      return navButton(
        d.key,
        d.label,
        item.icon,
        state.view.type === "department" && state.view.key === d.key,
        { type: "department", key: d.key },
        d.color[state.theme],
        true,
      );
    })
    .join("");

  return `
    <nav class="icon-rail">
      <div class="nav-scroll">
        ${navButton("overview", NAV_STATIC.overview.label, "home.webp", isOverview, { type: "overview" })}
        ${deptButtons}
      </div>
    </nav>
  `;
}

// Local D.M.Y date badge for the header — purely presentational (today's
// real date, computed client-side), not tied to any backend data.
function todayLabel() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// Shared with renderSidebarNavLinks() below — .header-menu (CSS
// `@media (min-width:860px)`) is the only place these 6 destinations are
// reachable, so anything narrower needs the same list folded into the
// sidebar instead of duplicating it by hand in two places.
const NAV_MENU_ITEMS = [
  { type: "files", label: "File" },
  { type: "settings", label: "Settings" },
  { type: "portfolio", label: "Portfolio" },
  { type: "documents", label: "Documents" },
  { type: "accounts", label: "Accounts" },
  { type: "tools", label: "Tools" },
];

// Persistent top bar: brand mark, a text-menu shortcut to three existing
// full-width views (Files/Settings/Accounts — same switchView() as their
// icon-rail buttons, just a second entry point), the theme toggle, and the
// mobile drawer trigger (only the drawer trigger is conditional — the rest
// stay put across breakpoints since they fit on one row even on narrow
// screens once the icon rail moves out of the way, see style.css).
function renderHeader(mobile) {
  const showSidebar = !isFullWidthView(state.view);
  return `
    <header class="app-header">
      <div class="brand">
        <span class="brand-logo">CeoAgent</span>
        <span class="brand-tagline">${escapeHtml(brandTagline())}</span>
      </div>
      <nav class="header-menu">
        ${NAV_MENU_ITEMS.map(
          (item) =>
            `<button type="button" class="header-menu-link${state.view.type === item.type ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: item.type }))}'>${item.label}</button>`,
        ).join("")}
      </nav>
      <div class="header-actions">
        ${
          showSidebar && mobile
            ? `<button type="button" class="header-icon-btn" id="sidebar-toggle" data-label="Menu" aria-label="Menu"><i data-lucide="menu"></i></button>`
            : ""
        }
        <button type="button" class="header-icon-btn" id="theme-toggle" data-label="${state.theme === "dark" ? "Light mode" : "Dark mode"}" aria-label="Toggle theme">
          ${renderControlIcon("theme.webp", "Theme")}
        </button>
        <button type="button" class="header-icon-btn memory-header-btn${state.view.type === "department" && state.view.key === "memory" ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: "department", key: "memory" }))}' data-label="Memory" aria-label="Memory">
          <i data-lucide="brain"></i>
        </button>
        <div class="playbook-menu">
          <button type="button" id="playbook-menu-btn" class="header-icon-btn${state.view.type === "playbook" ? " active" : ""}" data-label="Playbook" aria-label="Playbook" aria-haspopup="menu">
            ${renderControlIcon("playbook.webp", "Playbook")}
          </button>
          <div class="playbook-menu-popover" role="menu">
            <button type="button" class="playbook-menu-item${state.view.type === "playbook" && state.view.key === "sales" ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: "playbook", key: "sales" }))}'>
              <i data-lucide="trending-up"></i> Sales
            </button>
            <button type="button" class="playbook-menu-item${state.view.type === "playbook" && state.view.key === "marketing" ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: "playbook", key: "marketing" }))}'>
              <i data-lucide="megaphone"></i> Marketing
            </button>
            <button type="button" class="playbook-menu-item${state.view.type === "content-calendar" ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: "content-calendar" }))}'>
              <i data-lucide="calendar-days"></i> Content Calendar
            </button>
          </div>
        </div>
        <button type="button" class="header-icon-btn" data-nav='${escapeHtml(JSON.stringify({ type: "department", key: "sales" }))}' aria-label="Sales">
          ${renderControlIcon("sales.webp", "Sales")}
        </button>
        <button type="button" class="header-icon-btn" data-nav='${escapeHtml(JSON.stringify({ type: "department", key: "emails" }))}' aria-label="Emails">
          ${renderControlIcon("email.webp", "Emails")}
        </button>
        <button type="button" class="header-date-badge" data-nav='${escapeHtml(JSON.stringify({ type: "department", key: "calendar" }))}' aria-label="Calendar">
          <span class="header-date-text"><span class="header-date-label">Date</span><span class="header-date-value">${todayLabel()}</span></span>
          <i data-lucide="calendar"></i>
        </button>
        <div class="header-account">
          <button type="button" id="account-menu-btn" class="header-user-btn" aria-label="Account details" aria-haspopup="menu">
            <span>${escapeHtml((state.auth.user?.name || state.auth.user?.email || "A").slice(0, 1).toUpperCase())}</span>
          </button>
          <div class="account-popover" role="tooltip">
            <div class="account-popover-name">${escapeHtml(state.auth.user?.name || "Account")}</div>
            <div class="account-popover-email">${escapeHtml(state.auth.user?.email || "")}</div>
            <div class="account-popover-row">
              <span>Organization</span>
              <strong>${escapeHtml(state.auth.user?.organizationName || "")}</strong>
            </div>
            <div class="account-popover-row">
              <span>Organization ID</span>
              <code>${escapeHtml(state.auth.user?.organizationId || "")}</code>
            </div>
            <button type="button" class="account-signout-btn" id="logout-btn">
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  `;
}

const ATTACH_ACCEPT =
  ".xlsx,.csv,.pdf,.docx,.txt,.md,.json,.log,.yml,.yaml,.xml,.html,.css,.js,.ts,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.sh,.sql";

// A file is parsed to plain text server-side on upload, then carried
// as pending state until the goal is submitted, at which point submitGoal
// inlines it into the prompt text — no file tool, no agent-side file access
// needed at all (see attachments.ts for why that's the deliberate choice).
// Shown above .goal-actions only once something is attached or errored; the
// trigger itself lives in .goal-actions as the circular "+" button.
function renderAttachmentRow() {
  const chips = state.attachments
    .map(
      (a, i) => `
        <div class="attachment-chip">
          <i data-lucide="file-text"></i>
          <span class="attachment-name">${escapeHtml(a.filename)}</span>
          ${
            a.truncated
              ? `<span class="attachment-warn" title="File was large — only the first part was attached"><i data-lucide="alert-triangle"></i></span>`
              : ""
          }
          <button type="button" class="attachment-remove" data-remove-attachment="${i}" aria-label="Remove attachment">
            <i data-lucide="x"></i>
          </button>
        </div>`,
    )
    .join("");

  if (chips) {
    return `<div class="attachment-row">${chips}</div>`;
  }
  if (state.attachError) {
    return `<div class="attachment-row"><span class="attachment-error">${escapeHtml(state.attachError)}</span></div>`;
  }
  return "";
}

function renderGoalActions() {
  const selectedLabel = MODEL_OPTIONS.find((o) => o.value === state.selectedModel)?.label ?? "Auto";
  return `
    <div class="goal-actions">
      <button type="button" class="attach-circle" id="attach-btn" ${state.attaching ? "disabled" : ""} aria-label="Attach file">
        ${
          state.attaching
            ? `<i data-lucide="loader-circle"></i>`
            : renderControlIcon("attach.webp", "Attach file")
        }
      </button>
      <button type="button" class="attach-circle model-picker-btn${state.modelPickerOpen ? " open" : ""}" id="model-picker-btn" aria-label="Model: ${escapeHtml(selectedLabel)}" aria-haspopup="menu" aria-expanded="${state.modelPickerOpen}">
        <i data-lucide="cpu"></i>
      </button>
      <input type="file" id="attach-input" accept="${ATTACH_ACCEPT}" multiple hidden />
      <span class="ai-button-wrap">
        <button type="submit" id="submit-btn" class="ai-button" aria-label="Run task" ${state.attaching ? "disabled" : ""}>
          <span class="button-outer">
            <span class="button-inner">
              <span>Run</span>
            </span>
          </span>
        </button>
      </span>
    </div>
  `;
}

// The composer (title + goal form) is rendered as its own function, not
// inlined in renderSidebar(), because on mobile it moves out of the
// off-canvas .sidebar drawer entirely and sits always-visible at the top of
// .main instead (see render()) — only the run history stays behind the
// hamburger there. Desktop keeps it inside .sidebar, unchanged.
function renderComposer() {
  const placeholder =
    state.view.type === "overview"
      ? "Give me a task..."
      : `Ask ${escapeHtml(viewLabel())} directly…`;
  const accent = state.view.type === "department" ? deptColor(state.view.key) : null;
  const style = accent ? ` style="--dept-accent:${accent}"` : "";

  return `
    <div class="composer"${style}>
      <h1>${state.view.type === "overview" ? "What to do today?" : escapeHtml(viewLabel())}</h1>
      ${state.view.type === "overview" ? "" : `<p class="sidebar-subtitle">${escapeHtml(departmentMeta(state.view.key)?.tagline ?? "Department")}</p>`}

      <form id="goal-form">
        <div class="goal-input-shell">
          <textarea id="goal-input" placeholder="${placeholder}" rows="4" required>${escapeHtml(state.goalDrafts[goalDraftKey(state.view)] ?? "")}</textarea>
        </div>
        ${renderAttachmentRow()}
        <div class="attachment-row" id="goal-submit-error-row" hidden><span class="attachment-error" id="goal-submit-error"></span></div>
        ${renderGoalActions()}
      </form>
    </div>
  `;
}

function renderRunActionIcons(run) {
  const archiveIcon = run.archived
    ? `<button type="button" class="run-action-icon" data-unarchive-run="${run.id}" data-label="Unarchive" aria-label="Unarchive"><i data-lucide="archive-restore"></i></button>`
    : `<button type="button" class="run-action-icon" data-archive-run="${run.id}" data-label="Archive" aria-label="Archive" ${run.status === "running" ? "disabled" : ""}><i data-lucide="archive"></i></button>`;
  const pinIcon = run.pinned
    ? `<button type="button" class="run-action-icon run-action-active" data-unpin-run="${run.id}" data-label="Unpin" aria-label="Unpin"><i data-lucide="pin-off"></i></button>`
    : `<button type="button" class="run-action-icon" data-pin-run="${run.id}" data-label="Pin" aria-label="Pin"><i data-lucide="pin"></i></button>`;
  return `
    <span class="run-item-actions">
      ${pinIcon}
      ${archiveIcon}
      <button type="button" class="run-action-icon run-action-danger" data-delete-run="${run.id}" data-label="Delete" aria-label="Delete" ${run.status === "running" ? "disabled" : ""}><i data-lucide="trash-2"></i></button>
    </span>
  `;
}

// Below the CSS `@media (min-width:860px)` breakpoint, .header-menu
// (File/Settings/Portfolio/Documents/Accounts/Tools) is hidden with
// nothing replacing it — this folds the same destinations into the
// sidebar instead, which is already visible there (an off-canvas drawer
// below 720px, opened by the hamburger; a permanent column from
// 720-859px). Reuses the plain [data-nav] delegation everything else on
// the page uses, so tapping one navigates and — since switchView()
// already resets state.sidebarOpen — closes the drawer for free.
function renderSidebarNavLinks() {
  return `
    <nav class="sidebar-nav-links">
      ${NAV_MENU_ITEMS.map(
        (item) =>
          `<button type="button" class="sidebar-nav-link${state.view.type === item.type ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: item.type }))}'>${item.label}</button>`,
      ).join("")}
    </nav>
  `;
}

function renderSidebar(mobile, navCollapsed) {
  return `
    <aside class="sidebar${state.sidebarOpen ? " open" : ""}" id="sidebar">
      ${mobile ? "" : renderComposer()}
      ${navCollapsed ? renderSidebarNavLinks() : ""}

      <div class="tasklist-card">
        <div class="tasks-header">
          <h2>Task list</h2>
          <button type="button" class="archive-toggle-btn" id="toggle-archived-btn" aria-label="${state.showArchived ? "Show active tasks" : "Show archived tasks"}">
            ${state.showArchived ? "Active" : "Archived"}
          </button>
        </div>
        <ul class="run-list">
          ${state.runs
            .map(
              (run) => `
            <li class="run-item${run.id === state.selectedRunId ? " selected" : ""}${run.pinned ? " pinned" : ""}" data-run-id="${run.id}">
              <span class="run-checkbox"></span>
              <span class="run-item-body">
                <span class="goal-excerpt">
                  ${run.pinned ? `<i data-lucide="pin" class="pinned-flag" title="Pinned"></i>` : ""}
                  <span class="goal-excerpt-text">${escapeHtml(run.goal)}</span>
                  <span class="status-dot ${run.status}" title="${escapeHtml(statusLabel(run.status))}"></span>
                </span>
                <span class="item-meta">${formatTime(run.createdAt)}</span>
              </span>
              ${renderRunActionIcons(run)}
            </li>
          `,
            )
            .join("") ||
            `<li class="tasks-empty">${state.showArchived ? "No archived tasks." : "No runs yet."}</li>`}
        </ul>
      </div>
    </aside>
  `;
}

function renderMain() {
  if (state.view.type === "accounts") return renderAccountsView();
  if (state.view.type === "tools") return renderToolsView();
  if (state.view.type === "files") return renderFilesView();
  if (state.view.type === "settings") return renderSettingsView();
  if (state.view.type === "documents") return renderDocumentsView();
  if (state.view.type === "portfolio") return renderPortfolioView();
  if (state.view.type === "memory-browse") return renderMemoryBrowseView();
  if (state.view.type === "department" && state.view.key === "memory") return renderMemoryHero();
  if (state.view.type === "playbook") return renderPlaybookView();
  if (state.view.type === "content-calendar") return renderContentCalendarView();
  if (!state.selectedRun) {
    if (state.view.type === "overview") return renderOverviewDashboard();
    if (state.view.type === "department" && state.view.key === "calendar") return renderCalendarView();
    if (state.view.type === "department" && state.view.key === "crm") return renderCrmView();
    if (state.view.type === "department") return renderDeptHero(state.view.key);
    return `<div class="empty-state"><p>Submit a goal to start, or pick a past run from the history.</p></div>`;
  }
  return renderRunDetail();
}

// Replaces the bare "Submit a goal..." placeholder for every department
// without its own bespoke dashboard (everything except Memory/Calendar/CRM,
// handled above). Starts idle; the #goal-input listener in attachHandlers()
// flips data-mood to "watching" directly via the DOM (no re-render) while
// the user is typing — see the comment there for why a full render() isn't
// used. "thinking/done/error" aren't reachable here: the instant a run
// exists this branch stops being rendered at all (see renderMain() above),
// so that reactivity lives in renderRunDetail() instead.
function renderDeptHero(key) {
  const meta = departmentMeta(key);
  return `
    <div class="dept-hero" id="dept-hero">
      ${botFaceMarkup(key, { size: 128 })}
      <p class="dept-hero-tagline">${escapeHtml(meta?.tagline ?? "")}</p>
      <p class="dept-hero-hint">Submit a goal to start, or pick a past run from the history.</p>
    </div>
  `;
}

// A cell with a label (only the hero has one, "Overview") gets two direct
// children — the label and the value group — so space-between (see CSS)
// pushes them to opposite ends of the taller hero cell, top and bottom. A
// cell with no label has just the one value-group child, which naturally
// sits at the top instead, matching the reference's secondary cells.
function truncateText(str, n) {
  if (!str) return "";
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

// A translucent multi-segment ring, drawn as plain stacked <circle> arcs —
// no charting library, just stroke-dasharray/-dashoffset math. Opacity is
// applied in CSS (.bento-ring), not baked into these colors, so it stays
// tunable in one place.
function donutRing(segments, { size = 84, strokeWidth = 10 } = {}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (!total) return "";
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / total) * circumference;
      const circle = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${strokeWidth}" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${c} ${c})" />`;
      offset += len;
      return circle;
    })
    .join("");
  return `<svg class="bento-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${arcs}</svg>`;
}

function bentoDeptBreakdown(runsByDepartment) {
  const items = runsByDepartment.filter((d) => d.count > 0);
  if (!items.length) return '<div class="bento-detail-empty">No runs yet.</div>';
  return `
    <ul data-lenis-prevent class="bento-detail-list bento-dept-breakdown">
      ${items
        .map((d) => {
          const color = departmentMeta(d.key)?.color[state.theme] ?? "currentColor";
          return `<li><span class="bento-dept-dot" style="background:${color}"></span>${escapeHtml(d.label)}<span class="bento-dept-count">${d.count}</span></li>`;
        })
        .join("")}
    </ul>
  `;
}

function bentoErrorList(recentErrors) {
  if (!recentErrors.length) return '<div class="bento-detail-empty">No errors — clean run history.</div>';
  return `
    <ul data-lenis-prevent class="bento-detail-list">
      ${recentErrors
        .map(
          (e) => `
        <li class="bento-detail-item" data-run-id="${e.id}">
          <div class="bento-detail-item-head">
            <strong>${escapeHtml(departmentMeta(e.agentKey)?.label ?? capitalize(e.agentKey))}</strong>
            <span class="bento-detail-time">${formatClock(e.createdAt)}</span>
          </div>
          <div class="bento-detail-goal">${escapeHtml(truncateText(e.goal, 60))}</div>
          <div class="bento-detail-error">${escapeHtml(truncateText(e.error, 90))}</div>
        </li>`,
        )
        .join("")}
    </ul>
  `;
}

function bentoDocumentList(recentDocuments) {
  if (!recentDocuments.length) return '<div class="bento-detail-empty">None yet.</div>';
  return `
    <ul data-lenis-prevent class="bento-detail-list">
      ${recentDocuments
        .map(
          (d) => `
        <li class="bento-detail-item" data-doc-id="${d.id}">
          <strong>${escapeHtml(truncateText(d.title, 46))}</strong>
          <span class="bento-detail-time">${escapeHtml(departmentMeta(d.agentKey)?.label ?? capitalize(d.agentKey))} · ${formatClock(d.createdAt)}</span>
        </li>`,
        )
        .join("")}
    </ul>
  `;
}

function renderOverviewDashboard() {
  const a = state.analytics;
  if (!a) return `<div class="empty-state"><p>Loading analytics…</p></div>`;

  const successRate = a.totals.totalRuns
    ? Math.round((a.totals.successRuns / a.totals.totalRuns) * 100)
    : null;

  const runsRing = donutRing(
    a.runsByDepartment
      .filter((d) => d.count > 0)
      .map((d) => ({ value: d.count, color: departmentMeta(d.key)?.color[state.theme] ?? "currentColor" })),
  );

  const successRing = donutRing([
    { value: a.totals.successRuns, color: "var(--bento-forest-ink)" },
    { value: a.totals.errorRuns, color: "var(--error)" },
    { value: a.totals.runningRuns, color: "var(--warning)" },
  ]);

  return `
    <div class="dashboard">
      <div class="dashboard-head">
        <h2>Overview</h2>
        <p class="dept-tagline">Real activity across every agent — submit a goal below, or pick a past run from the history to inspect it.</p>
      </div>

      <div class="bento-grid">
        <div class="bento-cell bento-lavender">
          <div class="bento-value-group">
            <div class="bento-value">${a.totals.totalDocuments}</div>
            <div class="bento-caption">Emails</div>
            <div class="bento-subvalue">Sent ${a.totals.totalDocuments}</div>
          </div>
          ${bentoDocumentList(a.recentDocuments)}
        </div>

        <div class="bento-cell bento-orange">
          <div class="bento-label">Live logs</div>
          ${bentoErrorList(a.recentErrors)}
        </div>

        <div class="bento-cell bento-mint bento-hero">
          ${runsRing ? `<div class="bento-ring-wrap">${runsRing}</div>` : ""}
          <div class="bento-label">Overview</div>
          <div class="bento-value-group">
            <div class="bento-value">${a.totals.totalRuns}</div>
            <div class="bento-caption">Total runs</div>
          </div>
          ${bentoDeptBreakdown(a.runsByDepartment)}
        </div>

        <div class="bento-cell bento-forest">
          ${successRing ? `<div class="bento-ring-wrap">${successRing}</div>` : ""}
          <div class="bento-value-group">
            <div class="bento-value">${successRate == null ? "—" : `${successRate}%`}</div>
            <div class="bento-caption">Success rate</div>
          </div>
          <div class="bento-status-breakdown">
            <div><span class="bento-dot success"></span>${a.totals.successRuns} success</div>
            <div><span class="bento-dot error"></span>${a.totals.errorRuns} error</div>
            <div><span class="bento-dot running"></span>${a.totals.runningRuns} running</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderRunDetail() {
  const run = state.selectedRun;
  const source = run.agentKey === "ceo" ? "CEO" : (departmentMeta(run.agentKey)?.label ?? capitalize(run.agentKey));
  const timestamps = [
    `Started ${formatTime(run.createdAt)}`,
    run.finishedAt ? `Finished ${formatTime(run.finishedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const runMood = { running: "thinking", success: "done", error: "error" }[run.status] ?? "idle";

  return `
    <div class="run-detail">
      <header class="run-header">
        ${botFaceMarkup(run.agentKey, { size: 26, mood: runMood })}
        <span class="status-badge ${run.status}">${statusLabel(run.status)}</span>
        ${run.archived ? `<span class="status-badge archived">Archived</span>` : ""}
        ${run.pinned ? `<span class="status-badge pinned">Pinned</span>` : ""}
        <span class="run-meta">${run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : ""}</span>
        ${run.status === "error" && run.summary ? `<p class="run-error-summary">${escapeHtml(run.summary)}</p>` : ""}
        <div class="run-actions">
          ${
            run.pinned
              ? `<button type="button" class="run-action-btn run-action-active" data-unpin-run="${run.id}" data-label="Unpin" aria-label="Unpin"><i data-lucide="pin-off"></i></button>`
              : `<button type="button" class="run-action-btn" data-pin-run="${run.id}" data-label="Pin" aria-label="Pin"><i data-lucide="pin"></i></button>`
          }
          ${
            run.archived
              ? `<button type="button" class="run-action-btn" data-unarchive-run="${run.id}" data-label="Unarchive" aria-label="Unarchive"><i data-lucide="archive-restore"></i></button>`
              : `<button type="button" class="run-action-btn" data-archive-run="${run.id}" data-label="Archive" aria-label="Archive" ${run.status === "running" ? "disabled" : ""}><i data-lucide="archive"></i></button>`
          }
          <button type="button" class="run-action-btn run-action-danger" data-delete-run="${run.id}" data-label="Delete" aria-label="Delete" ${run.status === "running" ? "disabled" : ""}><i data-lucide="trash-2"></i></button>
        </div>
        <div class="run-goal-wrap">
          <h2 class="run-goal${state.goalExpanded ? "" : " collapsed"}">${escapeHtml(run.goal)}</h2>
          ${
            run.goal.length > 180
              ? `<button type="button" class="run-goal-toggle" id="run-goal-toggle">${state.goalExpanded ? "Show less" : "Show more"}</button>`
              : ""
          }
        </div>
        <p class="run-subheader">${escapeHtml(source)} · ${timestamps}</p>
      </header>

      <div class="panels">
        <section class="panel log-panel">
          <h3>Log</h3>
          <div class="log" data-lenis-prevent>${renderLog(run.events, run.status)}</div>
          ${run.status !== "running" && run.sessionId ? renderReplyForm() : ""}
        </section>
      </div>
    </div>
  `;
}

// Shown once a run has finished and we captured its SDK session ID — lets
// the same agent conversation continue (e.g. answering a clarifying
// question it asked) instead of forcing a brand new, context-less run.
function renderReplyForm() {
  return `
    <form id="reply-form" class="reply-form">
      <textarea id="reply-input" placeholder="Reply to continue this conversation…" rows="1" required></textarea>
      <button type="submit" id="reply-submit-btn" class="reply-submit" aria-label="Send reply">
        <i data-lucide="corner-down-left"></i>
      </button>
    </form>
  `;
}

// A "tool_use" and its matching "tool_result" (joined by toolUseId) render as
// one collapsible card rather than two disconnected log lines — the reader
// cares about the call and its outcome together, not as a sequence.
function renderLog(events, status) {
  const resultsByToolUseId = new Map();
  for (const event of events) {
    if (event.type === "tool_result") resultsByToolUseId.set(event.toolUseId, event);
  }

  const parts = [];
  for (const event of events) {
    if (event.type === "tool_result") continue; // rendered inline with its tool_use
    if (event.type === "text") parts.push(renderTextMessage(event));
    else if (event.type === "tool_use") parts.push(renderToolCard(event, resultsByToolUseId.get(event.toolUseId)));
    else if (event.type === "done") parts.push(renderTurnDivider(event));
  }

  const body = parts.join("");
  if (!body) {
    return status === "running"
      ? `<div class="tasks-empty">Waiting for the agent…</div>${renderTypingIndicator(events)}`
      : '<div class="tasks-empty">No activity.</div>';
  }
  return body + (status === "running" ? renderTypingIndicator(events) : "");
}

function renderTextMessage(event) {
  const color = deptColor(event.source) || "var(--accent)";
  return `
    <div class="msg">
      <span class="msg-avatar" style="background:${color}">${escapeHtml(avatarInitial(event.source))}</span>
      <div class="msg-body">
        <div class="msg-head">
          <span class="msg-source">${escapeHtml(sourceLabel(event.source))}</span>
          <span class="msg-time">${formatClock(event.ts)}</span>
        </div>
        <div class="msg-text">${renderMarkdown(event.text)}</div>
      </div>
    </div>
  `;
}

function isToolCardOpen(toolUseId, isError) {
  return state.toolOverrides.has(toolUseId) ? state.toolOverrides.get(toolUseId) : isError;
}

function renderToolCard(event, result) {
  const color = deptColor(event.source) || "var(--accent)";
  const pending = !result;
  const isError = !!result?.isError;
  const statusClass = pending ? "pending" : isError ? "error" : "success";
  const statusIcon = pending ? "loader-circle" : isError ? "x-circle" : "check-circle-2";
  const open = isToolCardOpen(event.toolUseId, isError);

  return `
    <div class="tool-card ${statusClass}${open ? " open" : ""}">
      <button type="button" class="tool-card-head" data-toggle-tool="${event.toolUseId}">
        <span class="msg-avatar" style="background:${color}">${escapeHtml(avatarInitial(event.source))}</span>
        <span class="tool-icon"><i data-lucide="wrench"></i></span>
        <span class="tool-name">${escapeHtml(event.name)}</span>
        <span class="tool-status ${statusClass}"><i data-lucide="${statusIcon}"></i></span>
        <span class="tool-chevron"><i data-lucide="chevron-down"></i></span>
      </button>
      <div class="tool-card-body">
        <div class="tool-block">
          <span class="tool-block-label">Input</span>
          <pre>${escapeHtml(prettyJson(event.input))}</pre>
        </div>
        ${
          result
            ? `<div class="tool-block">
                <span class="tool-block-label">${isError ? "Error" : "Result"}</span>
                <pre>${escapeHtml(result.text)}</pre>
              </div>`
            : `<div class="tool-block pending-note">Waiting for result…</div>`
        }
      </div>
    </div>
  `;
}

function renderTurnDivider(event) {
  const label = event.status === "error" ? "Turn failed" : "Turn complete";
  const reason = event.status === "error" && event.error ? `: ${event.error}` : "";
  return `<div class="turn-divider ${event.status}"><span>${escapeHtml(label)}${escapeHtml(reason)} · $${event.costUsd.toFixed(4)} · ${formatClock(event.ts)}</span></div>`;
}

function renderTypingIndicator(events) {
  const lastSourced = [...events].reverse().find((e) => "source" in e);
  const color = (lastSourced && deptColor(lastSourced.source)) || "var(--accent)";
  return `<div class="typing-indicator" style="--dot-color:${color}"><span></span><span></span><span></span></div>`;
}

function renderJumpButton() {
  return `<button type="button" class="log-jump-btn" id="log-jump"><i data-lucide="arrow-down"></i>New activity</button>`;
}

// Called both from the delegated scroll listener (live, no re-render) and
// from render() right after a DOM rebuild, so the pill's presence stays
// correct whether the reader is actively scrolling or a new SSE event just
// redrew the whole log underneath them.
function updateJumpButton(log) {
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  state.logNearBottom = nearBottom;
  const existing = document.getElementById("log-jump");
  if (nearBottom) {
    existing?.remove();
    return;
  }
  if (!existing && state.selectedRun?.status === "running") {
    log.insertAdjacentHTML("beforeend", renderJumpButton());
    document.getElementById("log-jump")?.addEventListener("click", () => {
      log.scrollTop = log.scrollHeight;
      updateJumpButton(log);
    });
    if (window.lucide) window.lucide.createIcons();
  }
}

function renderLinearTasks(tasks) {
  if (!tasks.length) return '<li class="tasks-empty">None yet.</li>';
  return tasks
    .map(
      (t) =>
        `<li><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.identifier)}</a><br>${escapeHtml(t.title)}</li>`,
    )
    .join("");
}

function renderDocuments() {
  if (!state.documents.length) return '<li class="tasks-empty">None yet.</li>';
  return state.documents
    .map(
      (d) =>
        `<li class="doc-item" data-doc-id="${d.id}"><strong>${escapeHtml(d.title)}</strong><br><span class="item-meta">${formatTime(d.createdAt)}</span></li>`,
    )
    .join("");
}

function renderDocumentsView() {
  const docs = state.documents ?? [];
  return `
    <div class="documents-view">
      <div class="dashboard-head">
        <h2>Documents</h2>
        <p class="dept-tagline">Saved reports, drafts, policies, proposals, and analysis deliverables from every department.</p>
      </div>
      ${
        docs.length
          ? `<div class="documents-list">
              ${docs
                .map((d) => {
                  const agent = departmentMeta(d.agentKey);
                  const label = agent?.label ?? capitalize(d.agentKey);
                  const color = agent?.color[state.theme] ?? "var(--accent)";
                  return `
                    <div class="document-card" style="--doc-accent:${color}">
                      <button type="button" class="document-card-main doc-item" data-doc-id="${d.id}">
                        <span class="document-card-icon"><i data-lucide="file-text"></i></span>
                        <span class="document-card-body">
                          <strong>${escapeHtml(d.title)}</strong>
                          <span>${escapeHtml(label)} · ${formatTime(d.createdAt)}</span>
                        </span>
                      </button>
                      <span class="document-card-actions">
                        <a href="/api/documents/${encodeURIComponent(d.id)}/download?format=doc" download data-label="Download DOC" aria-label="Download DOC"><i data-lucide="file-text"></i><span>DOC</span></a>
                        <a href="/api/documents/${encodeURIComponent(d.id)}/download?format=xlsx" download data-label="Download Excel" aria-label="Download Excel"><i data-lucide="file-spreadsheet"></i><span>XLSX</span></a>
                      </span>
                    </div>
                  `;
                })
                .join("")}
            </div>`
          : `<div class="empty-state"><p>No documents saved yet.</p></div>`
      }
    </div>
  `;
}

function renderAccountsView() {
  return `
    <div class="accounts-view">
      <h2>Connected accounts</h2>
      <p class="dept-tagline">These are the CEO's own accounts — connect them so agents can read and act on real signals.</p>
      <div class="account-cards">
        ${state.accounts
          .map((a) => {
            if (a.unsupported) {
              return `
                <div class="account-card unsupported">
                  <div class="account-card-header">
                    <strong>${escapeHtml(a.label)}</strong>
                    <span class="status-badge error">Unsupported</span>
                  </div>
                  <p class="account-reason">${escapeHtml(a.reason)}</p>
                </div>
              `;
            }
            if (a.configOnly) {
              return `
                <div class="account-card">
                  <div class="account-card-header">
                    <strong>${escapeHtml(a.label)}</strong>
                    <span class="status-badge ${a.connected ? "success" : "running"}">${a.connected ? "Connected" : "Not connected"}</span>
                  </div>
                  ${
                    a.connected
                      ? `<p class="account-reason">Managed from the Settings screen — clear the key there to disconnect.</p>`
                      : `<p class="account-reason">${escapeHtml(a.configHint)}</p><a class="connect-btn" href="${a.signupUrl}" target="_blank" rel="noopener">Get an API key</a>`
                  }
                </div>
              `;
            }
            return `
              <div class="account-card">
                <div class="account-card-header">
                  <strong>${escapeHtml(a.label)}</strong>
                  <span class="status-badge ${a.connected ? "success" : "running"}">${a.connected ? "Connected" : "Not connected"}</span>
                </div>
                ${
                  a.connected
                    ? `<button class="disconnect-btn" data-account-key="${a.key}">Disconnect</button>`
                    : `<a class="connect-btn" href="${a.connectUrl}" target="_blank" rel="noopener" data-connect-key="${a.key}">Connect ${escapeHtml(a.label)}</a>`
                }
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

// ---------- Tools view ----------
//
// Same connection data as Accounts, described from a "what can I ask for"
// angle instead of connect/disconnect — only shows tools that are actually
// connected, each as a compact card: feature list + one example prompt.

function renderToolsView() {
  const connected = state.tools.filter((t) => t.connected);
  return `
    <div class="accounts-view tools-view">
      <h2>Connected tools</h2>
      <p class="dept-tagline">What your agents can actually do right now, with a prompt to try each one.</p>
      ${
        connected.length
          ? `<div class="tool-cards">
              ${connected
                .map(
                  (t) => `
                    <div class="tool-catalog-card">
                      <div class="tool-catalog-card-header">
                        <strong>${escapeHtml(t.label)}</strong>
                        <span class="tool-used-by">${t.usedBy.map(escapeHtml).join(" · ")}</span>
                      </div>
                      <ul class="tool-feature-list">
                        ${t.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
                      </ul>
                      <p class="tool-example-prompt">“${escapeHtml(t.examplePrompt)}”</p>
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : `<p class="account-reason">Nothing connected yet — head to <button type="button" class="link-btn" data-nav='${escapeHtml(JSON.stringify({ type: "accounts" }))}'>Accounts</button> to connect a tool.</p>`
      }
    </div>
  `;
}

// ---------- Settings view ----------
//
// Replaces hand-editing .env for packaged installs. Fields never show a
// saved value — only a masked placeholder plus a "Set" badge — so the form
// can safely POST just the fields the user actually typed into, without ever
// re-sending (or blanking out) an already-saved secret.

function renderSettingsView() {
  const groups = new Map();
  for (const field of state.settings) {
    if (!groups.has(field.group)) groups.set(field.group, []);
    groups.get(field.group).push(field);
  }

  return `
    <div class="settings-view">
      <h2>Settings</h2>
      <p class="dept-tagline">API keys and credentials for connected services. Saved values are never displayed again — only whether a key is currently set.</p>
      <div class="tenant-summary">
        <div>
          <span>Organization</span>
          <strong>${escapeHtml(state.auth.user?.organizationName ?? "")}</strong>
        </div>
        <div>
          <span>Organization ID</span>
          <code>${escapeHtml(state.auth.user?.organizationId ?? "")}</code>
        </div>
        <div>
          <span>Signed in as</span>
          <strong>${escapeHtml(state.auth.user?.email ?? "")}</strong>
        </div>
      </div>
      <form id="settings-form">
        ${[...groups.entries()]
          .map(
            ([group, fields]) => `
              <div class="settings-group">
                <h3>${escapeHtml(group)}</h3>
                ${fields
                  .map(
                    (f) => `
                      <label class="settings-field">
                        <span class="settings-field-label">
                          ${escapeHtml(f.label)}
                          ${f.isSet ? `<span class="status-badge success">Set</span>` : ""}
                        </span>
                        <input type="text" name="${escapeHtml(f.envVar)}" placeholder="${f.isSet ? escapeHtml(f.masked) : "Not set"}" autocomplete="off" spellcheck="false" />
                      </label>
                    `,
                  )
                  .join("")}
              </div>
            `,
          )
          .join("")}
        <div class="settings-actions">
          <button type="submit" class="ai-button" aria-label="Save settings">Save</button>
        </div>
      </form>
    </div>
  `;
}

async function saveSettings(form) {
  const payload = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string" && value.trim() !== "") payload[key] = value.trim();
  }
  if (!Object.keys(payload).length) return;
  await fetchJSON("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await Promise.all([loadSettings(), loadAccounts()]);
  render();
}

// ---------- Files view ----------
//
// A two-pane VS Code-style browser: a lazily-expanding folder tree on the
// left (each root — Company Data / Deliverables / Agent Files — loads its
// children only once expanded), a preview + details pane on the right.
// Deliberately its own full-width view (no composer sidebar, like Accounts)
// since browsing files has nothing to do with the goal composer.

function renderFilesTreeNode(entry, depth) {
  const isDir = entry.type === "dir";
  const isExpanded = isDir && state.filesExpanded.has(entry.path);
  const isSelected = state.filesSelectedPath === entry.path;
  const indent = 10 + depth * 16;

  const rowIcon = isDir
    ? `<i data-lucide="${isExpanded ? "folder-open" : "folder"}"></i>`
    : `<i data-lucide="${fileIconFor(entry.name)}"></i>`;

  const chevron = isDir
    ? `<i class="files-chevron" data-lucide="${isExpanded ? "chevron-down" : "chevron-right"}"></i>`
    : `<span class="files-chevron"></span>`;

  const row = `
    <div class="files-row${isSelected ? " selected" : ""}" data-files-path="${escapeHtml(entry.path)}" data-files-type="${entry.type}" style="padding-left:${indent}px" title="${escapeHtml(entry.name)}">
      ${chevron}
      <span class="files-row-icon">${rowIcon}</span>
      <span class="files-row-name">${escapeHtml(entry.name)}</span>
    </div>
  `;

  if (!isDir || !isExpanded) return row;

  const children = state.filesChildren.get(entry.path);
  const childrenHtml =
    children === undefined
      ? `<div class="files-row files-loading" style="padding-left:${indent + 16}px">Loading…</div>`
      : children.length === 0
        ? `<div class="files-row files-empty-row" style="padding-left:${indent + 16}px">Empty folder</div>`
        : children.map((c) => renderFilesTreeNode(c, depth + 1)).join("");

  return row + childrenHtml;
}

function renderFilesPreview() {
  const entry = state.filesSelectedEntry;
  if (!entry) {
    return `
      <div class="files-preview-empty">
        <i data-lucide="folder-open"></i>
        <p>Select a folder to browse, or a file to preview it here.</p>
      </div>
    `;
  }

  const crumb = entry.path
    .split("/")
    .map((seg, i, arr) => (i === arr.length - 1 ? escapeHtml(seg) : `${escapeHtml(seg)} <span class="files-crumb-sep">/</span> `))
    .join("");

  // A root (path has no "/") can't be deleted — it's one of the three fixed
  // top-level folders, not a real entry on disk to remove.
  const isRoot = !entry.path.includes("/");

  if (entry.type === "dir") {
    const children = state.filesChildren.get(entry.path) ?? [];
    const count = children.length;
    const folderCount = children.filter((c) => c.type === "dir").length;
    const fileCount = count - folderCount;
    return `
      <div class="files-preview-head">
        <div class="files-crumb">${crumb}</div>
        <div class="files-preview-actions">
          <button type="button" class="files-upload-btn" id="files-new-folder-btn">
            <i data-lucide="folder-plus"></i> New folder
          </button>
          <button type="button" class="files-upload-btn" id="files-upload-btn">
            <i data-lucide="upload"></i> Upload here
          </button>
          ${
            isRoot
              ? ""
              : `<button type="button" class="files-upload-btn files-delete-btn" id="files-delete-btn" data-files-delete-path="${escapeHtml(entry.path)}">
                  <i data-lucide="trash-2"></i> Delete
                </button>`
          }
        </div>
      </div>
      <div class="files-preview-empty">
        <i data-lucide="folder"></i>
        <p>${folderCount} folder${folderCount === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"}</p>
      </div>
    `;
  }

  const downloadUrl = `/api/files/raw?path=${encodeURIComponent(entry.path)}&download=1`;
  const meta = `${formatFileSize(entry.size)}${entry.modifiedAt ? ` · edited ${new Date(entry.modifiedAt).toLocaleString()}` : ""}`;

  let body = `<div class="files-preview-empty"><i data-lucide="file"></i><p>Preview not available for this file type — download to view it.</p></div>`;
  if (state.filesPreview === "loading") {
    body = `<div class="files-preview-empty"><p>Loading preview…</p></div>`;
  } else if (state.filesPreview?.kind === "image") {
    body = `<div class="files-preview-media"><img src="${state.filesPreview.url}" alt="${escapeHtml(entry.name)}" /></div>`;
  } else if (state.filesPreview?.kind === "pdf") {
    body = `<iframe class="files-preview-frame" src="${state.filesPreview.url}" title="${escapeHtml(entry.name)}"></iframe>`;
  } else if (state.filesPreview?.kind === "markdown") {
    body = `<div class="files-preview-doc">${renderMarkdown(state.filesPreview.text)}</div>`;
  } else if (state.filesPreview?.kind === "text") {
    body = `<pre class="files-preview-text">${escapeHtml(state.filesPreview.text)}</pre>`;
  }

  return `
    <div class="files-preview-head">
      <div class="files-crumb">${crumb}</div>
      <div class="files-preview-actions">
        <button type="button" class="files-upload-btn" id="files-upload-btn">
          <i data-lucide="upload"></i> Upload here
        </button>
        <a class="files-download-btn" href="${downloadUrl}"><i data-lucide="download"></i> Download</a>
        <button type="button" class="files-upload-btn files-delete-btn" id="files-delete-btn" data-files-delete-path="${escapeHtml(entry.path)}">
          <i data-lucide="trash-2"></i> Delete
        </button>
      </div>
    </div>
    <div class="files-preview-meta">${escapeHtml(meta)}</div>
    <div class="files-preview-body">${body}</div>
  `;
}

function renderFilesView() {
  const roots = state.filesChildren.get("") ?? [];
  return `
    <div class="files-view">
      <aside class="files-tree" data-lenis-prevent>
        <div class="files-tree-head">
          <h2>Files</h2>
          <input type="file" id="files-upload-input" multiple hidden />
        </div>
        ${state.filesError ? `<div class="files-error">${escapeHtml(state.filesError)}</div>` : ""}
        ${
          roots.length
            ? roots.map((r) => renderFilesTreeNode(r, 0)).join("")
            : `<div class="files-row files-loading">Loading…</div>`
        }
      </aside>
      <div class="files-preview-pane" data-lenis-prevent>
        ${state.filesUploading ? `<div class="files-uploading-banner">Uploading…</div>` : ""}
        ${renderFilesPreview()}
      </div>
    </div>
  `;
}

// ---------- Calendar view ----------

function renderMiniCalendar() {
  ensureCalendarState();
  const cursor = state.calendarCursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const todayStr = ymd(new Date());
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const active = filteredSchedules();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<span class="mini-cell empty"></span>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month, day);
    const dateStr = ymd(dateObj);
    const hasSchedule = active.some((s) => scheduleActiveOn(s, dateStr, dateObj));
    const classes = ["mini-cell"];
    if (dateStr === todayStr) classes.push("today");
    if (dateStr === state.calendarSelectedDate) classes.push("selected");
    if (dateStr === state.calendarPendingStart) classes.push("pending");
    cells.push(`
      <button type="button" class="${classes.join(" ")}" data-date="${dateStr}">
        ${day}${hasSchedule ? `<span class="mini-dot"></span>` : ""}
      </button>
    `);
  }

  return `
    <div class="mini-calendar">
      <div class="mini-calendar-head">
        <button type="button" class="run-action-icon" id="mini-cal-prev" aria-label="Previous month"><i data-lucide="chevron-left"></i></button>
        <strong>${cursor.toLocaleDateString([], { month: "long", year: "numeric" })}</strong>
        <button type="button" class="run-action-icon" id="mini-cal-next" aria-label="Next month"><i data-lucide="chevron-right"></i></button>
      </div>
      <div class="mini-weekdays">${WEEKDAY_NAMES.map((d) => `<span>${d[0]}</span>`).join("")}</div>
      <div class="mini-grid">${cells.join("")}</div>
    </div>
  `;
}

function renderMonthGrid() {
  ensureCalendarState();
  const cursor = state.calendarCursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const todayStr = ymd(new Date());
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const active = filteredSchedules();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="calendar-cell empty"></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month, day);
    const dateStr = ymd(dateObj);
    const items = active.filter((s) => scheduleActiveOn(s, dateStr, dateObj));
    const dots = items
      .slice(0, 4)
      .map((s) => `<span class="calendar-dot" style="background:${scheduleAgentColor(s.agentKey)}" title="${escapeHtml(s.label)}"></span>`)
      .join("");
    const classes = ["calendar-cell"];
    if (dateStr === todayStr) classes.push("today");
    if (dateStr === state.calendarSelectedDate) classes.push("selected");
    if (dateStr === state.calendarPendingStart) classes.push("pending");
    cells.push(`
      <button type="button" class="${classes.join(" ")}" data-date="${dateStr}">
        <span class="calendar-cell-num">${day}</span>
        <span class="calendar-cell-dots">${dots}</span>
      </button>
    `);
  }

  return `
    <div class="calendar-weekdays">${WEEKDAY_NAMES.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
  `;
}

function renderDetailPanel() {
  ensureCalendarState();
  const dateStr = state.calendarSelectedDate;
  const dateObj = parseYmd(dateStr);
  const items = filteredSchedules().filter((s) => scheduleActiveOn(s, dateStr, dateObj));
  const dateLabel = dateObj.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const body = items.length
    ? items
        .map(
          (s) => `
      <div class="detail-card" style="--chip-color:${scheduleAgentColor(s.agentKey)}">
        <div class="detail-card-head">
          <span class="detail-card-title">${escapeHtml(s.label)}</span>
          <span class="detail-card-time">${s.time}</span>
        </div>
        <div class="detail-card-meta">${escapeHtml(sourceLabel(s.agentKey))} · ${escapeHtml(describeRecurrence(s.recurrence))}</div>
        <div class="detail-card-goal">${escapeHtml(truncateText(s.goal, 90))}</div>
        <div class="detail-card-actions">
          <button type="button" class="toggle-switch${s.enabled ? " on" : ""}" data-toggle-schedule="${s.id}" data-enabled="${s.enabled}" role="switch" aria-checked="${s.enabled}" aria-label="${s.enabled ? "Disable" : "Enable"} ${escapeHtml(s.label)}">
            <span class="toggle-knob"></span>
          </button>
          <button type="button" class="run-action-icon" data-edit-schedule="${s.id}" data-label="Edit" aria-label="Edit"><i data-lucide="pencil"></i></button>
          <button type="button" class="run-action-icon run-action-danger" data-delete-schedule="${s.id}" data-label="Delete" aria-label="Delete"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `,
        )
        .join("")
    : `<div class="bento-detail-empty">No automations on this date.</div>`;

  return `
    <div class="detail-panel">
      <div class="detail-panel-head">
        <strong>${escapeHtml(dateLabel)}</strong>
        <button type="button" class="run-action-icon" id="detail-add-schedule" data-label="New automation" aria-label="New automation"><i data-lucide="plus"></i></button>
      </div>
      <div class="detail-panel-body">${body}</div>
    </div>
  `;
}

function renderScheduleList() {
  const items = filteredSchedules();
  if (!items.length) {
    return `<div class="bento-detail-empty">No automations match this filter.</div>`;
  }
  return `
    <ul class="schedule-list">
      ${items
        .map(
          (s) => `
        <li class="schedule-item${s.enabled ? "" : " disabled"}">
          <span class="calendar-dot" style="background:${scheduleAgentColor(s.agentKey)}"></span>
          <span class="schedule-item-body">
            <span class="schedule-item-label">${escapeHtml(s.label)}</span>
            <span class="item-meta">${escapeHtml(sourceLabel(s.agentKey))} · ${s.time} · ${escapeHtml(describeRecurrence(s.recurrence))}${s.lastFiredDate ? ` · last ran ${s.lastFiredDate}` : ""}</span>
          </span>
          <span class="schedule-item-actions">
            <button type="button" class="toggle-switch${s.enabled ? " on" : ""}" data-toggle-schedule="${s.id}" data-enabled="${s.enabled}" role="switch" aria-checked="${s.enabled}" aria-label="${s.enabled ? "Disable" : "Enable"} ${escapeHtml(s.label)}">
              <span class="toggle-knob"></span>
            </button>
            <button type="button" class="run-action-icon" data-edit-schedule="${s.id}" data-label="Edit" aria-label="Edit"><i data-lucide="pencil"></i></button>
            <button type="button" class="run-action-icon run-action-danger" data-delete-schedule="${s.id}" data-label="Delete" aria-label="Delete"><i data-lucide="trash-2"></i></button>
          </span>
        </li>
      `,
        )
        .join("")}
    </ul>
  `;
}

function renderCalendarTabs() {
  const tabs = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "disabled", label: "Disabled" },
  ];
  return `
    <div class="calendar-tabs">
      ${tabs
        .map(
          (t) =>
            `<button type="button" class="calendar-tab${state.calendarStatusFilter === t.key ? " active" : ""}" data-calendar-status="${t.key}">${t.label}</button>`,
        )
        .join("")}
    </div>
  `;
}

function renderCalendarToolbar() {
  ensureCalendarState();
  const label = state.calendarCursor.toLocaleDateString([], { month: "long", year: "numeric" });

  return `
    <div class="calendar-toolbar">
      <div class="calendar-toolbar-left">
        <button type="button" class="archive-toggle-btn" id="calendar-today" aria-label="Go to today">Today</button>
        <div class="calendar-nav-arrows">
          <button type="button" class="run-action-icon" id="calendar-prev" aria-label="Previous"><i data-lucide="chevron-left"></i></button>
          <button type="button" class="run-action-icon" id="calendar-next" aria-label="Next"><i data-lucide="chevron-right"></i></button>
        </div>
        <strong class="calendar-range-label">${escapeHtml(label)}</strong>
      </div>
      <div class="calendar-toolbar-right">
        ${
          state.calendarRangeMode && state.calendarPendingStart
            ? `<span class="calendar-hint">Selecting range from ${state.calendarPendingStart} — click the end date. <button type="button" class="link-btn" id="calendar-clear-selection">Cancel</button></span>`
            : ""
        }
        <button type="button" class="archive-toggle-btn${state.calendarRangeMode ? " active" : ""}" id="calendar-range-toggle">
          ${state.calendarRangeMode ? "Range: on" : "Select a range"}
        </button>
        <button type="button" class="ai-button" id="calendar-add"><i data-lucide="plus"></i> Schedule automation</button>
      </div>
    </div>
  `;
}

function renderCalendarView() {
  ensureCalendarState();
  return `
    <div class="calendar-view">
      <div class="calendar-view-head">
        <h2>Calendar</h2>
        ${renderCalendarTabs()}
      </div>

      ${renderCalendarToolbar()}

      <div class="calendar-columns">
        <aside class="calendar-side">
          ${renderMiniCalendar()}
          ${renderDetailPanel()}
        </aside>
        <div class="calendar-main">
          ${renderMonthGrid()}
        </div>
      </div>

      <div class="tasks-panel schedule-panel">
        <h3>All scheduled automations</h3>
        ${renderScheduleList()}
      </div>
    </div>
    ${renderScheduleModal()}
  `;
}

function agentOptionsHtml(selected) {
  const options = [{ key: "ceo", label: "CEO" }, ...state.departments.filter((d) => d.key !== "calendar")];
  return options
    .map((o) => `<option value="${o.key}"${o.key === selected ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
}

function renderScheduleModal() {
  const m = state.scheduleModal;
  if (!m) return "";

  const recurrenceFields =
    m.recurrenceType === "once"
      ? `<label class="field-label">Date<input type="date" name="date" value="${m.date}" required /></label>`
      : `
        <label class="field-label">Start date<input type="date" name="startDate" value="${m.startDate}" required /></label>
        <label class="field-label">End date (optional)<input type="date" name="endDate" value="${m.endDate === m.startDate ? "" : m.endDate}" /></label>
        ${
          m.recurrenceType === "weekly"
            ? `<div class="field-label">Repeats on
                <div class="weekday-picker">
                  ${WEEKDAY_NAMES.map(
                    (name, i) => `
                    <label class="weekday-chip">
                      <input type="checkbox" name="weekday" value="${i}" ${m.weekdays.includes(i) ? "checked" : ""} />
                      ${name}
                    </label>
                  `,
                  ).join("")}
                </div>
              </div>`
            : ""
        }
      `;

  const isEdit = Boolean(m.id);

  return `
    <div class="confirm-backdrop" id="schedule-modal-backdrop">
      <div class="confirm-modal schedule-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
        <h3 id="schedule-modal-title">${isEdit ? "Edit automation" : "Schedule an automation"}</h3>
        <form id="schedule-form">
          <label class="field-label">Title<input type="text" name="label" value="${escapeHtml(m.label)}" placeholder="e.g. Weekly sales outreach" required /></label>
          <label class="field-label">Agent
            <select name="agentKey">${agentOptionsHtml(m.agentKey)}</select>
          </label>
          <label class="field-label">Goal<textarea name="goal" rows="3" placeholder="What should the agent do when this fires?" required>${escapeHtml(m.goal)}</textarea></label>
          <label class="field-label">Recurrence
            <select id="schedule-recurrence-type" name="recurrenceType">
              <option value="once"${m.recurrenceType === "once" ? " selected" : ""}>Once</option>
              <option value="daily"${m.recurrenceType === "daily" ? " selected" : ""}>Daily</option>
              <option value="weekly"${m.recurrenceType === "weekly" ? " selected" : ""}>Weekly</option>
            </select>
          </label>
          ${recurrenceFields}
          <label class="field-label">Time<input type="time" name="time" value="${m.time}" required /></label>
          ${m.error ? `<p class="attachment-error">${escapeHtml(m.error)}</p>` : ""}
          <div class="confirm-modal-actions">
            ${isEdit ? `<button type="button" class="confirm-btn confirm-btn-danger" id="schedule-modal-delete">Delete</button>` : ""}
            <button type="button" class="confirm-btn confirm-btn-cancel" id="schedule-modal-cancel">Cancel</button>
            <button type="submit" class="confirm-btn confirm-btn-primary" ${m.submitting ? "disabled" : ""}>${m.submitting ? "Saving…" : isEdit ? "Save changes" : "Schedule automation"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// ---------- CRM / leads ----------

const LEAD_FILTER_GROUPS = {
  all: LEAD_STAGES,
  open: ["new", "contacted", "qualified", "proposal"],
  won: ["won"],
  lost: ["lost"],
};

const OPEN_LEAD_STAGES = LEAD_FILTER_GROUPS.open;

function visibleLeadStages() {
  return LEAD_FILTER_GROUPS[state.leadStageFilter] ?? LEAD_STAGES;
}

function setLeadStageFilter(filter) {
  state.leadStageFilter = filter;
  render();
}

function setCrmTab(tab) {
  state.crmTab = tab;
  render();
}

// "overdue"/"due" only apply to leads still in play — a follow-up date on a
// won/lost/archived lead is just history, not an action item.
function followUpDueStatus(lead) {
  if (!lead.followUpAt || lead.archived || lead.stage === "won" || lead.stage === "lost") return null;
  const today = ymd(new Date());
  if (lead.followUpAt < today) return "overdue";
  if (lead.followUpAt === today) return "due";
  return "upcoming";
}

function daysSince(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function leadSearchText(lead) {
  return [lead.name, lead.company, lead.email, lead.phone, lead.owner, lead.notes, ...(lead.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function distinctLeadSources(leads = state.leads) {
  return [...new Set(leads.map((l) => l.source).filter(Boolean))].sort();
}

function formatLeadValue(lead) {
  if (lead.value === undefined || lead.value === null) return null;
  const amount = Number(lead.value).toLocaleString();
  return !lead.currency || lead.currency === "USD" ? `$${amount}` : `${amount} ${lead.currency}`;
}

// Board and table views both filter through this; the stats view uses
// { ignoreStageFilter: true } since a stage-by-stage breakdown filtered down
// to a single stage tab would be redundant.
function filteredLeads({ ignoreStageFilter = false } = {}) {
  const stages = ignoreStageFilter ? LEAD_STAGES : visibleLeadStages();
  const q = state.leadSearch.trim().toLowerCase();
  const { source, followUp } = state.leadFilters;
  return state.leads.filter((l) => {
    if (!stages.includes(l.stage)) return false;
    if (q && !leadSearchText(l).includes(q)) return false;
    if (source !== "all" && l.source !== source) return false;
    if (followUp === "due") {
      const status = followUpDueStatus(l);
      if (status !== "overdue" && status !== "due") return false;
    } else if (followUp === "has" && !l.followUpAt) {
      return false;
    } else if (followUp === "none" && l.followUpAt) {
      return false;
    }
    return true;
  });
}

function defaultLeadModalDraft() {
  return {
    id: null,
    name: "",
    company: "",
    title: "",
    email: "",
    phone: "",
    source: "manual",
    stage: "new",
    value: "",
    currency: "",
    owner: "",
    tags: "",
    followUpAt: "",
    notes: "",
    submitting: false,
    error: null,
  };
}

function openLeadModal() {
  state.leadModal = defaultLeadModalDraft();
  render();
}

// Opens the same modal pre-filled from an existing LeadRecord, so clicking a
// card in the board edits it in place rather than only offering a quick
// stage change from the board itself.
function openEditLeadModal(lead) {
  state.leadModal = {
    id: lead.id,
    name: lead.name,
    company: lead.company ?? "",
    title: lead.title ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    source: lead.source,
    stage: lead.stage,
    value: lead.value ?? "",
    currency: lead.currency ?? "",
    owner: lead.owner ?? "",
    tags: (lead.tags ?? []).join(", "),
    followUpAt: lead.followUpAt ?? "",
    notes: lead.notes ?? "",
    submitting: false,
    error: null,
  };
  render();
}

function closeLeadModal() {
  state.leadModal = null;
  render();
}

async function saveLeadModal() {
  const form = document.getElementById("lead-form");
  const m = state.leadModal;
  if (!form || !m) return;
  const name = form.name.value.trim();
  const source = form.source.value.trim();
  if (!name || !source) {
    m.error = "Name and source are required.";
    render();
    return;
  }
  m.error = null;
  m.submitting = true;
  render();
  const body = {
    name,
    source,
    company: form.company.value.trim() || undefined,
    title: form.title.value.trim() || undefined,
    email: form.email.value.trim() || undefined,
    phone: form.phone.value.trim() || undefined,
    stage: form.stage.value,
    value: form.value.value !== "" ? Number(form.value.value) : undefined,
    currency: form.currency.value.trim() || undefined,
    owner: form.owner.value.trim() || undefined,
    tags: form.tags.value.trim() ? form.tags.value.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    followUpAt: form.followUpAt.value || undefined,
    notes: form.notes.value.trim() || undefined,
  };
  try {
    if (m.id) {
      await fetchJSON(`/api/leads/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await fetchJSON("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    await loadLeads();
    state.leadModal = null;
    render();
  } catch (err) {
    m.submitting = false;
    m.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function quickSetLeadStage(id, stage) {
  await fetchJSON(`/api/leads/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage }),
  });
  await loadLeads();
  render();
}

async function addLeadActivityNote(id, note) {
  await fetchJSON(`/api/leads/${id}/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  await loadLeads();
  render();
}

function deleteLead(id) {
  openConfirmModal({
    title: "Delete this lead?",
    message: "Its record and activity log will be permanently removed. This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeleteLead(id),
  });
}

async function performDeleteLead(id) {
  await fetchJSON(`/api/leads/${id}`, { method: "DELETE" });
  if (state.leadModal?.id === id) state.leadModal = null;
  await loadLeads();
  render();
}

function renderLeadTabs() {
  const tabs = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "won", label: "Won" },
    { key: "lost", label: "Lost" },
  ];
  return `
    <div class="section-tabs">
      ${tabs
        .map(
          (t) =>
            `<button type="button" class="section-tab${state.leadStageFilter === t.key ? " active" : ""}" data-lead-filter="${t.key}">${t.label}</button>`,
        )
        .join("")}
    </div>
  `;
}

function renderLeadCard(lead) {
  const value = formatLeadValue(lead);
  const followUp = followUpDueStatus(lead);
  const tags = (lead.tags ?? []).slice(0, 2);
  return `
    <div class="lead-card">
      <div class="lead-card-main" data-open-lead="${lead.id}">
        <span class="lead-card-name">
          ${escapeHtml(lead.name)}
          ${followUp === "overdue" || followUp === "due" ? `<i data-lucide="clock" class="lead-card-followup lead-card-followup-${followUp}"></i>` : ""}
        </span>
        ${lead.company ? `<span class="lead-card-company">${escapeHtml(lead.company)}</span>` : ""}
        <span class="lead-card-meta">
          <span class="lead-card-source">${escapeHtml(lead.source)}</span>
          ${value !== null ? `<span class="lead-card-value">${value}</span>` : ""}
        </span>
        ${tags.length ? `<span class="lead-card-tags">${tags.map((t) => `<span class="lead-tag-chip">${escapeHtml(t)}</span>`).join("")}</span>` : ""}
      </div>
      <select class="lead-card-stage" data-quick-stage="${lead.id}" aria-label="Change stage for ${escapeHtml(lead.name)}">
        ${LEAD_STAGES.map((s) => `<option value="${s}"${s === lead.stage ? " selected" : ""}>${LEAD_STAGE_LABELS[s]}</option>`).join("")}
      </select>
    </div>
  `;
}

function renderKanbanColumn(stage, leads) {
  const leadsInStage = leads.filter((l) => l.stage === stage);
  return `
    <div class="kanban-column">
      <div class="kanban-column-head">
        <span class="kanban-column-title">${LEAD_STAGE_LABELS[stage]}</span>
        <span class="kanban-column-count">${leadsInStage.length}</span>
      </div>
      <div class="kanban-column-body" data-lenis-prevent>
        ${leadsInStage.map(renderLeadCard).join("") || `<p class="kanban-empty">No leads.</p>`}
      </div>
    </div>
  `;
}

function renderKanbanBoard() {
  const leads = filteredLeads();
  return `
    <div class="kanban-board" data-lenis-prevent>
      ${visibleLeadStages().map((s) => renderKanbanColumn(s, leads)).join("")}
    </div>
  `;
}

// ---------- CRM: table view ----------

const LEAD_SORT_ACCESSORS = {
  name: (l) => (l.name ?? "").toLowerCase(),
  stage: (l) => LEAD_STAGES.indexOf(l.stage),
  value: (l) => (l.value === undefined || l.value === null ? -Infinity : Number(l.value)),
  followUpAt: (l) => l.followUpAt ?? "",
  updatedAt: (l) => l.updatedAt,
};

function setLeadSort(key) {
  if (state.leadSort.key === key) {
    state.leadSort.dir = state.leadSort.dir === "asc" ? "desc" : "asc";
  } else {
    state.leadSort = { key, dir: "asc" };
  }
  render();
}

function sortedLeads(leads) {
  const { key, dir } = state.leadSort;
  const accessor = LEAD_SORT_ACCESSORS[key] ?? LEAD_SORT_ACCESSORS.updatedAt;
  const sorted = [...leads].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  if (dir === "desc") sorted.reverse();
  return sorted;
}

function leadSortIndicator(key) {
  if (state.leadSort.key !== key) return "";
  return `<i data-lucide="${state.leadSort.dir === "asc" ? "chevron-up" : "chevron-down"}" class="lead-sort-icon"></i>`;
}

function renderLeadTableRow(lead) {
  const value = formatLeadValue(lead);
  const tags = lead.tags ?? [];
  const followUp = followUpDueStatus(lead);
  return `
    <tr class="lead-table-row" data-open-lead="${lead.id}">
      <td>
        <span class="lead-table-name">${escapeHtml(lead.name)}</span>
        ${lead.company ? `<span class="lead-table-company">${escapeHtml(lead.company)}</span>` : ""}
      </td>
      <td><span class="lead-stage-badge lead-stage-${lead.stage}">${LEAD_STAGE_LABELS[lead.stage]}</span></td>
      <td>${escapeHtml(lead.source)}</td>
      <td>${value ?? "—"}</td>
      <td>${lead.owner ? escapeHtml(lead.owner) : "—"}</td>
      <td>${tags.length ? `<span class="lead-table-tags">${tags.map((t) => `<span class="lead-tag-chip">${escapeHtml(t)}</span>`).join("")}</span>` : "—"}</td>
      <td class="${followUp === "overdue" ? "lead-followup-overdue" : ""}">${lead.followUpAt ?? "—"}</td>
      <td class="playbook-date-cell">${formatTime(lead.updatedAt)}</td>
      <td class="playbook-row-actions">
        <button type="button" class="run-action-icon" data-open-lead="${lead.id}" aria-label="Edit"><i data-lucide="pencil"></i></button>
        <button type="button" class="run-action-icon run-action-danger" data-delete-lead-row="${lead.id}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>
  `;
}

function renderLeadTable() {
  const leads = sortedLeads(filteredLeads());
  return `
    <div class="lead-table-wrap" data-lenis-prevent>
      <table class="lead-table">
        <thead>
          <tr>
            <th data-sort-lead="name">Name ${leadSortIndicator("name")}</th>
            <th data-sort-lead="stage">Stage ${leadSortIndicator("stage")}</th>
            <th>Source</th>
            <th data-sort-lead="value">Value ${leadSortIndicator("value")}</th>
            <th>Owner</th>
            <th>Tags</th>
            <th data-sort-lead="followUpAt">Follow-up ${leadSortIndicator("followUpAt")}</th>
            <th data-sort-lead="updatedAt">Updated ${leadSortIndicator("updatedAt")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${leads.map(renderLeadTableRow).join("")}</tbody>
      </table>
      ${!leads.length ? `<div class="empty-state"><p>No leads match the current filters.</p></div>` : ""}
    </div>
  `;
}

// ---------- CRM: stats dashboard ----------

function renderLeadBarList(items, max) {
  return `
    <ul class="crm-bar-list">
      ${items
        .map(
          (i) => `
        <li>
          <span class="crm-bar-label">${escapeHtml(i.label)}</span>
          <span class="crm-bar-track"><span class="crm-bar-fill" style="width:${max ? (i.count / max) * 100 : 0}%" title="${i.count}"></span></span>
          <span class="crm-bar-count">${i.count}</span>
        </li>
      `,
        )
        .join("")}
    </ul>
  `;
}

function renderCrmStats() {
  const leads = filteredLeads({ ignoreStageFilter: true }).filter((l) => !l.archived);
  const open = leads.filter((l) => OPEN_LEAD_STAGES.includes(l.stage));
  const won = leads.filter((l) => l.stage === "won");
  const lost = leads.filter((l) => l.stage === "lost");
  const sumValue = (list) => list.reduce((sum, l) => sum + (Number(l.value) || 0), 0);
  const openValue = sumValue(open);
  const wonValue = sumValue(won);
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  const dueFollowUps = leads.filter((l) => ["overdue", "due"].includes(followUpDueStatus(l)));
  const avgAgeDays = open.length ? Math.round(open.reduce((sum, l) => sum + daysSince(l.stageEnteredAt), 0) / open.length) : null;

  const stageCounts = LEAD_STAGES.map((s) => ({ label: LEAD_STAGE_LABELS[s], count: leads.filter((l) => l.stage === s).length }));
  const maxStageCount = Math.max(1, ...stageCounts.map((s) => s.count));

  const sourceCounts = distinctLeadSources(leads)
    .map((s) => ({ label: s, count: leads.filter((l) => l.source === s).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const maxSourceCount = Math.max(1, ...sourceCounts.map((s) => s.count));

  const followUpList = leads
    .filter((l) => l.followUpAt)
    .sort((a, b) => a.followUpAt.localeCompare(b.followUpAt))
    .slice(0, 8);

  return `
    <div class="crm-stats">
      <div class="crm-kpi-grid">
        <div class="crm-kpi-tile crm-kpi-mint">
          <span class="crm-kpi-label">Open pipeline value</span>
          <span class="crm-kpi-value">$${openValue.toLocaleString()}</span>
          <span class="crm-kpi-sub">${open.length} open lead${open.length === 1 ? "" : "s"}</span>
        </div>
        <div class="crm-kpi-tile crm-kpi-forest">
          <span class="crm-kpi-label">Won value</span>
          <span class="crm-kpi-value">$${wonValue.toLocaleString()}</span>
          <span class="crm-kpi-sub">${won.length} won</span>
        </div>
        <div class="crm-kpi-tile crm-kpi-orange">
          <span class="crm-kpi-label">Win rate</span>
          <span class="crm-kpi-value">${winRate === null ? "—" : `${winRate}%`}</span>
          <span class="crm-kpi-sub">${won.length} won · ${lost.length} lost</span>
        </div>
        <div class="crm-kpi-tile crm-kpi-lavender">
          <span class="crm-kpi-label">Needs follow-up</span>
          <span class="crm-kpi-value">${dueFollowUps.length}</span>
          <span class="crm-kpi-sub">${avgAgeDays === null ? "no open leads" : `avg ${avgAgeDays}d in stage`}</span>
        </div>
      </div>

      ${
        won.length + lost.length
          ? `
      <div class="crm-stats-panel">
        <h3>Won vs lost</h3>
        <div class="crm-split-bar">
          <div class="crm-split-seg crm-split-won" style="width:${(won.length / (won.length + lost.length)) * 100}%" title="${won.length} won"></div>
          <div class="crm-split-seg crm-split-lost" style="width:${(lost.length / (won.length + lost.length)) * 100}%" title="${lost.length} lost"></div>
        </div>
        <div class="crm-split-legend">
          <span><i class="crm-split-dot crm-split-won"></i>Won (${won.length})</span>
          <span><i class="crm-split-dot crm-split-lost"></i>Lost (${lost.length})</span>
        </div>
      </div>`
          : ""
      }

      <div class="crm-stats-row">
        <div class="crm-stats-panel">
          <h3>Leads by stage</h3>
          ${renderLeadBarList(stageCounts, maxStageCount)}
        </div>
        <div class="crm-stats-panel">
          <h3>Leads by source</h3>
          ${sourceCounts.length ? renderLeadBarList(sourceCounts, maxSourceCount) : `<p class="crm-stats-empty">No leads yet.</p>`}
        </div>
      </div>

      <div class="crm-stats-panel">
        <h3>Upcoming follow-ups</h3>
        ${
          followUpList.length
            ? `
          <ul class="crm-followup-list">
            ${followUpList
              .map((l) => {
                const status = followUpDueStatus(l);
                return `<li data-open-lead="${l.id}">
                <span class="crm-followup-name">${escapeHtml(l.name)}</span>
                <span class="crm-followup-date crm-followup-${status}">${l.followUpAt}${status === "overdue" ? " · overdue" : status === "due" ? " · today" : ""}</span>
              </li>`;
              })
              .join("")}
          </ul>
        `
            : `<p class="crm-stats-empty">No follow-ups scheduled.</p>`
        }
      </div>
    </div>
  `;
}

// ---------- CRM: CSV import/export ----------

const LEAD_CSV_COLUMNS = [
  "name",
  "company",
  "title",
  "email",
  "phone",
  "source",
  "stage",
  "value",
  "currency",
  "owner",
  "tags",
  "followUpAt",
  "notes",
  "createdAt",
  "updatedAt",
];

function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function leadsToCSV(leads) {
  const header = LEAD_CSV_COLUMNS.join(",");
  const lines = leads.map((l) =>
    LEAD_CSV_COLUMNS.map((col) => csvEscape(col === "tags" ? (l.tags ?? []).join(";") : l[col])).join(","),
  );
  return [header, ...lines].join("\n");
}

function exportLeadsCSV() {
  const csv = leadsToCSV(filteredLeads());
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-${ymd(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Minimal RFC4180 parser: handles quoted fields with embedded commas,
// newlines, and escaped ("") quotes — enough for CSV round-tripped from
// exportLeadsCSV() or exported from a spreadsheet app.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const LEAD_IMPORT_FIELD_ALIASES = {
  name: "name",
  company: "company",
  title: "title",
  email: "email",
  phone: "phone",
  source: "source",
  stage: "stage",
  value: "value",
  currency: "currency",
  owner: "owner",
  tags: "tags",
  followupat: "followUpAt",
  followup: "followUpAt",
  "follow-up": "followUpAt",
  notes: "notes",
};

function openLeadImportPicker() {
  document.getElementById("lead-import-input")?.click();
}

async function handleLeadImportFile(file) {
  const text = await file.text();
  const table = parseCSV(text);
  if (!table.length) {
    state.leadImportModal = { fileName: file.name, rows: [], submitting: false, error: "The file appears to be empty.", result: null };
    render();
    return;
  }
  const header = table[0].map((h) => h.trim().toLowerCase());
  const rows = table.slice(1).map((cells) => {
    const raw = {};
    header.forEach((h, i) => {
      const field = LEAD_IMPORT_FIELD_ALIASES[h];
      if (field) raw[field] = (cells[i] ?? "").trim();
    });
    const errors = [];
    if (!raw.name) errors.push("missing name");
    const stage = raw.stage && LEAD_STAGES.includes(raw.stage) ? raw.stage : "new";
    return {
      name: raw.name ?? "",
      company: raw.company || undefined,
      title: raw.title || undefined,
      email: raw.email || undefined,
      phone: raw.phone || undefined,
      source: raw.source || "manual",
      stage,
      value: raw.value ? Number(raw.value) : undefined,
      currency: raw.currency || undefined,
      owner: raw.owner || undefined,
      tags: raw.tags ? raw.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean) : undefined,
      followUpAt: raw.followUpAt || undefined,
      notes: raw.notes || undefined,
      errors,
    };
  });
  state.leadImportModal = { fileName: file.name, rows, submitting: false, error: null, result: null };
  render();
}

function closeLeadImportModal() {
  state.leadImportModal = null;
  render();
}

async function confirmLeadImport() {
  const m = state.leadImportModal;
  if (!m) return;
  const valid = m.rows.filter((r) => r.errors.length === 0);
  m.submitting = true;
  render();
  let ok = 0;
  let failed = 0;
  for (const row of valid) {
    const { errors, ...body } = row;
    try {
      await fetchJSON("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ok++;
    } catch {
      failed++;
    }
  }
  await loadLeads();
  m.submitting = false;
  m.result = { ok, failed };
  render();
}

function renderCrmView() {
  return `
    <div class="crm-view">
      <div class="section-head">
        <h2>CRM</h2>
        <div class="section-tabs">
          ${["board", "table", "stats"]
            .map(
              (t) =>
                `<button type="button" class="section-tab${state.crmTab === t ? " active" : ""}" data-crm-tab="${t}">${t[0].toUpperCase()}${t.slice(1)}</button>`,
            )
            .join("")}
        </div>
        <span class="section-count">${state.leads.length} lead${state.leads.length === 1 ? "" : "s"}</span>
        <button type="button" class="ai-button" id="crm-add-lead"><i data-lucide="plus"></i> Add lead</button>
      </div>
      ${renderCrmToolbar()}
      ${state.crmTab === "table" ? renderLeadTable() : state.crmTab === "stats" ? renderCrmStats() : renderKanbanBoard()}
    </div>
    ${renderLeadModal()}
    ${renderLeadImportModal()}
  `;
}

function renderCrmToolbar() {
  const sources = distinctLeadSources();
  return `
    <div class="crm-toolbar">
      ${state.crmTab !== "stats" ? renderLeadTabs() : ""}
      <div class="crm-toolbar-search">
        <i data-lucide="search"></i>
        <input type="text" id="crm-search" placeholder="Search leads…" value="${escapeHtml(state.leadSearch)}" />
      </div>
      <select id="crm-source-filter" class="crm-toolbar-select" aria-label="Filter by source">
        <option value="all"${state.leadFilters.source === "all" ? " selected" : ""}>All sources</option>
        ${sources.map((s) => `<option value="${escapeHtml(s)}"${state.leadFilters.source === s ? " selected" : ""}>${escapeHtml(s)}</option>`).join("")}
      </select>
      <select id="crm-followup-filter" class="crm-toolbar-select" aria-label="Filter by follow-up">
        <option value="all"${state.leadFilters.followUp === "all" ? " selected" : ""}>Any follow-up</option>
        <option value="due"${state.leadFilters.followUp === "due" ? " selected" : ""}>Due or overdue</option>
        <option value="has"${state.leadFilters.followUp === "has" ? " selected" : ""}>Has date</option>
        <option value="none"${state.leadFilters.followUp === "none" ? " selected" : ""}>No date</option>
      </select>
      <button type="button" class="files-download-btn" id="crm-export-btn"><i data-lucide="download"></i> Export CSV</button>
      <button type="button" class="files-upload-btn" id="crm-import-btn"><i data-lucide="upload"></i> Import CSV</button>
      <input type="file" id="lead-import-input" accept=".csv,text/csv" hidden />
    </div>
  `;
}

function renderLeadImportModal() {
  const m = state.leadImportModal;
  if (!m) return "";
  if (m.error) {
    return `
      <div class="confirm-backdrop" id="lead-import-backdrop">
        <div class="confirm-modal lead-modal" role="dialog" aria-modal="true" data-lenis-prevent>
          <h3>Import failed</h3>
          <p class="attachment-error">${escapeHtml(m.error)}</p>
          <div class="confirm-modal-actions">
            <button type="button" class="confirm-btn confirm-btn-primary" id="lead-import-done">Close</button>
          </div>
        </div>
      </div>
    `;
  }
  if (m.result) {
    return `
      <div class="confirm-backdrop" id="lead-import-backdrop">
        <div class="confirm-modal lead-modal" role="dialog" aria-modal="true" data-lenis-prevent>
          <h3>Import complete</h3>
          <p>Imported ${m.result.ok} lead${m.result.ok === 1 ? "" : "s"}.${m.result.failed ? ` ${m.result.failed} failed.` : ""}</p>
          <div class="confirm-modal-actions">
            <button type="button" class="confirm-btn confirm-btn-primary" id="lead-import-done">Done</button>
          </div>
        </div>
      </div>
    `;
  }
  const validCount = m.rows.filter((r) => r.errors.length === 0).length;
  return `
    <div class="confirm-backdrop" id="lead-import-backdrop">
      <div class="confirm-modal lead-modal lead-import-modal" role="dialog" aria-modal="true" data-lenis-prevent>
        <h3>Import ${escapeHtml(m.fileName)}</h3>
        <p>${validCount} of ${m.rows.length} row${m.rows.length === 1 ? "" : "s"} ready to import.</p>
        <div class="lead-import-preview" data-lenis-prevent>
          <table class="lead-import-table">
            <thead><tr><th>Name</th><th>Company</th><th>Stage</th><th>Source</th><th></th></tr></thead>
            <tbody>
              ${m.rows
                .slice(0, 50)
                .map(
                  (r) => `
                <tr class="${r.errors.length ? "lead-import-row-error" : ""}">
                  <td>${escapeHtml(r.name || "—")}</td>
                  <td>${escapeHtml(r.company || "—")}</td>
                  <td>${escapeHtml(r.stage)}</td>
                  <td>${escapeHtml(r.source)}</td>
                  <td>${r.errors.length ? escapeHtml(r.errors.join(", ")) : ""}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
          ${m.rows.length > 50 ? `<p class="lead-import-more">+${m.rows.length - 50} more row${m.rows.length - 50 === 1 ? "" : "s"}</p>` : ""}
        </div>
        <div class="confirm-modal-actions">
          <button type="button" class="confirm-btn confirm-btn-cancel" id="lead-import-cancel">Cancel</button>
          <button type="button" class="confirm-btn confirm-btn-primary" id="lead-import-confirm" ${validCount === 0 || m.submitting ? "disabled" : ""}>${m.submitting ? "Importing…" : `Import ${validCount} lead${validCount === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </div>
  `;
}

function renderLeadActivity(lead) {
  const items = (lead?.activity ?? []).slice().reverse();
  return `
    <div class="lead-activity">
      <h4>Activity</h4>
      <ul class="lead-activity-list" data-lenis-prevent>
        ${
          items.length
            ? items
                .map(
                  (a) =>
                    `<li><span class="lead-activity-ts">${formatTime(a.ts)}</span><span class="lead-activity-note">${escapeHtml(a.note)}</span></li>`,
                )
                .join("")
            : `<li class="lead-activity-empty">No activity yet.</li>`
        }
      </ul>
      <form id="lead-activity-form" class="lead-activity-form">
        <input type="text" name="note" placeholder="Add a note…" required />
        <button type="submit" class="confirm-btn confirm-btn-cancel">Add</button>
      </form>
    </div>
  `;
}

function renderLeadModal() {
  const m = state.leadModal;
  if (!m) return "";
  const isEdit = Boolean(m.id);
  const lead = isEdit ? state.leads.find((l) => l.id === m.id) : null;

  return `
    <div class="confirm-backdrop" id="lead-modal-backdrop">
      <div class="confirm-modal lead-modal" role="dialog" aria-modal="true" aria-labelledby="lead-modal-title" data-lenis-prevent>
        <h3 id="lead-modal-title">${isEdit ? "Edit lead" : "Add lead"}</h3>
        <form id="lead-form">
          <label class="field-label">Name<input type="text" name="name" value="${escapeHtml(m.name)}" placeholder="e.g. Jane Doe" required /></label>
          <label class="field-label">Company<input type="text" name="company" value="${escapeHtml(m.company)}" /></label>
          <label class="field-label">Title<input type="text" name="title" value="${escapeHtml(m.title)}" /></label>
          <label class="field-label">Email<input type="email" name="email" value="${escapeHtml(m.email)}" /></label>
          <label class="field-label">Phone<input type="text" name="phone" value="${escapeHtml(m.phone)}" /></label>
          <label class="field-label">Source<input type="text" name="source" value="${escapeHtml(m.source)}" placeholder="e.g. research, gmail, manual" required /></label>
          <label class="field-label">Stage
            <select name="stage">${LEAD_STAGES.map((s) => `<option value="${s}"${s === m.stage ? " selected" : ""}>${LEAD_STAGE_LABELS[s]}</option>`).join("")}</select>
          </label>
          <label class="field-label">Value
            <div class="lead-value-row">
              <input type="number" name="value" value="${m.value ?? ""}" placeholder="Deal value (optional)" />
              <input type="text" name="currency" value="${escapeHtml(m.currency)}" placeholder="USD" class="lead-currency-input" />
            </div>
          </label>
          <label class="field-label">Owner<input type="text" name="owner" value="${escapeHtml(m.owner)}" placeholder="Who owns this lead" /></label>
          <label class="field-label">Tags<input type="text" name="tags" value="${escapeHtml(m.tags)}" placeholder="comma-separated, e.g. enterprise, hot" /></label>
          <label class="field-label">Follow-up<input type="date" name="followUpAt" value="${m.followUpAt}" /></label>
          <label class="field-label">Notes<textarea name="notes" rows="3">${escapeHtml(m.notes)}</textarea></label>
          ${m.error ? `<p class="attachment-error">${escapeHtml(m.error)}</p>` : ""}
          <div class="confirm-modal-actions">
            ${isEdit ? `<button type="button" class="confirm-btn confirm-btn-danger" id="lead-modal-delete">Delete</button>` : ""}
            <button type="button" class="confirm-btn confirm-btn-cancel" id="lead-modal-cancel">Cancel</button>
            <button type="submit" class="confirm-btn confirm-btn-primary" ${m.submitting ? "disabled" : ""}>${m.submitting ? "Saving…" : isEdit ? "Save changes" : "Add lead"}</button>
          </div>
        </form>
        ${isEdit ? renderLeadActivity(lead) : ""}
      </div>
    </div>
  `;
}

// ---------- Playbook view ----------
//
// Sales/Marketing tabs, each a table of agent-produced deliverables (AI
// copy, images, videos, email/script drafts) with a done checkbox. Rows are
// created only by the specialist agents (tools/playbook.ts) — this view
// lets a human toggle done, edit a row's fields, or delete it, but has no
// "Add item" form by design (see the playbook memory/decision).

function defaultPlaybookModalDraft(item) {
  return {
    id: item.id,
    type: item.type,
    platform: item.platform ?? "",
    link: item.link ?? "",
    details: item.details ?? "",
    notes: item.notes ?? "",
    done: item.done,
    submitting: false,
    error: null,
  };
}

function openEditPlaybookModal(item) {
  state.playbookModal = defaultPlaybookModalDraft(item);
  render();
}

function closePlaybookModal() {
  state.playbookModal = null;
  render();
}

async function savePlaybookModal() {
  const form = document.getElementById("playbook-form");
  const m = state.playbookModal;
  if (!form || !m) return;
  m.error = null;
  m.submitting = true;
  render();
  const body = {
    type: form.type.value,
    platform: form.platform.value.trim() || undefined,
    link: form.link.value.trim() || undefined,
    details: form.details.value.trim() || undefined,
    notes: form.notes.value.trim() || undefined,
    done: form.done.checked,
  };
  try {
    await fetchJSON(`/api/playbook/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await reloadPlaybookData();
    state.playbookModal = null;
    render();
  } catch (err) {
    m.submitting = false;
    m.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function togglePlaybookDone(id, done) {
  await fetchJSON(`/api/playbook/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  await reloadPlaybookData();
  render();
}

function deletePlaybookItemUI(id) {
  openConfirmModal({
    title: "Delete this playbook item?",
    message: "This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeletePlaybookItem(id),
  });
}

async function performDeletePlaybookItem(id) {
  await fetchJSON(`/api/playbook/${id}`, { method: "DELETE" });
  if (state.playbookModal?.id === id) state.playbookModal = null;
  await reloadPlaybookData();
  render();
}

function renderPlaybookRow(item) {
  return `
    <tr class="playbook-row${item.done ? " done" : ""}">
      <td class="playbook-check-col">
        <input type="checkbox" class="playbook-checkbox" data-toggle-playbook="${item.id}" ${item.done ? "checked" : ""} aria-label="Mark done" />
      </td>
      <td><span class="playbook-type-badge" data-type="${escapeHtml(item.type)}" style="--type-color:${playbookTypeColor(item.type)}">${escapeHtml(PLAYBOOK_TYPE_LABELS[item.type] ?? item.type)}</span></td>
      <td>${item.platform ? escapeHtml(item.platform) : "—"}</td>
      <td>${item.link ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="playbook-link">Open ↗</a>` : "—"}</td>
      <td class="playbook-text-cell">${item.details ? escapeHtml(item.details) : "—"}</td>
      <td class="playbook-text-cell">${item.notes ? escapeHtml(item.notes) : "—"}</td>
      <td>${
        item.owner === "agent"
          ? `<span class="playbook-owner-badge agent">${escapeHtml(item.agentKey ?? "agent")}</span>`
          : `<span class="playbook-owner-badge manual">Manual</span>`
      }</td>
      <td class="playbook-date-cell">${formatTime(item.createdAt)}</td>
      <td class="playbook-date-cell">${item.completedAt ? formatTime(item.completedAt) : "—"}</td>
      <td class="playbook-row-actions">
        <button type="button" class="run-action-icon" data-edit-playbook="${item.id}" aria-label="Edit"><i data-lucide="pencil"></i></button>
        <button type="button" class="run-action-icon run-action-danger" data-delete-playbook="${item.id}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>
  `;
}

function renderPlaybookView() {
  const tab = state.view.key === "marketing" ? "marketing" : "sales";
  const items = state.playbookItems;
  const doneCount = items.filter((i) => i.done).length;

  return `
    <div class="playbook-view">
      <div class="section-head">
        <h2>${tab === "sales" ? "Sales" : "Marketing"} Playbook</h2>
        <div class="section-tabs">
          <button type="button" class="section-tab${tab === "sales" ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: "playbook", key: "sales" }))}'>Sales</button>
          <button type="button" class="section-tab${tab === "marketing" ? " active" : ""}" data-nav='${escapeHtml(JSON.stringify({ type: "playbook", key: "marketing" }))}'>Marketing</button>
        </div>
        <span class="section-count">${doneCount}/${items.length} done</span>
      </div>
      ${
        items.length
          ? `
        <div class="playbook-table-wrap">
          <table class="playbook-table">
            <thead>
              <tr>
                <th class="playbook-check-col">Done</th>
                <th>Type</th>
                <th>Platform</th>
                <th>Link</th>
                <th>Details</th>
                <th>Notes</th>
                <th>Owner</th>
                <th>Added</th>
                <th>Completed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${items.map(renderPlaybookRow).join("")}</tbody>
          </table>
        </div>`
          : `<div class="empty-state"><p>No items yet — the ${tab === "sales" ? "Sales agent" : "SEO/AEO/PR agents"} will add deliverables here as they're produced.</p></div>`
      }
    </div>
    ${renderPlaybookModal()}
  `;
}

function renderPlaybookModal() {
  const m = state.playbookModal;
  if (!m) return "";
  return `
    <div class="confirm-backdrop" id="playbook-modal-backdrop">
      <div class="confirm-modal playbook-modal" role="dialog" aria-modal="true" aria-labelledby="playbook-modal-title">
        <h3 id="playbook-modal-title">Edit playbook item</h3>
        <form id="playbook-form">
          <label class="field-label">Type
            <select name="type">${PLAYBOOK_ITEM_TYPES.map((t) => `<option value="${t}"${t === m.type ? " selected" : ""}>${PLAYBOOK_TYPE_LABELS[t]}</option>`).join("")}</select>
          </label>
          <label class="field-label">Platform<input type="text" name="platform" value="${escapeHtml(m.platform)}" placeholder="e.g. LinkedIn, Instagram, Email" /></label>
          <label class="field-label">Link<input type="text" name="link" value="${escapeHtml(m.link)}" placeholder="https://…" /></label>
          <label class="field-label">Details<textarea name="details" rows="3">${escapeHtml(m.details)}</textarea></label>
          <label class="field-label">Notes<textarea name="notes" rows="2">${escapeHtml(m.notes)}</textarea></label>
          <label class="field-label playbook-done-label"><input type="checkbox" name="done" ${m.done ? "checked" : ""} /> Done</label>
          ${m.error ? `<p class="attachment-error">${escapeHtml(m.error)}</p>` : ""}
          <div class="confirm-modal-actions">
            <button type="button" class="confirm-btn confirm-btn-danger" id="playbook-modal-delete">Delete</button>
            <button type="button" class="confirm-btn confirm-btn-cancel" id="playbook-modal-cancel">Cancel</button>
            <button type="submit" class="confirm-btn confirm-btn-primary" ${m.submitting ? "disabled" : ""}>${m.submitting ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// ---------- Content Calendar ----------
//
// A read-only calendar view over playbook items (both tabs combined),
// keyed by createdAt and color-coded by content type — separate from the
// automation-scheduling Calendar above, which has no notion of content at
// all. Uses its own cursor/selected-date state so switching between the two
// calendars never cross-contaminates the other's "where are we looking".

function ensureContentCalendarState() {
  if (!state.contentCalendarCursor) {
    const now = new Date();
    state.contentCalendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (!state.contentCalendarSelectedDate) {
    state.contentCalendarSelectedDate = ymd(new Date());
  }
  if (!state.contentCalendarTypeFilter) {
    state.contentCalendarTypeFilter = "all";
  }
}

function shiftContentCalendarMonth(delta) {
  ensureContentCalendarState();
  state.contentCalendarCursor = new Date(
    state.contentCalendarCursor.getFullYear(),
    state.contentCalendarCursor.getMonth() + delta,
    1,
  );
  render();
}

function goToContentCalendarToday() {
  const now = new Date();
  state.contentCalendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
  state.contentCalendarSelectedDate = ymd(now);
  render();
}

function selectContentCalendarDate(dateStr) {
  state.contentCalendarSelectedDate = dateStr;
  render();
}

function setContentCalendarTypeFilter(type) {
  state.contentCalendarTypeFilter = type;
  render();
}

function filteredContentCalendarItems() {
  const items = state.contentCalendarItems ?? [];
  if (!state.contentCalendarTypeFilter || state.contentCalendarTypeFilter === "all") return items;
  return items.filter((i) => i.type === state.contentCalendarTypeFilter);
}

function contentCalendarItemsOn(dateStr) {
  return filteredContentCalendarItems().filter((i) => ymd(new Date(i.createdAt)) === dateStr);
}

function renderContentCalendarMonthGrid() {
  ensureContentCalendarState();
  const cursor = state.contentCalendarCursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const todayStr = ymd(new Date());
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="calendar-cell empty"></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = ymd(new Date(year, month, day));
    const items = contentCalendarItemsOn(dateStr);
    const dots = items
      .slice(0, 4)
      .map(
        (i) =>
          `<span class="calendar-dot" style="background:${playbookTypeColor(i.type)}" title="${escapeHtml(PLAYBOOK_TYPE_LABELS[i.type] ?? i.type)}"></span>`,
      )
      .join("");
    const classes = ["calendar-cell"];
    if (dateStr === todayStr) classes.push("today");
    if (dateStr === state.contentCalendarSelectedDate) classes.push("selected");
    cells.push(`
      <button type="button" class="${classes.join(" ")}" data-content-date="${dateStr}">
        <span class="calendar-cell-num">${day}</span>
        <span class="calendar-cell-dots">${dots}</span>
      </button>
    `);
  }

  return `
    <div class="calendar-weekdays">${WEEKDAY_NAMES.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
  `;
}

function renderContentCalendarDetailPanel() {
  ensureContentCalendarState();
  const dateStr = state.contentCalendarSelectedDate;
  const dateObj = parseYmd(dateStr);
  const items = contentCalendarItemsOn(dateStr);
  const dateLabel = dateObj.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const body = items.length
    ? items
        .map(
          (i) => `
      <button type="button" class="detail-card content-detail-card" style="--chip-color:${playbookTypeColor(i.type)}" data-open-content-item="${i.id}">
        <div class="detail-card-head">
          <span class="detail-card-title">${escapeHtml(PLAYBOOK_TYPE_LABELS[i.type] ?? i.type)}</span>
          <span class="detail-card-time">${formatClock(i.createdAt)}</span>
        </div>
        <div class="detail-card-meta">${i.platform ? escapeHtml(i.platform) : "—"} · ${i.tab === "sales" ? "Sales" : "Marketing"} · ${i.done ? "Done" : "Not done"}</div>
        ${i.details ? `<div class="detail-card-goal">${escapeHtml(truncateText(i.details, 90))}</div>` : ""}
      </button>
    `,
        )
        .join("")
    : `<div class="bento-detail-empty">No content logged on this date.</div>`;

  return `
    <div class="detail-panel">
      <div class="detail-panel-head">
        <strong>${escapeHtml(dateLabel)}</strong>
      </div>
      <div class="detail-panel-body">${body}</div>
    </div>
  `;
}

function renderContentCalendarTypeFilter() {
  const chips = [{ key: "all", label: "All" }, ...PLAYBOOK_ITEM_TYPES.map((t) => ({ key: t, label: PLAYBOOK_TYPE_LABELS[t] }))];
  return `
    <div class="calendar-tabs content-type-filter">
      ${chips
        .map(
          (c) => `
        <button type="button" class="calendar-tab content-type-chip${state.contentCalendarTypeFilter === c.key ? " active" : ""}" style="--chip-color:${c.key === "all" ? "var(--accent)" : playbookTypeColor(c.key)}" data-content-type-filter="${c.key}">${escapeHtml(c.label)}</button>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderContentCalendarToolbar() {
  ensureContentCalendarState();
  const label = state.contentCalendarCursor.toLocaleDateString([], { month: "long", year: "numeric" });
  return `
    <div class="calendar-toolbar">
      <div class="calendar-toolbar-left">
        <button type="button" class="archive-toggle-btn" id="content-calendar-today" aria-label="Go to today">Today</button>
        <div class="calendar-nav-arrows">
          <button type="button" class="run-action-icon" id="content-calendar-prev" aria-label="Previous"><i data-lucide="chevron-left"></i></button>
          <button type="button" class="run-action-icon" id="content-calendar-next" aria-label="Next"><i data-lucide="chevron-right"></i></button>
        </div>
        <strong class="calendar-range-label">${escapeHtml(label)}</strong>
      </div>
    </div>
  `;
}

function renderContentCalendarView() {
  ensureContentCalendarState();
  return `
    <div class="calendar-view">
      <div class="calendar-view-head">
        <h2>Content Calendar</h2>
        ${renderContentCalendarTypeFilter()}
      </div>

      ${renderContentCalendarToolbar()}

      <div class="calendar-columns">
        <aside class="calendar-side">
          ${renderContentCalendarDetailPanel()}
        </aside>
        <div class="calendar-main">
          ${renderContentCalendarMonthGrid()}
        </div>
      </div>
    </div>
    ${renderPlaybookModal()}
  `;
}

// ---------- Portfolio view ----------
//
// Editable project/product tabs, each holding entries across five fixed
// categories (blog/article/collab/pr-post/email). Projects are human-curated
// (add/rename/delete via the pencil icon next to the tabs); entries can come
// from either a human via "Add entry" or an agent via tools/portfolio.ts.

// Entries drill down into a full-width detail pane on click — same
// preview/edit pattern as the Portfolio notes (see draftFromPortfolioNote
// below) rather than a small stacked-field popup, since a growing field
// list (link/status/date/subject/recipient/messageId/notes) reads far
// better laid out in a real page than crammed into a modal.

function draftFromPortfolioEntry(entry) {
  return {
    category: entry.category,
    title: entry.title,
    link: entry.link ?? "",
    status: entry.status,
    date: entry.date ?? "",
    notes: entry.notes ?? "",
    recipient: entry.recipient ?? "",
    subject: entry.subject ?? "",
    messageId: entry.messageId ?? "",
    mode: "preview",
    dirty: false,
    saving: false,
    error: null,
  };
}

function openPortfolioEntryDetail(entry) {
  state.portfolioOpenEntryId = entry.id;
  state.portfolioEntryDraft = draftFromPortfolioEntry(entry);
  render();
}

function closePortfolioEntryDetail() {
  state.portfolioOpenEntryId = null;
  state.portfolioEntryDraft = null;
  render();
}

function setPortfolioEntryMode(mode) {
  if (!state.portfolioEntryDraft) return;
  state.portfolioEntryDraft.mode = mode;
  render();
}

function setPortfolioEntryDraftCategory(category) {
  if (!state.portfolioEntryDraft) return;
  state.portfolioEntryDraft.category = category;
  state.portfolioEntryDraft.dirty = true;
  render();
}

async function addPortfolioEntry() {
  if (!state.portfolioActiveProjectId) return;
  const entry = await fetchJSON("/api/portfolio/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: state.portfolioActiveProjectId, category: state.portfolioCategoryFilter, title: "Untitled entry" }),
  });
  await loadPortfolioEntries();
  state.portfolioOpenEntryId = entry.id;
  state.portfolioEntryDraft = { ...draftFromPortfolioEntry(entry), mode: "edit" };
  render();
}

async function savePortfolioEntryDraft() {
  const draft = state.portfolioEntryDraft;
  const id = state.portfolioOpenEntryId;
  if (!draft || !id) return;
  const title = draft.title.trim();
  if (!title) {
    draft.error = "Title is required.";
    render();
    return;
  }
  draft.error = null;
  draft.saving = true;
  render();
  try {
    await fetchJSON(`/api/portfolio/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category: draft.category,
        link: draft.link.trim() || undefined,
        status: draft.status,
        date: draft.date || undefined,
        notes: draft.notes.trim() || undefined,
        recipient: draft.recipient.trim() || undefined,
        subject: draft.subject.trim() || undefined,
        messageId: draft.messageId.trim() || undefined,
      }),
    });
    await loadPortfolioEntries();
    draft.dirty = false;
    draft.saving = false;
    render();
  } catch (err) {
    draft.saving = false;
    draft.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

function deletePortfolioEntry(id) {
  openConfirmModal({
    title: "Delete this entry?",
    message: "This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeletePortfolioEntry(id),
  });
}

async function performDeletePortfolioEntry(id) {
  await fetchJSON(`/api/portfolio/entries/${id}`, { method: "DELETE" });
  if (state.portfolioOpenEntryId === id) {
    state.portfolioOpenEntryId = null;
    state.portfolioEntryDraft = null;
  }
  await loadPortfolioEntries();
  render();
}

const PORTFOLIO_ENTRY_CSV_COLUMNS = [
  "title",
  "category",
  "status",
  "date",
  "subject",
  "recipient",
  "messageId",
  "link",
  "notes",
  "owner",
  "agentKey",
  "createdAt",
];

function portfolioEntriesToCSV(entries) {
  const header = PORTFOLIO_ENTRY_CSV_COLUMNS.join(",");
  const lines = entries.map((e) => PORTFOLIO_ENTRY_CSV_COLUMNS.map((col) => csvEscape(e[col])).join(","));
  return [header, ...lines].join("\n");
}

function exportPortfolioEntriesCSV() {
  const project = state.portfolioProjects.find((p) => p.id === state.portfolioActiveProjectId);
  const entries = state.portfolioEntries.filter((e) => e.category === state.portfolioCategoryFilter);
  if (!entries.length) return;
  const csv = portfolioEntriesToCSV(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(project?.name ?? "portfolio").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${state.portfolioCategoryFilter}-${ymd(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function setPortfolioActiveProject(id) {
  state.portfolioActiveProjectId = id;
  state.portfolioOpenNoteId = null;
  state.portfolioNoteDraft = null;
  render();
  await Promise.all([loadPortfolioEntries(), loadPortfolioNotes()]);
  render();
}

function setPortfolioCategoryFilter(category) {
  state.portfolioCategoryFilter = category;
  state.portfolioOpenNoteId = null;
  state.portfolioNoteDraft = null;
  render();
}

function draftFromPortfolioNote(note) {
  return { title: note.title, content: note.content, mode: "preview", dirty: false, saving: false, error: null, copied: false };
}

function openPortfolioNote(id) {
  const note = state.portfolioNotes.find((n) => n.id === id);
  if (!note) return;
  state.portfolioOpenNoteId = id;
  state.portfolioNoteDraft = draftFromPortfolioNote(note);
  render();
}

function closePortfolioNote() {
  state.portfolioOpenNoteId = null;
  state.portfolioNoteDraft = null;
  render();
}

function setPortfolioNoteMode(mode) {
  if (!state.portfolioNoteDraft) return;
  state.portfolioNoteDraft.mode = mode;
  render();
}

async function addPortfolioNote() {
  if (!state.portfolioActiveProjectId) return;
  const note = await fetchJSON("/api/portfolio/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: state.portfolioActiveProjectId, tab: state.portfolioCategoryFilter, title: "Untitled note", content: "" }),
  });
  await loadPortfolioNotes();
  state.portfolioOpenNoteId = note.id;
  state.portfolioNoteDraft = { ...draftFromPortfolioNote(note), mode: "edit" };
  render();
}

async function savePortfolioNoteDraft() {
  const draft = state.portfolioNoteDraft;
  const id = state.portfolioOpenNoteId;
  if (!draft || !id) return;
  draft.error = null;
  draft.saving = true;
  render();
  try {
    await fetchJSON(`/api/portfolio/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: draft.title.trim() || "Untitled note", content: draft.content }),
    });
    await loadPortfolioNotes();
    draft.dirty = false;
    draft.saving = false;
    render();
  } catch (err) {
    draft.saving = false;
    draft.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function copyPortfolioNoteContent() {
  const draft = state.portfolioNoteDraft;
  if (!draft) return;
  try {
    await navigator.clipboard.writeText(draft.content);
    draft.copied = true;
    render();
    setTimeout(() => {
      if (state.portfolioNoteDraft === draft) {
        draft.copied = false;
        render();
      }
    }, 1500);
  } catch {
    draft.error = "Couldn't copy — your browser blocked clipboard access.";
    render();
  }
}

function deletePortfolioNote(id) {
  openConfirmModal({
    title: "Delete this note?",
    message: "This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeletePortfolioNote(id),
  });
}

async function performDeletePortfolioNote(id) {
  await fetchJSON(`/api/portfolio/notes/${id}`, { method: "DELETE" });
  if (state.portfolioOpenNoteId === id) {
    state.portfolioOpenNoteId = null;
    state.portfolioNoteDraft = null;
  }
  await loadPortfolioNotes();
  render();
}

// ---------- Memory: Browse view ----------
//
// The system's permanent, cross-agent memory. Entries normally come from
// the Memory department's chat (a real agent decides how to structure what
// you tell it — see agents.ts), but can also be added/edited directly here.
// Same drill-down preview/edit pattern as Portfolio notes; the one real
// difference is deletion, which is guarded (type the title to confirm)
// since memory is meant to persist — see openGuardedDeleteModal above.

function draftFromMemoryEntry(entry) {
  return { title: entry.title, content: entry.content, mode: "preview", dirty: false, saving: false, error: null, copied: false };
}

function openMemoryEntry(id) {
  const entry = state.memoryEntries.find((e) => e.id === id);
  if (!entry) return;
  state.memoryOpenEntryId = id;
  state.memoryEntryDraft = draftFromMemoryEntry(entry);
  render();
}

function closeMemoryEntry() {
  state.memoryOpenEntryId = null;
  state.memoryEntryDraft = null;
  render();
}

function setMemoryEntryMode(mode) {
  if (!state.memoryEntryDraft) return;
  state.memoryEntryDraft.mode = mode;
  render();
}

async function addMemoryEntry() {
  const entry = await fetchJSON("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Untitled memory", content: "" }),
  });
  await loadMemoryEntries();
  state.memoryOpenEntryId = entry.id;
  state.memoryEntryDraft = { ...draftFromMemoryEntry(entry), mode: "edit" };
  render();
}

async function saveMemoryEntryDraft() {
  const draft = state.memoryEntryDraft;
  const id = state.memoryOpenEntryId;
  if (!draft || !id) return;
  const title = draft.title.trim();
  if (!title) {
    draft.error = "Title is required.";
    render();
    return;
  }
  draft.error = null;
  draft.saving = true;
  render();
  try {
    await fetchJSON(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: draft.content }),
    });
    await loadMemoryEntries();
    draft.dirty = false;
    draft.saving = false;
    render();
  } catch (err) {
    draft.saving = false;
    draft.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function copyMemoryEntryContent() {
  const draft = state.memoryEntryDraft;
  if (!draft) return;
  try {
    await navigator.clipboard.writeText(draft.content);
    draft.copied = true;
    render();
    setTimeout(() => {
      if (state.memoryEntryDraft === draft) {
        draft.copied = false;
        render();
      }
    }, 1500);
  } catch {
    draft.error = "Couldn't copy — your browser blocked clipboard access.";
    render();
  }
}

function deleteMemoryEntry(id, title) {
  openGuardedDeleteModal({
    title: "Delete this memory entry?",
    message: "This is permanent — every agent that reads memory will lose this fact.",
    requireText: title,
    confirmLabel: "Delete permanently",
    onConfirm: () => performDeleteMemoryEntry(id),
  });
}

async function performDeleteMemoryEntry(id) {
  await fetchJSON(`/api/memory/${id}`, { method: "DELETE" });
  if (state.memoryOpenEntryId === id) {
    state.memoryOpenEntryId = null;
    state.memoryEntryDraft = null;
  }
  await loadMemoryEntries();
  render();
}

function renderMemoryEntryCard(entry) {
  return `
    <div class="memory-entry-card portfolio-note-card" data-open-memory-entry="${entry.id}">
      <div class="portfolio-note-card-body">
        <div class="portfolio-note-card-head">
          <span class="portfolio-note-card-title">${escapeHtml(entry.title || "Untitled memory")}</span>
          ${
            entry.owner === "agent"
              ? `<span class="portfolio-owner-badge agent">Memory chat</span>`
              : `<span class="portfolio-owner-badge manual">Manual</span>`
          }
        </div>
        <p class="portfolio-note-card-preview">${entry.content ? escapeHtml(entry.content.slice(0, 180)) : "Empty entry"}</p>
        <span class="portfolio-note-card-meta">Updated ${formatTimestampShort(entry.updatedAt)}</span>
      </div>
      <button type="button" class="run-action-icon run-action-danger" data-delete-memory-entry="${entry.id}" aria-label="Delete entry"><i data-lucide="trash-2"></i></button>
    </div>
  `;
}

function renderMemoryEntryDetail(entry) {
  const draft = state.memoryEntryDraft;
  if (!draft) return "";
  const mode = draft.mode === "edit" ? "edit" : "preview";
  return `
    <div class="memory-entry-detail portfolio-note-detail">
      <div class="portfolio-note-detail-head">
        <button type="button" class="run-action-icon" id="memory-entry-back" aria-label="Back to memory list"><i data-lucide="arrow-left"></i></button>
        <input type="text" class="portfolio-note-title-input" id="memory-entry-title-input" value="${escapeHtml(draft.title)}" placeholder="Untitled memory" />
        <div class="portfolio-note-detail-actions">
          <div class="segmented-toggle">
            <button type="button" class="segmented-toggle-btn${mode === "preview" ? " active" : ""}" data-memory-entry-mode="preview">Preview</button>
            <button type="button" class="segmented-toggle-btn${mode === "edit" ? " active" : ""}" data-memory-entry-mode="edit">Edit</button>
          </div>
          <button type="button" class="run-action-icon" id="memory-entry-copy" aria-label="Copy content"><i data-lucide="copy"></i></button>
          <button type="button" class="run-action-icon run-action-danger" id="memory-entry-delete" aria-label="Delete entry"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
      <div class="portfolio-note-meta">
        Updated ${formatTimestampShort(entry.updatedAt)}
        ${
          entry.owner === "agent"
            ? `· <span class="portfolio-owner-badge agent">Memory chat</span>`
            : `· <span class="portfolio-owner-badge manual">Manual</span>`
        }
      </div>
      ${
        mode === "edit"
          ? `<textarea class="portfolio-note-editor" id="memory-entry-content-input" placeholder="Write or paste the fact to remember…" data-lenis-prevent>${escapeHtml(draft.content)}</textarea>`
          : draft.content
            ? `<div class="portfolio-note-preview msg-text" data-lenis-prevent>${renderMarkdown(draft.content)}</div>`
            : `<div class="empty-state"><p>Empty — click Edit to write or paste something.</p></div>`
      }
      <div class="portfolio-note-detail-footer">
        ${draft.error ? `<p class="attachment-error">${escapeHtml(draft.error)}</p>` : ""}
        ${draft.copied ? `<span class="portfolio-note-copied">Copied ✓</span>` : ""}
        <button type="button" class="confirm-btn confirm-btn-primary" id="memory-entry-save" ${!draft.dirty || draft.saving ? "disabled" : ""}>${draft.saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  `;
}

// ---------- Memory: hero (the department chat itself) ----------
//
// Memory is a "department" view like Sales/HR, but replaces the standard
// composer+run-history sidebar entirely (see isFullWidthView) with a
// full-page hero: a big ripple-pulsing brain, animated status text that
// tracks the underlying run's real lifecycle (typing -> submitted -> the
// run's actual "running"/"success"/"error" status from the SSE stream,
// not a fake timer), and a big pill input. Submission still goes through
// the exact same submitGoal()/selectRun() path any department chat uses —
// only the chrome around it is bespoke.

function renderMemoryHero() {
  const status = memoryHeroStatus();
  const statusText = MEMORY_HERO_STATUS_TEXT[status];
  const confirmation = status === "done" || status === "error" ? memoryHeroConfirmation() : "";
  const busy = status === "analysing";

  return `
    <div class="memory-hero">
      <div class="memory-hero-topbar">
        <button type="button" class="run-action-icon" id="memory-hero-browse" aria-label="Browse memory"><i data-lucide="database"></i></button>
      </div>
      <div class="memory-hero-center">
        <div class="memory-hero-icon-wrap${busy ? " busy" : ""}">
          <div
            class="memory-hero-orb"
            id="memory-hero-orb"
            data-status="${status}"
            aria-hidden="true"
          ></div>
        </div>
        <h1 class="memory-hero-status-text" data-status="${status}">${escapeHtml(statusText)}</h1>
        ${confirmation ? `<p class="memory-hero-confirmation">${escapeHtml(confirmation)}</p>` : ""}
      </div>
      <div class="memory-hero-composer">
        <form id="memory-hero-form">
          <div class="memory-hero-input-shell">
            <textarea id="memory-hero-input" placeholder="Say me something&#10;to keep in mind" rows="1" ${state.memoryHeroSubmitting ? "disabled" : ""}>${escapeHtml(state.memoryHeroInput)}</textarea>
            <div class="memory-hero-actions">
              <button type="button" class="attach-circle" id="attach-btn" ${state.attaching ? "disabled" : ""} aria-label="Attach file">
                ${state.attaching ? `<i data-lucide="loader-circle"></i>` : `<i data-lucide="plus"></i>`}
              </button>
              <input type="file" id="attach-input" accept="${ATTACH_ACCEPT}" multiple hidden />
              <button type="submit" class="memory-feed-btn" id="memory-hero-submit" ${state.memoryHeroSubmitting || state.attaching || !state.memoryHeroInput.trim() ? "disabled" : ""}>
                ${state.memoryHeroSubmitting ? "Feeding…" : state.attaching ? "Attaching…" : "Feed Me"}
              </button>
            </div>
          </div>
          ${renderAttachmentRow()}
          ${state.memoryHeroError ? `<div class="attachment-row"><span class="attachment-error">${escapeHtml(state.memoryHeroError)}</span></div>` : ""}
        </form>
      </div>
    </div>
  `;
}

function renderMemoryBrowseView() {
  const openEntry = state.memoryEntries.find((e) => e.id === state.memoryOpenEntryId);
  return `
    <div class="portfolio-view">
      <div class="section-head">
        <button type="button" class="run-action-icon" id="memory-back-to-chat" aria-label="Back to Memory chat"><i data-lucide="arrow-left"></i></button>
        <h2>Memory</h2>
        <span class="section-count">${state.memoryEntries.length} ${state.memoryEntries.length === 1 ? "entry" : "entries"}</span>
        ${!openEntry ? `<button type="button" class="ai-button" id="memory-add-entry"><i data-lucide="plus"></i> Add manually</button>` : ""}
      </div>
      ${
        openEntry
          ? renderMemoryEntryDetail(openEntry)
          : state.memoryEntries.length
            ? `<div class="portfolio-notes-list">${state.memoryEntries.map(renderMemoryEntryCard).join("")}</div>`
            : `<div class="empty-state"><p>Nothing in memory yet — feed it something from the Memory chat, or add an entry manually. It's saved as-is and stays until you deliberately delete it.</p></div>`
      }
    </div>
  `;
}

function openAddPortfolioProjectModal() {
  state.portfolioProjectModal = { mode: "add", id: null, name: "", submitting: false, error: null };
  render();
}

function openRenamePortfolioProjectModal(project) {
  state.portfolioProjectModal = { mode: "rename", id: project.id, name: project.name, submitting: false, error: null };
  render();
}

function closePortfolioProjectModal() {
  state.portfolioProjectModal = null;
  render();
}

async function savePortfolioProjectModal() {
  const form = document.getElementById("portfolio-project-form");
  const m = state.portfolioProjectModal;
  if (!form || !m) return;
  const name = form.name.value.trim();
  if (!name) {
    m.error = "Name is required.";
    render();
    return;
  }
  m.error = null;
  m.submitting = true;
  render();
  try {
    if (m.mode === "rename") {
      await fetchJSON(`/api/portfolio/projects/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } else {
      const project = await fetchJSON("/api/portfolio/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      state.portfolioActiveProjectId = project.id;
    }
    await loadPortfolioProjects();
    state.portfolioProjectModal = null;
    render();
  } catch (err) {
    m.submitting = false;
    m.error = err instanceof Error ? err.message : String(err);
    render();
  }
}

function deletePortfolioProject(id) {
  openConfirmModal({
    title: "Delete this project?",
    message: "All of its portfolio entries (blogs, articles, collabs, PR posts, emails) will be permanently removed. This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
    onConfirm: () => performDeletePortfolioProject(id),
  });
}

async function performDeletePortfolioProject(id) {
  await fetchJSON(`/api/portfolio/projects/${id}`, { method: "DELETE" });
  if (state.portfolioActiveProjectId === id) state.portfolioActiveProjectId = null;
  state.portfolioProjectModal = null;
  await loadPortfolioProjects();
  render();
}

function renderPortfolioProjectTabs() {
  return `
    <div class="section-tabs">
      ${state.portfolioProjects
        .map(
          (p) =>
            `<button type="button" class="section-tab${p.id === state.portfolioActiveProjectId ? " active" : ""}" data-portfolio-project="${p.id}">${escapeHtml(p.name)}</button>`,
        )
        .join("")}
    </div>
  `;
}

function renderPortfolioCategoryTabs() {
  return `
    <div class="section-tabs">
      ${PORTFOLIO_TABS.map(
        (c) =>
          `<button type="button" class="section-tab${c === state.portfolioCategoryFilter ? " active" : ""}" data-portfolio-category="${c}">${PORTFOLIO_TAB_LABELS[c]}</button>`,
      ).join("")}
    </div>
  `;
}

function renderPortfolioEntryRow(entry, isEmailTab) {
  return `
    <tr class="portfolio-row" data-open-portfolio-entry="${entry.id}">
      <td>${
        entry.link
          ? `<a href="${escapeHtml(entry.link)}" target="_blank" rel="noopener noreferrer" class="portfolio-link">${escapeHtml(entry.title)} ↗</a>`
          : escapeHtml(entry.title)
      }</td>
      ${
        isEmailTab
          ? `
      <td class="portfolio-text-cell">${entry.subject ? escapeHtml(entry.subject) : "—"}</td>
      <td class="portfolio-text-cell">${entry.recipient ? escapeHtml(entry.recipient) : "—"}</td>
      <td class="portfolio-text-cell">${entry.messageId ? escapeHtml(entry.messageId) : "—"}</td>
      `
          : ""
      }
      <td><span class="portfolio-status-badge portfolio-status-${entry.status}">${PORTFOLIO_STATUS_LABELS[entry.status]}</span></td>
      <td class="portfolio-date-cell">${entry.date ?? "—"}</td>
      <td class="portfolio-text-cell">${entry.notes ? escapeHtml(entry.notes) : "—"}</td>
      <td>${
        entry.owner === "agent"
          ? `<span class="portfolio-owner-badge agent">${escapeHtml(entry.agentKey ?? "agent")}</span>`
          : `<span class="portfolio-owner-badge manual">Manual</span>`
      }</td>
      <td class="playbook-row-actions">
        <button type="button" class="run-action-icon" data-open-portfolio-entry="${entry.id}" aria-label="Edit"><i data-lucide="pencil"></i></button>
        <button type="button" class="run-action-icon run-action-danger" data-delete-portfolio-entry="${entry.id}" aria-label="Delete"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>
  `;
}

function renderPortfolioView() {
  const project = state.portfolioProjects.find((p) => p.id === state.portfolioActiveProjectId);
  const isNoteTab = PORTFOLIO_NOTE_TABS.includes(state.portfolioCategoryFilter);
  const isEmailTab = state.portfolioCategoryFilter === "email";
  const entries = isNoteTab ? [] : state.portfolioEntries.filter((e) => e.category === state.portfolioCategoryFilter);
  const notes = isNoteTab ? state.portfolioNotes.filter((n) => n.tab === state.portfolioCategoryFilter) : [];
  const categoryLabel = PORTFOLIO_TAB_LABELS[state.portfolioCategoryFilter].toLowerCase();
  const openNote = isNoteTab ? notes.find((n) => n.id === state.portfolioOpenNoteId) : null;

  return `
    <div class="portfolio-view">
      <div class="section-head">
        <h2>Portfolio</h2>
        <span class="section-count">${state.portfolioProjects.length} project${state.portfolioProjects.length === 1 ? "" : "s"}</span>
        <button type="button" class="ai-button" id="portfolio-add-project"><i data-lucide="plus"></i> Add project</button>
      </div>
      ${
        !state.portfolioProjects.length
          ? `<div class="empty-state"><p>No projects yet — add one to start tracking blogs, articles, collabs, PR posts, emails, project details, and database entries against it.</p></div>`
          : `
        <div class="portfolio-toolbar">
          ${renderPortfolioProjectTabs()}
          ${project ? `<button type="button" class="run-action-icon" id="portfolio-edit-project" aria-label="Rename or delete project"><i data-lucide="pencil"></i></button>` : ""}
        </div>
        <div class="portfolio-toolbar">
          ${renderPortfolioCategoryTabs()}
          ${
            !openNote
              ? `
            <div class="portfolio-toolbar-actions">
              <span class="section-count">${isNoteTab ? notes.length : entries.length} ${categoryLabel}</span>
              ${!isNoteTab ? `<button type="button" class="ai-button ai-button-secondary" id="portfolio-export-csv" ${entries.length ? "" : "disabled"}><i data-lucide="download"></i> Export CSV</button>` : ""}
              <button type="button" class="ai-button" id="${isNoteTab ? "portfolio-add-note" : "portfolio-add-entry"}"><i data-lucide="plus"></i> ${isNoteTab ? "Add note" : "Add entry"}</button>
            </div>
          `
              : ""
          }
        </div>
        ${
          isNoteTab
            ? openNote
              ? renderPortfolioNoteDetail(openNote)
              : renderPortfolioNotesList(notes, categoryLabel)
            : entries.length
              ? `
          <div class="portfolio-table-wrap" data-lenis-prevent>
            <table class="portfolio-table">
              <thead>
                <tr>
                  <th>Title</th>
                  ${isEmailTab ? `<th>Subject</th><th>Recipient</th><th>Message ID</th>` : ""}
                  <th>Status</th>
                  <th>Date</th>
                  <th>Notes</th>
                  <th>Owner</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${entries.map((entry) => renderPortfolioEntryRow(entry, isEmailTab)).join("")}</tbody>
            </table>
          </div>`
              : `<div class="empty-state"><p>No ${categoryLabel} logged for this project yet.</p></div>`
        }
      `
      }
    </div>
    ${renderPortfolioEntryModal()}
    ${renderPortfolioProjectModal()}
  `;
}

function renderPortfolioNotesList(notes, categoryLabel) {
  if (!notes.length) {
    return `<div class="empty-state"><p>No ${categoryLabel} yet — add one and paste in markdown text. It's saved as-is, plain and copyable, and stays until you delete it.</p></div>`;
  }
  return `
    <div class="portfolio-notes-list">
      ${notes
        .map(
          (note) => `
        <div class="portfolio-note-card" data-open-portfolio-note="${note.id}">
          <div class="portfolio-note-card-body">
            <div class="portfolio-note-card-head">
              <span class="portfolio-note-card-title">${escapeHtml(note.title || "Untitled note")}</span>
              ${
                note.owner === "agent"
                  ? `<span class="portfolio-owner-badge agent">${escapeHtml(note.agentKey ?? "agent")}</span>`
                  : `<span class="portfolio-owner-badge manual">Manual</span>`
              }
            </div>
            <p class="portfolio-note-card-preview">${note.content ? escapeHtml(note.content.slice(0, 180)) : "Empty note"}</p>
            <span class="portfolio-note-card-meta">Updated ${formatTimestampShort(note.updatedAt)}</span>
          </div>
          <button type="button" class="run-action-icon run-action-danger" data-delete-portfolio-note="${note.id}" aria-label="Delete note"><i data-lucide="trash-2"></i></button>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function formatTimestampShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderPortfolioNoteDetail(note) {
  const draft = state.portfolioNoteDraft;
  if (!draft) return "";
  const mode = draft.mode === "edit" ? "edit" : "preview";
  return `
    <div class="portfolio-note-detail">
      <div class="portfolio-note-detail-head">
        <button type="button" class="run-action-icon" id="portfolio-note-back" aria-label="Back to notes"><i data-lucide="arrow-left"></i></button>
        <input type="text" class="portfolio-note-title-input" id="portfolio-note-title-input" value="${escapeHtml(draft.title)}" placeholder="Untitled note" />
        <div class="portfolio-note-detail-actions">
          <div class="segmented-toggle">
            <button type="button" class="segmented-toggle-btn${mode === "preview" ? " active" : ""}" data-portfolio-note-mode="preview">Preview</button>
            <button type="button" class="segmented-toggle-btn${mode === "edit" ? " active" : ""}" data-portfolio-note-mode="edit">Edit</button>
          </div>
          <button type="button" class="run-action-icon" id="portfolio-note-copy" aria-label="Copy markdown"><i data-lucide="copy"></i></button>
          <button type="button" class="run-action-icon run-action-danger" id="portfolio-note-delete" aria-label="Delete note"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
      <div class="portfolio-note-meta">
        Updated ${formatTimestampShort(note.updatedAt)}
        ${
          note.owner === "agent"
            ? `· <span class="portfolio-owner-badge agent">${escapeHtml(note.agentKey ?? "agent")}</span>`
            : `· <span class="portfolio-owner-badge manual">Manual</span>`
        }
      </div>
      ${
        mode === "edit"
          ? `<textarea class="portfolio-note-editor" id="portfolio-note-content-input" placeholder="Write or paste markdown here…" data-lenis-prevent>${escapeHtml(draft.content)}</textarea>`
          : draft.content
            ? `<div class="portfolio-note-preview msg-text" data-lenis-prevent>${renderMarkdown(draft.content)}</div>`
            : `<div class="empty-state"><p>Empty — click Edit to write or paste markdown.</p></div>`
      }
      <div class="portfolio-note-detail-footer">
        ${draft.error ? `<p class="attachment-error">${escapeHtml(draft.error)}</p>` : ""}
        ${draft.copied ? `<span class="portfolio-note-copied">Copied ✓</span>` : ""}
        <button type="button" class="confirm-btn confirm-btn-primary" id="portfolio-note-save" ${!draft.dirty || draft.saving ? "disabled" : ""}>${draft.saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  `;
}

function renderPortfolioEntryModal() {
  const m = state.portfolioEntryModal;
  if (!m) return "";
  const isEdit = Boolean(m.id);
  return `
    <div class="confirm-backdrop" id="portfolio-entry-modal-backdrop">
      <div class="confirm-modal portfolio-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-entry-modal-title" data-lenis-prevent>
        <h3 id="portfolio-entry-modal-title">${isEdit ? "Edit entry" : "Add entry"}</h3>
        <form id="portfolio-entry-form">
          <label class="field-label">Title<input type="text" name="title" value="${escapeHtml(m.title)}" placeholder="e.g. Q3 product launch post" required /></label>
          <label class="field-label">Link<input type="text" name="link" value="${escapeHtml(m.link)}" placeholder="https://…" /></label>
          <label class="field-label">Category
            <select name="category">${PORTFOLIO_CATEGORIES.map((c) => `<option value="${c}"${c === m.category ? " selected" : ""}>${PORTFOLIO_CATEGORY_LABELS[c]}</option>`).join("")}</select>
          </label>
          <label class="field-label">Status
            <select name="status">${PORTFOLIO_STATUSES.map((s) => `<option value="${s}"${s === m.status ? " selected" : ""}>${PORTFOLIO_STATUS_LABELS[s]}</option>`).join("")}</select>
          </label>
          <label class="field-label">Date<input type="date" name="date" value="${m.date}" /></label>
          <label class="field-label">Subject<input type="text" name="subject" value="${escapeHtml(m.subject)}" placeholder="Only relevant for Emails" /></label>
          <label class="field-label">Recipient<input type="text" name="recipient" value="${escapeHtml(m.recipient)}" placeholder="name@example.com — only relevant for Emails" /></label>
          <label class="field-label">Message ID<input type="text" name="messageId" value="${escapeHtml(m.messageId)}" placeholder="Gmail message id — only relevant for Emails" /></label>
          <label class="field-label">Notes<textarea name="notes" rows="3">${escapeHtml(m.notes)}</textarea></label>
          ${m.error ? `<p class="attachment-error">${escapeHtml(m.error)}</p>` : ""}
          <div class="confirm-modal-actions">
            ${isEdit ? `<button type="button" class="confirm-btn confirm-btn-danger" id="portfolio-entry-modal-delete">Delete</button>` : ""}
            <button type="button" class="confirm-btn confirm-btn-cancel" id="portfolio-entry-modal-cancel">Cancel</button>
            <button type="submit" class="confirm-btn confirm-btn-primary" ${m.submitting ? "disabled" : ""}>${m.submitting ? "Saving…" : isEdit ? "Save changes" : "Add entry"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderPortfolioProjectModal() {
  const m = state.portfolioProjectModal;
  if (!m) return "";
  const isRename = m.mode === "rename";
  return `
    <div class="confirm-backdrop" id="portfolio-project-modal-backdrop">
      <div class="confirm-modal portfolio-modal" role="dialog" aria-modal="true" aria-labelledby="portfolio-project-modal-title" data-lenis-prevent>
        <h3 id="portfolio-project-modal-title">${isRename ? "Rename project" : "Add project"}</h3>
        <form id="portfolio-project-form">
          <label class="field-label">Name<input type="text" name="name" value="${escapeHtml(m.name)}" placeholder="e.g. Acme Launchpad" required /></label>
          ${m.error ? `<p class="attachment-error">${escapeHtml(m.error)}</p>` : ""}
          <div class="confirm-modal-actions">
            ${isRename ? `<button type="button" class="confirm-btn confirm-btn-danger" id="portfolio-project-modal-delete">Delete</button>` : ""}
            <button type="button" class="confirm-btn confirm-btn-cancel" id="portfolio-project-modal-cancel">Cancel</button>
            <button type="submit" class="confirm-btn confirm-btn-primary" ${m.submitting ? "disabled" : ""}>${m.submitting ? "Saving…" : isRename ? "Save changes" : "Add project"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// ---------- Event delegation ----------

function attachHandlers() {
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(JSON.parse(btn.dataset.nav)));
  });

  document.getElementById("sidebar-toggle")?.addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-backdrop")?.addEventListener("click", closeSidebar);
  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  document.getElementById("logout-btn")?.addEventListener("click", logout);

  document.querySelectorAll(".run-item").forEach((li) => {
    li.addEventListener("click", () => selectRun(li.dataset.runId));
  });

  document.getElementById("toggle-archived-btn")?.addEventListener("click", () => toggleArchivedFilter());

  // Action icons live inside .run-item (sidebar list) or .run-header
  // (detail page) — stopPropagation so clicking one doesn't also trigger
  // the parent .run-item's click-to-select handler above.
  document.querySelectorAll("[data-pin-run]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pinRun(btn.dataset.pinRun);
    });
  });
  document.querySelectorAll("[data-unpin-run]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      unpinRun(btn.dataset.unpinRun);
    });
  });
  document.querySelectorAll("[data-archive-run]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      archiveRun(btn.dataset.archiveRun);
    });
  });
  document.querySelectorAll("[data-unarchive-run]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      unarchiveRun(btn.dataset.unarchiveRun);
    });
  });
  document.querySelectorAll("[data-delete-run]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteRun(btn.dataset.deleteRun);
    });
  });
  document.getElementById("run-goal-toggle")?.addEventListener("click", () => {
    state.goalExpanded = !state.goalExpanded;
    render();
  });

  if (state.confirmModal) {
    document.getElementById("confirm-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "confirm-backdrop") closeConfirmModal();
    });
    document.getElementById("confirm-modal-cancel")?.addEventListener("click", () => closeConfirmModal());
    document.getElementById("confirm-modal-confirm")?.addEventListener("click", () => {
      const onConfirm = state.confirmModal?.onConfirm;
      closeConfirmModal();
      onConfirm?.();
    });
  }

  if (state.guardedDeleteModal) {
    document.getElementById("guarded-delete-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "guarded-delete-backdrop") closeGuardedDeleteModal();
    });
    document.getElementById("guarded-delete-cancel")?.addEventListener("click", () => closeGuardedDeleteModal());
    document.getElementById("guarded-delete-input")?.addEventListener("input", (e) => {
      state.guardedDeleteModal.inputValue = e.target.value;
      render();
    });
    document.getElementById("guarded-delete-confirm")?.addEventListener("click", () => {
      const onConfirm = state.guardedDeleteModal?.onConfirm;
      closeGuardedDeleteModal();
      onConfirm?.();
    });
  }

  document.querySelectorAll(".doc-item").forEach((li) => {
    li.addEventListener("click", () => openDocument(li.dataset.docId));
  });

  document.querySelectorAll(".bento-detail-item[data-run-id]").forEach((li) => {
    li.addEventListener("click", () => selectRun(li.dataset.runId));
  });

  document.querySelectorAll(".bento-detail-item[data-doc-id]").forEach((li) => {
    li.addEventListener("click", () => openDocument(li.dataset.docId));
  });

  document.querySelectorAll(".disconnect-btn").forEach((btn) => {
    btn.addEventListener("click", () => disconnectAccount(btn.dataset.accountKey));
  });

  // No preventDefault — the link's target="_blank" navigation still needs to
  // fire so main.cjs's setWindowOpenHandler can route it to the OS browser.
  document.querySelectorAll("[data-connect-key]").forEach((link) => {
    link.addEventListener("click", () => startAccountConnectPoll(link.dataset.connectKey));
  });

  document.getElementById("settings-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await saveSettings(form);
    } finally {
      btn.disabled = false;
    }
  });

  // --- Files ---

  document.querySelectorAll(".files-row[data-files-path]").forEach((row) => {
    row.addEventListener("click", () => {
      const path = row.dataset.filesPath;
      const parentPath = path.split("/").slice(0, -1).join("/");
      const entry = (state.filesChildren.get(parentPath) ?? []).find((c) => c.path === path);
      if (entry) selectFilesEntry(entry);
    });
  });

  const filesUploadInput = document.getElementById("files-upload-input");
  document.getElementById("files-upload-btn")?.addEventListener("click", () => filesUploadInput?.click());
  filesUploadInput?.addEventListener("change", () => {
    if (filesUploadInput.files?.length) uploadFilesToTarget(filesUploadInput.files);
    filesUploadInput.value = "";
  });
  document.getElementById("files-new-folder-btn")?.addEventListener("click", () => {
    const target = state.filesUploadTarget || state.filesSelectedPath;
    if (target) openNewFolderModal(target);
  });
  document.getElementById("files-delete-btn")?.addEventListener("click", (e) => {
    const path = e.currentTarget.dataset.filesDeletePath;
    if (path) deleteFilesEntry(path);
  });

  if (state.folderModal) {
    document.getElementById("folder-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "folder-modal-backdrop") closeFolderModal();
    });
    document.getElementById("folder-modal-cancel")?.addEventListener("click", () => closeFolderModal());
    document.getElementById("folder-modal-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      submitNewFolder();
    });
  }

  // --- Calendar ---

  document.getElementById("mini-cal-prev")?.addEventListener("click", () => shiftCalendarMonth(-1));
  document.getElementById("mini-cal-next")?.addEventListener("click", () => shiftCalendarMonth(1));
  document.getElementById("calendar-today")?.addEventListener("click", () => goToToday());
  document.getElementById("calendar-prev")?.addEventListener("click", () => shiftCalendarMonth(-1));
  document.getElementById("calendar-next")?.addEventListener("click", () => shiftCalendarMonth(1));
  document.getElementById("calendar-range-toggle")?.addEventListener("click", () => toggleCalendarRangeMode());
  document.getElementById("calendar-clear-selection")?.addEventListener("click", () => clearCalendarSelection());
  document.getElementById("calendar-add")?.addEventListener("click", () => openScheduleModal(state.calendarSelectedDate, state.calendarSelectedDate));
  document.getElementById("detail-add-schedule")?.addEventListener("click", () => openScheduleModal(state.calendarSelectedDate, state.calendarSelectedDate));

  document.querySelectorAll("[data-calendar-status]").forEach((btn) => {
    btn.addEventListener("click", () => setCalendarStatusFilter(btn.dataset.calendarStatus));
  });

  document.querySelectorAll(".calendar-cell[data-date], .mini-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", () => selectCalendarDate(cell.dataset.date));
  });

  document.querySelectorAll("[data-toggle-schedule]").forEach((btn) => {
    btn.addEventListener("click", () => toggleSchedule(btn.dataset.toggleSchedule, btn.dataset.enabled !== "true"));
  });

  document.querySelectorAll("[data-delete-schedule]").forEach((btn) => {
    btn.addEventListener("click", () => deleteSchedule(btn.dataset.deleteSchedule));
  });

  document.querySelectorAll("[data-edit-schedule]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const schedule = state.schedules.find((s) => s.id === btn.dataset.editSchedule);
      if (schedule) openEditScheduleModal(schedule);
    });
  });

  if (state.scheduleModal) {
    document.getElementById("schedule-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "schedule-modal-backdrop") closeScheduleModal();
    });
    document.getElementById("schedule-modal-cancel")?.addEventListener("click", () => closeScheduleModal());
    document.getElementById("schedule-modal-delete")?.addEventListener("click", () => deleteSchedule(state.scheduleModal.id));
    document.getElementById("schedule-recurrence-type")?.addEventListener("change", (e) => {
      changeScheduleRecurrenceType(e.target.value);
    });
    document.getElementById("schedule-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      submitScheduleModal();
    });
  }

  // --- CRM ---

  document.querySelectorAll("[data-lead-filter]").forEach((btn) => {
    btn.addEventListener("click", () => setLeadStageFilter(btn.dataset.leadFilter));
  });

  document.querySelectorAll("[data-crm-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setCrmTab(btn.dataset.crmTab));
  });

  document.getElementById("crm-add-lead")?.addEventListener("click", () => openLeadModal());

  document.getElementById("crm-search")?.addEventListener("input", (e) => {
    state.leadSearch = e.target.value;
    render();
  });

  document.getElementById("crm-source-filter")?.addEventListener("change", (e) => {
    state.leadFilters.source = e.target.value;
    render();
  });

  document.getElementById("crm-followup-filter")?.addEventListener("change", (e) => {
    state.leadFilters.followUp = e.target.value;
    render();
  });

  document.getElementById("crm-export-btn")?.addEventListener("click", () => exportLeadsCSV());
  document.getElementById("crm-import-btn")?.addEventListener("click", () => openLeadImportPicker());
  document.getElementById("lead-import-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) handleLeadImportFile(file);
  });

  document.querySelectorAll("[data-sort-lead]").forEach((th) => {
    th.addEventListener("click", () => setLeadSort(th.dataset.sortLead));
  });

  document.querySelectorAll("[data-delete-lead-row]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteLead(btn.dataset.deleteLeadRow);
    });
  });

  document.querySelectorAll("[data-open-lead]").forEach((el) => {
    el.addEventListener("click", () => {
      const lead = state.leads.find((l) => l.id === el.dataset.openLead);
      if (lead) openEditLeadModal(lead);
    });
  });

  document.querySelectorAll("[data-quick-stage]").forEach((select) => {
    select.addEventListener("click", (e) => e.stopPropagation());
    select.addEventListener("change", () => quickSetLeadStage(select.dataset.quickStage, select.value));
  });

  if (state.leadImportModal) {
    document.getElementById("lead-import-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "lead-import-backdrop") closeLeadImportModal();
    });
    document.getElementById("lead-import-cancel")?.addEventListener("click", () => closeLeadImportModal());
    document.getElementById("lead-import-done")?.addEventListener("click", () => closeLeadImportModal());
    document.getElementById("lead-import-confirm")?.addEventListener("click", () => confirmLeadImport());
  }

  if (state.leadModal) {
    document.getElementById("lead-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "lead-modal-backdrop") closeLeadModal();
    });
    document.getElementById("lead-modal-cancel")?.addEventListener("click", () => closeLeadModal());
    document.getElementById("lead-modal-delete")?.addEventListener("click", () => deleteLead(state.leadModal.id));
    document.getElementById("lead-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      saveLeadModal();
    });
    document.getElementById("lead-activity-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const note = form.note.value.trim();
      if (!note) return;
      form.note.value = "";
      addLeadActivityNote(state.leadModal.id, note);
    });
  }

  // --- Playbook ---

  document.querySelectorAll("[data-toggle-playbook]").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => togglePlaybookDone(cb.dataset.togglePlaybook, cb.checked));
  });

  document.querySelectorAll("[data-edit-playbook]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.playbookItems.find((i) => i.id === btn.dataset.editPlaybook);
      if (item) openEditPlaybookModal(item);
    });
  });

  document.querySelectorAll("[data-delete-playbook]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deletePlaybookItemUI(btn.dataset.deletePlaybook);
    });
  });

  // --- Content Calendar ---

  document.getElementById("content-calendar-today")?.addEventListener("click", () => goToContentCalendarToday());
  document.getElementById("content-calendar-prev")?.addEventListener("click", () => shiftContentCalendarMonth(-1));
  document.getElementById("content-calendar-next")?.addEventListener("click", () => shiftContentCalendarMonth(1));

  document.querySelectorAll("[data-content-type-filter]").forEach((btn) => {
    btn.addEventListener("click", () => setContentCalendarTypeFilter(btn.dataset.contentTypeFilter));
  });

  document.querySelectorAll(".calendar-cell[data-content-date]").forEach((cell) => {
    cell.addEventListener("click", () => selectContentCalendarDate(cell.dataset.contentDate));
  });

  document.querySelectorAll("[data-open-content-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = (state.contentCalendarItems ?? []).find((i) => i.id === btn.dataset.openContentItem);
      if (item) openEditPlaybookModal(item);
    });
  });

  if (state.playbookModal) {
    document.getElementById("playbook-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "playbook-modal-backdrop") closePlaybookModal();
    });
    document.getElementById("playbook-modal-cancel")?.addEventListener("click", () => closePlaybookModal());
    document.getElementById("playbook-modal-delete")?.addEventListener("click", () => deletePlaybookItemUI(state.playbookModal.id));
    document.getElementById("playbook-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      savePlaybookModal();
    });
  }

  // --- Portfolio ---

  document.querySelectorAll("[data-portfolio-project]").forEach((btn) => {
    btn.addEventListener("click", () => setPortfolioActiveProject(btn.dataset.portfolioProject));
  });

  document.querySelectorAll("[data-portfolio-category]").forEach((btn) => {
    btn.addEventListener("click", () => setPortfolioCategoryFilter(btn.dataset.portfolioCategory));
  });

  document.getElementById("portfolio-add-project")?.addEventListener("click", () => openAddPortfolioProjectModal());
  document.getElementById("portfolio-add-entry")?.addEventListener("click", () => openPortfolioEntryModal());
  document.getElementById("portfolio-export-csv")?.addEventListener("click", () => exportPortfolioEntriesCSV());
  document.getElementById("portfolio-edit-project")?.addEventListener("click", () => {
    const project = state.portfolioProjects.find((p) => p.id === state.portfolioActiveProjectId);
    if (project) openRenamePortfolioProjectModal(project);
  });

  document.querySelectorAll("[data-delete-portfolio-entry]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deletePortfolioEntry(btn.dataset.deletePortfolioEntry);
    });
  });

  document.querySelectorAll("[data-open-portfolio-entry]").forEach((el) => {
    el.addEventListener("click", () => {
      const entry = state.portfolioEntries.find((e) => e.id === el.dataset.openPortfolioEntry);
      if (entry) openEditPortfolioEntryModal(entry);
    });
  });

  if (state.portfolioEntryModal) {
    document.getElementById("portfolio-entry-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "portfolio-entry-modal-backdrop") closePortfolioEntryModal();
    });
    document.getElementById("portfolio-entry-modal-cancel")?.addEventListener("click", () => closePortfolioEntryModal());
    document.getElementById("portfolio-entry-modal-delete")?.addEventListener("click", () => deletePortfolioEntry(state.portfolioEntryModal.id));
    document.getElementById("portfolio-entry-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      savePortfolioEntryModal();
    });
  }

  if (state.portfolioProjectModal) {
    document.getElementById("portfolio-project-modal-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "portfolio-project-modal-backdrop") closePortfolioProjectModal();
    });
    document.getElementById("portfolio-project-modal-cancel")?.addEventListener("click", () => closePortfolioProjectModal());
    document.getElementById("portfolio-project-modal-delete")?.addEventListener("click", () => deletePortfolioProject(state.portfolioProjectModal.id));
    document.getElementById("portfolio-project-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      savePortfolioProjectModal();
    });
  }

  // --- Portfolio notes (project-details/database tabs) ---

  document.getElementById("portfolio-add-note")?.addEventListener("click", () => addPortfolioNote());

  document.querySelectorAll("[data-open-portfolio-note]").forEach((el) => {
    el.addEventListener("click", () => openPortfolioNote(el.dataset.openPortfolioNote));
  });

  document.querySelectorAll("[data-delete-portfolio-note]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deletePortfolioNote(btn.dataset.deletePortfolioNote);
    });
  });

  if (state.portfolioNoteDraft) {
    document.getElementById("portfolio-note-back")?.addEventListener("click", () => closePortfolioNote());
    document.getElementById("portfolio-note-copy")?.addEventListener("click", () => copyPortfolioNoteContent());
    document.getElementById("portfolio-note-delete")?.addEventListener("click", () => deletePortfolioNote(state.portfolioOpenNoteId));
    document.getElementById("portfolio-note-save")?.addEventListener("click", () => savePortfolioNoteDraft());

    document.querySelectorAll("[data-portfolio-note-mode]").forEach((btn) => {
      btn.addEventListener("click", () => setPortfolioNoteMode(btn.dataset.portfolioNoteMode));
    });

    // Update the draft directly on each keystroke instead of calling render() —
    // a full re-render would tear down and rebuild the input/textarea,
    // dropping focus and cursor position mid-type.
    const titleInput = document.getElementById("portfolio-note-title-input");
    titleInput?.addEventListener("input", () => {
      state.portfolioNoteDraft.title = titleInput.value;
      state.portfolioNoteDraft.dirty = true;
      document.getElementById("portfolio-note-save")?.removeAttribute("disabled");
    });

    const contentInput = document.getElementById("portfolio-note-content-input");
    contentInput?.addEventListener("input", () => {
      state.portfolioNoteDraft.content = contentInput.value;
      state.portfolioNoteDraft.dirty = true;
      document.getElementById("portfolio-note-save")?.removeAttribute("disabled");
    });
  }

  // --- Memory ---

  document.getElementById("memory-hero-browse")?.addEventListener("click", () => switchView({ type: "memory-browse" }));
  document.getElementById("memory-back-to-chat")?.addEventListener("click", () => switchView({ type: "department", key: "memory" }));

  const heroInput = document.getElementById("memory-hero-input");
  heroInput?.addEventListener("input", () => {
    state.memoryHeroInput = heroInput.value;
    syncMemoryHeroInputUi();
  });
  heroInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("memory-hero-form")?.requestSubmit();
    }
  });

  document.getElementById("memory-hero-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = state.memoryHeroInput.trim();
    if (!text || state.memoryHeroSubmitting) return;
    state.memoryHeroSubmitting = true;
    state.memoryHeroError = null;
    render();
    try {
      await submitGoal(text);
      // Only clear the typed text once the run is actually created — on
      // failure (e.g. the request was too large) the user keeps what they
      // wrote instead of it silently vanishing.
      state.memoryHeroInput = "";
    } catch (err) {
      state.memoryHeroError = err instanceof Error ? err.message : String(err);
    } finally {
      state.memoryHeroSubmitting = false;
      render();
    }
  });
  document.getElementById("memory-add-entry")?.addEventListener("click", () => addMemoryEntry());

  document.querySelectorAll("[data-open-memory-entry]").forEach((el) => {
    el.addEventListener("click", () => openMemoryEntry(el.dataset.openMemoryEntry));
  });

  document.querySelectorAll("[data-delete-memory-entry]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteMemoryEntry;
      const entry = state.memoryEntries.find((m) => m.id === id);
      deleteMemoryEntry(id, entry?.title ?? "");
    });
  });

  if (state.memoryEntryDraft) {
    document.getElementById("memory-entry-back")?.addEventListener("click", () => closeMemoryEntry());
    document.getElementById("memory-entry-copy")?.addEventListener("click", () => copyMemoryEntryContent());
    document.getElementById("memory-entry-delete")?.addEventListener("click", () => {
      const entry = state.memoryEntries.find((m) => m.id === state.memoryOpenEntryId);
      deleteMemoryEntry(state.memoryOpenEntryId, entry?.title ?? "");
    });
    document.getElementById("memory-entry-save")?.addEventListener("click", () => saveMemoryEntryDraft());

    document.querySelectorAll("[data-memory-entry-mode]").forEach((btn) => {
      btn.addEventListener("click", () => setMemoryEntryMode(btn.dataset.memoryEntryMode));
    });

    const memoryTitleInput = document.getElementById("memory-entry-title-input");
    memoryTitleInput?.addEventListener("input", () => {
      state.memoryEntryDraft.title = memoryTitleInput.value;
      state.memoryEntryDraft.dirty = true;
      document.getElementById("memory-entry-save")?.removeAttribute("disabled");
    });

    const memoryContentInput = document.getElementById("memory-entry-content-input");
    memoryContentInput?.addEventListener("input", () => {
      state.memoryEntryDraft.content = memoryContentInput.value;
      state.memoryEntryDraft.dirty = true;
      document.getElementById("memory-entry-save")?.removeAttribute("disabled");
    });
  }

  const form = document.getElementById("goal-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("goal-input");
      const goal = input.value.trim();
      if (!goal) return;
      const btn = document.getElementById("submit-btn");
      const errRow = document.getElementById("goal-submit-error-row");
      const errEl = document.getElementById("goal-submit-error");
      btn.disabled = true;
      if (errRow) errRow.hidden = true;
      try {
        await submitGoal(goal);
        // submitGoal's own render() (via selectRun) replaces this whole form,
        // so no manual reset needed on success. Clear the saved draft too, or
        // it'd reappear next time this view's composer is rendered.
        delete state.goalDrafts[goalDraftKey(state.view)];
      } catch (err) {
        // Deliberately no render() here — #goal-input isn't state-controlled,
        // so a full re-render would wipe whatever the user just typed. Update
        // the error slot directly instead.
        if (errEl && errRow) {
          errEl.textContent = err instanceof Error ? err.message : String(err);
          errRow.hidden = false;
        }
        btn.disabled = false;
      }
    });
    const goalInputEl = document.getElementById("goal-input");
    goalInputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    // Mirror every keystroke into state so a later full render() — e.g. from
    // switchView() when the user hops to another tab and back — restores
    // whatever was typed instead of starting the textarea blank.
    goalInputEl?.addEventListener("input", () => {
      state.goalDrafts[goalDraftKey(state.view)] = goalInputEl.value;
      // Flips the department hero's bot face to "watching" while there's a
      // draft, directly via the DOM — deliberately not a render() (see the
      // comment above on why #goal-input isn't state-controlled).
      const heroBot = document.querySelector("#dept-hero .bot-face");
      if (heroBot) heroBot.dataset.mood = goalInputEl.value.trim() ? "watching" : "idle";
    });
  }

  document.getElementById("attach-btn")?.addEventListener("click", () => {
    document.getElementById("attach-input")?.click();
  });

  document.getElementById("attach-input")?.addEventListener("change", (e) => {
    uploadAttachments(e.target.files);
    e.target.value = ""; // lets picking the exact same file(s) again re-fire change
  });

  document.querySelectorAll("[data-remove-attachment]").forEach((btn) => {
    btn.addEventListener("click", () => removeAttachment(Number(btn.dataset.removeAttachment)));
  });

  const replyForm = document.getElementById("reply-form");
  if (replyForm) {
    replyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("reply-input");
      const message = input.value.trim();
      if (!message) return;
      const id = state.selectedRunId;
      const btn = document.getElementById("reply-submit-btn");
      btn.disabled = true;
      try {
        await sendReply(id, message);
      } finally {
        btn.disabled = false;
      }
    });
    document.getElementById("reply-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        replyForm.requestSubmit();
      }
    });
  }
}

async function openDocument(id) {
  const doc = await fetchJSON(`/api/documents/${id}`);
  const win = window.open("", "_blank");
  win.document.write(
    `<title>${escapeHtml(doc.title)}</title><pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;padding:24px;max-width:800px;margin:0 auto;">${escapeHtml(doc.content)}</pre>`,
  );
}

// ---------- Nav tooltip ----------
//
// Delegated on `document` (not inside #app) so it survives every render()
// wiping and rebuilding the DOM — attaching this inside attachHandlers()
// would mean re-binding it on every single render for no benefit, since
// nothing here depends on the current view state.
//
// Drives every button[aria-label] tooltip app-wide (a per-button CSS ::after
// used to handle the non-.nav-icon cases, but it only ever opened upward —
// see the removed-rule comment in style.css — which clipped or hid the
// tooltip for anything near the top of the window or a scrolling panel:
// header icons, Archive/Delete/Edit in the task list, "Add lead", etc.
// Routing everything through this single position:fixed element sidesteps
// that entirely, same as it already did for .nav-icon.
const TOOLTIP_TRIGGER_SELECTOR = "button[aria-label]";

function initNavTooltip() {
  const hoverCapable = window.matchMedia?.("(hover: hover)").matches;
  if (!hoverCapable) return; // touch devices: no hover, nothing to wire up

  const tooltip = () => document.getElementById("nav-tooltip");

  document.addEventListener("mouseover", (e) => {
    const trigger = e.target.closest?.(TOOLTIP_TRIGGER_SELECTOR);
    const el = tooltip();
    if (!trigger || !el) return;
    const label = trigger.dataset.label ?? trigger.getAttribute("aria-label");
    if (!label) return;
    if (trigger.contains(e.relatedTarget)) return;
    const rect = trigger.getBoundingClientRect();
    // Right-of-icon placement is only for the vertical icon rail; every
    // other trigger (run-action buttons scattered inline in lists) always
    // gets bottom placement regardless of screen width.
    const railPlacement = trigger.classList.contains("nav-icon") && window.matchMedia?.("(min-width: 720px)").matches;
    el.textContent = label;
    el.dataset.placement = railPlacement ? "right" : "bottom";
    el.style.left = `${railPlacement ? rect.right + 12 : rect.left + rect.width / 2}px`;
    el.style.top = `${railPlacement ? rect.top + rect.height / 2 : rect.bottom + 10}px`;
    el.classList.add("visible");
  });

  document.addEventListener("mouseout", (e) => {
    const trigger = e.target.closest?.(TOOLTIP_TRIGGER_SELECTOR);
    if (!trigger || trigger.contains(e.relatedTarget)) return;
    tooltip()?.classList.remove("visible");
  });
}

// ---------- Model picker ----------
//
// The popover is a true DOM portal — one persistent element created once
// and appended directly to <body>, entirely outside #app — rather than part
// of the render()-generated markup. #app's .composer ancestor has
// `overflow: hidden` for its rounded-corner card look, which hard-clips any
// normal (even `position: fixed`) descendant the moment a further-out
// ancestor turns out to establish its own containing block; appending to
// <body> sidesteps that whole class of issue instead of fighting it via
// z-index/positioning tricks. Only the trigger button lives in the normal
// render tree (so it redraws with the rest of .goal-actions); the portal's
// own content is (re)written imperatively and is untouched by render().
let modelPickerPortal = null;

function ensureModelPickerPortal() {
  if (modelPickerPortal) return modelPickerPortal;
  const el = document.createElement("div");
  el.className = "model-picker-menu";
  el.id = "model-picker-menu";
  el.setAttribute("role", "menu");
  el.style.display = "none";
  document.body.appendChild(el);
  modelPickerPortal = el;
  return el;
}

function renderModelPickerPortalContent() {
  const el = ensureModelPickerPortal();
  el.innerHTML = MODEL_OPTIONS.map(
    (opt) => `
      <button type="button" class="model-picker-item${state.selectedModel === opt.value ? " selected" : ""}" data-model-value="${opt.value}" role="menuitemradio" aria-checked="${state.selectedModel === opt.value}">
        <i data-lucide="check" class="model-picker-check"></i>
        <span class="model-picker-item-text">
          <span>${escapeHtml(opt.label)}</span>
          ${opt.description ? `<span class="model-picker-item-desc">${escapeHtml(opt.description)}</span>` : ""}
        </span>
      </button>
    `,
  ).join("");
  if (window.lucide) window.lucide.createIcons();
}

// Anchors to the trigger button's actual screen position (getBoundingClientRect
// is always viewport-relative, matching this element's `position: fixed`),
// same approach as initNavTooltip()'s tooltip. Opens upward from the
// button's right edge, clamped so it never runs off the viewport.
function positionModelPickerMenu() {
  const btn = document.getElementById("model-picker-btn");
  const menu = modelPickerPortal;
  if (!btn || !menu) return;
  const btnRect = btn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(btnRect.right - menuRect.width, window.innerWidth - menuRect.width - 8));
  const top = Math.max(8, btnRect.top - menuRect.height - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openModelPicker() {
  state.modelPickerOpen = true;
  renderModelPickerPortalContent();
  const el = ensureModelPickerPortal();
  el.style.display = "flex";
  positionModelPickerMenu();
  render(); // updates the trigger button's "open" styling/aria-expanded
}

function closeModelPicker() {
  state.modelPickerOpen = false;
  if (modelPickerPortal) modelPickerPortal.style.display = "none";
  render();
}

function initModelPicker() {
  document.addEventListener("click", (e) => {
    const item = e.target.closest?.(".model-picker-item");
    if (item) {
      state.selectedModel = item.dataset.modelValue;
      closeModelPicker();
      return;
    }
    const toggleBtn = e.target.closest?.("#model-picker-btn");
    if (toggleBtn) {
      if (state.modelPickerOpen) closeModelPicker();
      else openModelPicker();
      return;
    }
    if (state.modelPickerOpen && !e.target.closest?.("#model-picker-menu") && !e.target.closest?.("#model-picker-btn")) {
      closeModelPicker();
    }
  });

  // Keep the menu anchored to the button across viewport/layout changes
  // while it's open (e.g. resizing the window, or the composer moving
  // between .sidebar and .main at the mobile breakpoint).
  window.addEventListener("resize", () => {
    if (state.modelPickerOpen) positionModelPickerMenu();
  });
}

// ---------- Log interactions ----------
//
// Delegated on `document`, same reasoning as initNavTooltip: .log and its
// tool-cards are recreated on every render(), so binding here once avoids
// rebinding on every SSE event for no benefit.
function initLogInteractions() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-toggle-tool]");
    if (!btn) return;
    const card = btn.closest(".tool-card");
    if (!card) return;
    const nowOpen = !card.classList.contains("open");
    state.toolOverrides.set(btn.dataset.toggleTool, nowOpen);
    card.classList.toggle("open", nowOpen);
  });

  // scroll doesn't bubble in every engine — capture phase catches it
  // regardless, without needing a listener on the (recreated) .log itself.
  document.addEventListener(
    "scroll",
    (e) => {
      const log = e.target.closest?.(".log");
      if (log) updateJumpButton(log);
    },
    true,
  );
}

// ---------- Header popovers (Playbook menu / Account menu) ----------
//
// Both popovers were CSS-only (:hover/:focus-within), which never opens on
// touch — there's no hover on a phone, and tapping a <button> doesn't put
// it in the tap-focus chain on iOS Safari. Same delegated-on-document,
// bound-once pattern as initModelPicker: a `.open` class (added alongside
// the existing :hover/:focus-within CSS rules, not replacing them) drives
// visibility, toggled on tap and dismissed on an outside click so desktop
// hover behavior is completely unaffected.
function initHeaderPopovers() {
  document.addEventListener("click", (e) => {
    const playbookBtn = e.target.closest?.("#playbook-menu-btn");
    if (playbookBtn) {
      e.stopPropagation();
      document.querySelector(".header-account")?.classList.remove("open");
      playbookBtn.closest(".playbook-menu")?.classList.toggle("open");
      return;
    }
    const accountBtn = e.target.closest?.("#account-menu-btn");
    if (accountBtn) {
      e.stopPropagation();
      document.querySelector(".playbook-menu")?.classList.remove("open");
      accountBtn.closest(".header-account")?.classList.toggle("open");
      return;
    }
    if (!e.target.closest?.(".playbook-menu-popover")) {
      document.querySelector(".playbook-menu")?.classList.remove("open");
    }
    if (!e.target.closest?.(".account-popover")) {
      document.querySelector(".header-account")?.classList.remove("open");
    }
  });
}

// ---------- Kanban wheel scroll ----------
//
// .kanban-board hides its native scrollbar (matches every other scroll
// container in this app), so a plain vertical mouse wheel is the only
// scroll input most desktop/Windows users will try — trackpad horizontal
// swipe and Shift+wheel already work natively without this. Redirect a
// vertical wheel gesture into horizontal scroll only when the gesture is
// actually vertical (deltaX ~0) and there's something to scroll, so
// trackpad/Shift gestures still pass through untouched.
function initKanbanWheelScroll() {
  document.addEventListener(
    "wheel",
    (e) => {
      const board = e.target.closest?.(".kanban-board");
      if (!board) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (board.scrollWidth <= board.clientWidth) return;
      e.preventDefault();
      board.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
}

// ---------- Init ----------

async function init() {
  initTheme();
  initNavTooltip();
  initModelPicker();
  initLogInteractions();
  initHeaderPopovers();
  initKanbanWheelScroll();
  initResponsiveLayout();
  render();
  await loadAuthConfig();
  await handleAuthRedirect();
  await loadCurrentUser();
  if (state.auth.user && state.auth.mode !== "reset") {
    await loadAppData();
  }
  render();
}

init();
