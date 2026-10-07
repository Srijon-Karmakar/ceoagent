"use strict";

// CeoAgent — preview dashboard. A separate, self-contained page (own HTML/
// CSS/JS under /preview) that reuses the SAME authenticated /api/* endpoints
// the main app already exposes — no new backend routes, no change to the
// main app's own files. Session auth is the existing cookie (Path=/, set by
// the main app's login flow), so this page only works once you've already
// signed in there in the same browser.

const NAV_ITEMS = [
  { key: "home", label: "Home", icon: "home" },
  { key: "chat", label: "Chat", icon: "message-circle" },
  { key: "agents", label: "Agents", icon: "users" },
  { key: "tasks", label: "Tasks", icon: "list-checks" },
  { key: "crm", label: "CRM", icon: "handshake" },
  { key: "playbook", label: "Playbook", icon: "calendar-days" },
  { key: "portfolio", label: "Portfolio", icon: "folder-open" },
  { key: "scheduler", label: "Calendar", icon: "calendar" },
  { key: "knowledge", label: "Knowledge", icon: "brain" },
  { key: "documents", label: "Documents", icon: "file-text" },
  { key: "files", label: "Files", icon: "folder" },
  { key: "accounts", label: "Accounts", icon: "plug-zap" },
  { key: "tools", label: "Tools", icon: "wrench" },
  { key: "analytics", label: "Analytics", icon: "chart-column" },
  { key: "settings", label: "Settings", icon: "settings" },
];

// Pages whose data is fetched lazily the first time you navigate to them
// (not up front with the dashboard's loadAll()) — each entry's loader is
// called once by switchView() and re-callable by a page's own refresh
// actions. Defined here; each module (crm.js, playbook.js, ...) populates
// its own loader into this map at script-load time.
const LAZY_LOADERS = {};

// Mirrors PROVIDER_ORDER/PROVIDER_LABELS in src/providers/llmFallback.ts —
// same small local literal the main app.js keeps, since this page has no
// build-time import of the backend provider module either.
const MODEL_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "openai", label: "OpenAI" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "ollama", label: "Ollama (local)" },
];

// The six cards that radiate off the home page's orbit visual. Order
// matters — it drives both the clockwise layout (orbit-pos-1..6 in
// style.css) and the dotted connector drawn to each card.
const QUICK_ACTIONS = [
  {
    key: "plan",
    label: "Plan",
    icon: "clipboard-list",
    bg: "color-mix(in srgb, var(--accent) 16%, transparent)",
    fg: "var(--accent)",
    desc: "Turn ideas into clear plans",
    prompt: "Help me turn this goal into a concrete, step-by-step plan: ",
  },
  {
    key: "research",
    label: "Research",
    icon: "search",
    bg: "color-mix(in srgb, #0891b2 16%, transparent)",
    fg: "#0891b2",
    desc: "Get deep insights",
    prompt: "Research the following and summarize key findings: ",
  },
  {
    key: "execute",
    label: "Execute",
    icon: "zap",
    bg: "color-mix(in srgb, var(--warning) 20%, transparent)",
    fg: "var(--warning)",
    desc: "Break it down & do it",
    prompt: "Get this done end-to-end: ",
  },
  {
    key: "analyze",
    label: "Analyze",
    icon: "bar-chart-3",
    bg: "color-mix(in srgb, #7c4a21 16%, transparent)",
    fg: "#7c4a21",
    desc: "Find what works",
    prompt: "Analyze the following and tell me what's working: ",
  },
  {
    key: "improve",
    label: "Improve",
    icon: "trending-up",
    bg: "color-mix(in srgb, var(--success) 18%, transparent)",
    fg: "var(--success)",
    desc: "Get smarter over time",
    prompt: "Review this and suggest how to improve it: ",
  },
  {
    key: "grow",
    label: "Grow",
    icon: "users",
    bg: "color-mix(in srgb, #e87ba4 20%, transparent)",
    fg: "#e87ba4",
    desc: "Find opportunities",
    prompt: "Find growth opportunities for: ",
  },
];

// Shortcut chips under the composer — each just pre-fills a starting prompt.
const SUGGESTION_CHIPS = [
  { key: "roadmap", label: "Create a product roadmap", icon: "map", prompt: "Create a product roadmap for: " },
  { key: "business-idea", label: "Analyze my business idea", icon: "bar-chart-3", prompt: "Analyze this business idea: " },
  { key: "prd", label: "Write a PRD", icon: "file-text", prompt: "Write a PRD for: " },
  { key: "marketing", label: "Plan a marketing strategy", icon: "megaphone", prompt: "Plan a marketing strategy for: " },
];

// Bottom-row "Quick Tools" grid — a mix of nav shortcuts and composer
// pre-fills, same two patterns QUICK_ACTIONS and SUGGESTION_CHIPS already use.
const QUICK_TOOLS = [
  { key: "new-project", label: "New Project", icon: "folder-plus", nav: "portfolio" },
  { key: "new-task", label: "New Task", icon: "list-plus", nav: "tasks" },
  { key: "brainstorm", label: "Brainstorm", icon: "lightbulb", prompt: "Help me brainstorm ideas for: " },
  { key: "summarize", label: "Summarize", icon: "file-text", prompt: "Summarize the following: " },
];

const NOTIF_SEEN_KEY = "ceoagent_preview_notif_last_seen";
const THEME_KEY = "theme"; // same key the main app uses, so theme choice is shared across both pages
const POLL_MS = 10000;

// Orbit cards that map cleanly onto one real department, routed direct to
// that department (bypassing CEO delegation). Execute/Improve stay routed
// through the CEO (POST /api/runs) since neither maps onto a single
// department without guessing.
const QUICK_ACTION_TARGETS = { plan: "manager", research: "analysis", analyze: "analysis", grow: "sales" };

const state = {
  theme: "light",
  view: "home",
  sidebarOpen: false,
  sidebarCollapsed: false,
  loading: true,
  loadError: null,
  tenant: null,
  departments: [],
  runs: [],
  documents: [],
  memory: [],
  analytics: null,
  externalAnalytics: { data: null, loaded: false, loading: false, error: null },
  externalDashboard: { expanded: false, range: "7d", metric: "visitors", data: null, loading: false, error: null, trendTableView: false },
  composerDraft: "", // kept in state (not just the textarea's own DOM value) since render() also fires on the 10s background poll, which would otherwise wipe an in-progress draft on every refresh
  composerProvider: "auto",
  composerTargetAgent: null, // set by a quick-action card; routes submitGoal to that department directly
  composerAttachments: [], // [{filename, text, truncated, path?}]
  composerUploading: false,
  composerBusy: false,
  composerError: null,
  searchQuery: "",
  searchFocused: false,
  notifsOpen: false,
  notifLastSeen: Number(localStorage.getItem(NOTIF_SEEN_KEY) || 0),
  rightBarOpen: true, // collapses the right activity bar to an icon rail
  userMenuOpen: false, // the Settings/Log out popover off the sidebar's account row

  // Chat / run-detail view
  openRunId: null,
  openRun: null,
  openRunLoading: false,
  openRunError: null,
  replyBusy: false,
  chatReplyDraft: "",
  cancelBusy: false,
  toolOpen: new Set(), // toolUseId -> expanded, mirrors the main app's per-card collapse state

  // Settings
  settingsFields: null, // MaskedField[] once loaded
  settingsLoading: false,
  settingsError: null,
  settingsEdits: {}, // envVar -> new value typed, only dirty fields
  settingsSaving: false,
  settingsSavedAt: null,

  // Generic modal overlay (lead editor, playbook editor, schedule editor,
  // confirm-delete, CSV import preview, etc.) — one at a time, holds a
  // renderer function (not static HTML) so it reflects live state across
  // every render() call the same way the rest of the page does.
  modal: null,
};

// Rendering registries each feature module (crm.js, playbook.js, ...)
// pushes itself into at script-load time, so app.js doesn't need a
// hardcoded branch added for every new page — see renderView()/
// attachHandlers()/switchView() below.
const VIEW_RENDERERS = {}; // viewKey -> () => htmlString
const VIEW_ATTACHERS = []; // array of () => void, called after every render()

// Not part of `state` on purpose — an EventSource instance isn't
// serializable/renderable data, just a live connection this page owns.
let runEventSource = null;

// ---------- data ----------

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) throw new Error("Not signed in — sign in from the main app first, in this same browser.");
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function loadAll(silent) {
  if (!silent) {
    state.loading = true;
    render();
  }
  try {
    const [tenant, departments, runs, documents, memory, analytics] = await Promise.all([
      fetchJSON("/api/auth/me"),
      fetchJSON("/api/departments"),
      fetchJSON("/api/runs"),
      fetchJSON("/api/documents"),
      fetchJSON("/api/memory"),
      fetchJSON("/api/analytics"),
    ]);
    state.tenant = tenant;
    state.departments = departments;
    state.runs = runs;
    state.documents = documents;
    state.memory = memory;
    state.analytics = analytics;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Not signed in")) {
      state.tenant = { name: "Founder", email: "founder@example.com" };
      state.loadError = null;
    } else {
      state.loadError = msg;
    }
  }
  state.loading = false;
  render();
}

// ---------- helpers ----------

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function truncate(str, n) {
  const s = str || "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function deptMeta(key) {
  return state.departments.find((d) => d.key === key);
}

function deptColor(key) {
  const meta = deptMeta(key);
  return meta ? meta.color[state.theme] : "var(--accent)";
}

function deptLabel(key) {
  if (key === "ceo") return "CEO";
  return deptMeta(key)?.label ?? key;
}

function formatClockTime(d) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function formatRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function greetingPeriod() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function firstName() {
  const name = state.tenant?.name || state.tenant?.email || "there";
  return name.split(" ")[0].split("@")[0];
}

function activeRuns() {
  return state.runs.filter((r) => !r.archived);
}

// Agent text is markdown; DOMPurify sanitizes before it touches the DOM.
// Falls back to escaped plain text if either vendor script failed to load.
function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    return window.DOMPurify.sanitize(window.marked.parse(text, { breaks: true }));
  }
  return escapeHtml(text).replace(/\n/g, "<br />");
}

function formatCost(usd) {
  return usd != null ? `$${usd.toFixed(4)}` : "";
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ---------- shared: confirm-delete modal ----------

// Mirrors production's guarded-delete UX (type the item's name to enable
// the confirm button) when `requireText` is given; a plain confirm/cancel
// otherwise. `onConfirm` is only ever called once the typed text matches.
function openConfirmModal({ title, message, confirmLabel = "Delete", danger = true, requireText, onConfirm }) {
  let typed = "";
  const renderer = () => `
    <div class="modal-head"><h2>${escapeHtml(title)}</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body">
      <p>${escapeHtml(message)}</p>
      ${
        requireText
          ? `<p class="modal-confirm-hint">Type <strong>${escapeHtml(requireText)}</strong> to confirm.</p>
             <input type="text" id="modal-confirm-input" autocomplete="off" value="${escapeHtml(typed)}" />`
          : ""
      }
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="${danger ? "btn-danger" : "btn-primary"}" id="modal-confirm-btn" ${requireText && typed !== requireText ? "disabled" : ""}>${escapeHtml(confirmLabel)}</button>
    </div>
  `;
  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-confirm-input")?.addEventListener("input", (e) => {
      typed = e.target.value;
      const cursor = e.target.selectionStart;
      openModal(renderer);
      const el = document.getElementById("modal-confirm-input");
      if (el) {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      }
    });
    document.getElementById("modal-confirm-btn")?.addEventListener("click", () => {
      if (requireText && typed !== requireText) return;
      closeModal();
      onConfirm();
    });
  };
  openModal(renderer);
}

// ---------- shared: CSV ----------

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCSV(columns, rows) {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => csvEscape(c.get(row))).join(",")).join("\n");
  return `${header}\n${body}`;
}

function downloadText(filename, text, mime = "text/csv") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Hand-rolled RFC4180 parser (quoted fields, embedded commas/newlines, ""
// escaping) — mirrors production's client-side CSV import, since there's no
// server-side bulk-import endpoint for CRM/Portfolio to call instead.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
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
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

// ---------- theme ----------

function initTheme() {
  const urlTheme = new URLSearchParams(window.location.search).get("theme");
  const saved = urlTheme || localStorage.getItem(THEME_KEY);
  state.theme = saved === "light" || saved === "dark" ? saved : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, state.theme);
  document.documentElement.setAttribute("data-theme", state.theme);
  render();
}

// This page has no login screen of its own — it only works once you've
// already signed in from the main app, in this same browser (shared
// session cookie). So logging out here just clears that cookie, then sends
// you back to the main app's root, where its real login screen lives.
async function logout() {
  await fetchJSON("/api/auth/logout", { method: "POST" }).catch(() => null);
  window.location.href = "/";
}

// ---------- icons ----------

function icon(name) {
  return `<i data-lucide="${escapeHtml(name)}"></i>`;
}

// ---------- render: shell ----------

function render() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="shell">
      <div class="sidebar-backdrop${state.sidebarOpen ? " open" : ""}" id="sidebar-backdrop"></div>
      ${renderSidebar()}
      <div class="main">
        ${renderTopbar()}
        <div class="content${state.view === "home" ? " content-home" : ""}">${renderView()}</div>
      </div>
      ${renderRightBar()}
    </div>
    <div class="toast" id="toast"></div>
    ${state.modal ? renderModalOverlay() : ""}
  `;
  attachHandlers();
  if (window.lucide) window.lucide.createIcons();
  syncLaserFlow();
}

// ---------- laser flow (Home only) ----------
//
// A WebGL shader effect (see laser-flow.js) used as a wide aura behind the
// Home tab. It lives outside #app so normal re-renders do not recreate the
// WebGL context; syncLaserFlow() only resizes/recolors that persistent layer.
let laserFlowEl = null;
let laserFlowHandle = null;

function ensureLaserFlowEl() {
  if (laserFlowEl) return laserFlowEl;
  laserFlowEl = document.createElement("div");
  laserFlowEl.className = "laser-flow-overlay";
  laserFlowEl.setAttribute("aria-hidden", "true");
  document.body.insertBefore(laserFlowEl, document.body.firstChild);
  return laserFlowEl;
}

function laserFlowAccent() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#6d5bf6";
}

function destroyLaserFlow() {
  if (laserFlowHandle) {
    laserFlowHandle.destroy();
    laserFlowHandle = null;
  }
}

function syncLaserFlow() {
  const el = ensureLaserFlowEl();
  if (state.view !== "home") {
    el.style.display = "none";
    if (laserFlowHandle?.pause) laserFlowHandle.pause();
    return;
  }
  el.style.display = "block";
  if (!laserFlowHandle && window.LaserFlow?.mount) {
    laserFlowHandle = window.LaserFlow.mount(el, { theme: state.theme });
  } else if (laserFlowHandle) {
    if (laserFlowHandle.resume) laserFlowHandle.resume();
    laserFlowHandle.setTheme?.(state.theme);
    laserFlowHandle.syncSphere?.();
  }
}
window.addEventListener("laserflow:ready", () => {
  if (state.view === "home") syncLaserFlow();
});
window.addEventListener("resize", () => {
  if (state.view === "home") {
    syncLaserFlow();
    laserFlowHandle?.syncSphere?.();
  }
});

function renderSidebar() {
  const orgName = state.tenant?.organizationName || "Your organization";
  const initial = (state.tenant?.name || state.tenant?.email || "?").slice(0, 1).toUpperCase();
  const collapsed = !!state.sidebarCollapsed;
  return `
    <aside class="sidebar${state.sidebarOpen ? " open" : ""}${collapsed ? " collapsed" : ""}" id="sidebar">
      <div class="sidebar-brand">
        <button type="button" class="sidebar-brand-mark" id="sidebar-brand-mark" aria-label="${collapsed ? "Expand sidebar" : "CEO Agent"}" title="${collapsed ? "Expand sidebar" : "CEO Agent"}">
          ${icon("box")}
        </button>
        <span class="sidebar-brand-text">
          <div class="sidebar-brand-title">CEO Agent</div>
          <div class="sidebar-brand-sub">${escapeHtml(orgName)}</div>
        </span>
        <button type="button" class="sidebar-collapse-btn" id="sidebar-collapse-toggle" aria-label="${collapsed ? "Expand sidebar" : "Collapse sidebar"}" title="${collapsed ? "Expand sidebar" : "Collapse sidebar"}">
          ${icon(collapsed ? "chevrons-right" : "chevrons-left")}
        </button>
      </div>
      <nav class="sidebar-nav">
        ${NAV_ITEMS.map(
          (item) => `
          <button type="button" class="sidebar-nav-link${state.view === item.key ? " active" : ""}" data-nav="${item.key}" title="${escapeHtml(item.label)}">
            ${icon(item.icon)}<span>${item.label}</span>
          </button>
        `,
        ).join("")}
      </nav>
      ${!collapsed ? renderSidebarToolsCard() : ""}
      ${!collapsed ? renderSidebarStatusCard() : ""}
      <div class="sidebar-user">
        <span class="sidebar-user-avatar">${escapeHtml(initial)}</span>
        <span class="sidebar-user-text">
          <div class="sidebar-user-name">${escapeHtml(state.tenant?.name || state.tenant?.email || "Signed in")}</div>
          <div class="sidebar-user-sub">${escapeHtml(state.tenant?.email || "")}</div>
        </span>
        <button type="button" class="sidebar-user-menu" id="sidebar-user-menu-btn" aria-label="Account menu">${icon("more-vertical")}</button>
        ${state.userMenuOpen ? renderUserMenu() : ""}
      </div>
    </aside>
  `;
}

function renderUserMenu() {
  return `
    <div class="user-menu-popover" id="user-menu-popover">
      <button type="button" class="user-menu-item" data-nav="settings">${icon("settings")}<span>Settings</span></button>
      <button type="button" class="user-menu-item danger" id="logout-btn">${icon("log-out")}<span>Log out</span></button>
    </div>
  `;
}

// Live agent-activity status, replacing the old sidebar "Upgrade to Pro"
// promo — real data (which departments are running right now) is more
// useful real estate than an upsell for a CEO who's trying to see at a
// glance whether anything is in flight.
function renderSidebarStatusCard() {
  const running = runningAgentKeys();
  const total = state.departments.length;
  return `
    <button type="button" class="sidebar-status-card" data-nav="agents">
      <div class="sidebar-status-head">
        <span class="sidebar-status-title">Agents</span>
        <span class="sidebar-status-badge${running.size ? " live" : ""}">${running.size} active</span>
      </div>
      <div class="sidebar-status-dots">
        ${state.departments
          .map((d) => `<span class="sidebar-status-dot${running.has(d.key) ? " running" : ""}" style="background:${d.color[state.theme]}" title="${escapeHtml(d.label)}"></span>`)
          .join("")}
      </div>
      <p class="sidebar-status-foot">${total - running.size} idle · ${total} total</p>
    </button>
  `;
}

function searchResults() {
  const q = state.searchQuery.trim().toLowerCase();
  if (!q) return null;
  const runs = activeRuns()
    .filter((r) => r.goal.toLowerCase().includes(q))
    .slice(0, 6);
  const docs = state.documents.filter((d) => d.title.toLowerCase().includes(q)).slice(0, 6);
  return { runs, docs };
}

function renderTopbar() {
  const results = state.searchFocused ? searchResults() : null;
  const unseenNotifs = notificationItems().filter((n) => n.ts > state.notifLastSeen);
  const initial = (state.tenant?.name || state.tenant?.email || "?").slice(0, 1).toUpperCase();

  return `
    <header class="topbar">
      <button type="button" class="topbar-menu-btn" id="sidebar-toggle" aria-label="Menu">${icon("menu")}</button>
      <div class="topbar-spacer"></div>
      <div class="topbar-pill">
        ${
          state.searchFocused
            ? `<div class="topbar-search open">
                <span class="topbar-search-icon">${icon("search")}</span>
                <input id="topbar-search-input" type="text" placeholder="Search anything…" value="${escapeHtml(state.searchQuery)}" autocomplete="off" />
                <span class="topbar-search-kbd">Esc</span>
                ${state.searchQuery.trim() ? renderSearchResults(results) : ""}
              </div>`
            : `<button type="button" class="topbar-icon-btn" id="topbar-search-toggle" aria-label="Search" title="Search">${icon("search")}</button>`
        }
        <button type="button" class="topbar-icon-btn" id="theme-toggle" aria-label="Toggle theme" title="Toggle theme">
          ${icon(state.theme === "light" ? "sun" : "moon")}
        </button>
        <button type="button" class="topbar-icon-btn" id="notif-toggle" aria-label="Notifications" title="Notifications">
          ${icon("bell")}
          ${unseenNotifs.length ? `<span class="topbar-badge">${unseenNotifs.length > 9 ? "9+" : unseenNotifs.length}</span>` : ""}
        </button>
        ${state.notifsOpen ? renderNotifs() : ""}
        <button type="button" class="topbar-avatar" data-nav="settings" aria-label="Account" title="Account">${escapeHtml(initial)}</button>
      </div>
    </header>
  `;
}

function renderSearchResults(results) {
  if (!results || (!results.runs.length && !results.docs.length)) {
    return `<div class="topbar-results"><div class="topbar-results-empty">No matches for "${escapeHtml(state.searchQuery)}"</div></div>`;
  }
  const runRows = results.runs
    .map(
      (r) => `
      <button type="button" class="topbar-result-item" data-open-run="${r.id}">
        <span class="topbar-result-title">${escapeHtml(truncate(r.goal, 70))}</span>
        <span class="topbar-result-meta">${escapeHtml(deptLabel(r.agentKey))} · ${formatRelativeTime(r.createdAt)}</span>
      </button>
    `,
    )
    .join("");
  const docRows = results.docs
    .map(
      (d) => `
      <button type="button" class="topbar-result-item" data-open-doc="${d.id}">
        <span class="topbar-result-title">${escapeHtml(d.title)}</span>
        <span class="topbar-result-meta">${escapeHtml(deptLabel(d.agentKey))} document</span>
      </button>
    `,
    )
    .join("");
  return `
    <div class="topbar-results">
      ${results.runs.length ? `<div class="topbar-result-group-label">Conversations</div>${runRows}` : ""}
      ${results.docs.length ? `<div class="topbar-result-group-label">Documents</div>${docRows}` : ""}
    </div>
  `;
}

function notificationItems() {
  // Real data, not a mock feed: every run that finished (success or error),
  // most recent first, timestamped by when it actually finished.
  return activeRuns()
    .filter((r) => r.status !== "running" && r.finishedAt)
    .map((r) => ({ id: r.id, status: r.status, goal: r.goal, ts: new Date(r.finishedAt).getTime() }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);
}

function renderNotifs() {
  const items = notificationItems();
  return `
    <div class="topbar-notifs" id="notifs-panel">
      <div class="topbar-notifs-head">
        <span>Notifications</span>
        <button type="button" id="notifs-mark-read">Mark all read</button>
      </div>
      ${
        items.length
          ? items
              .map(
                (n) => `
          <button type="button" class="topbar-notif-item" data-open-run="${n.id}">
            <span class="topbar-notif-dot ${n.status}"></span>
            <span class="topbar-notif-body">
              <div class="topbar-notif-title">${n.status === "success" ? "Finished: " : "Failed: "}${escapeHtml(truncate(n.goal, 60))}</div>
              <div class="topbar-notif-meta">${formatRelativeTime(new Date(n.ts).toISOString())}</div>
            </span>
          </button>
        `,
              )
              .join("")
          : `<div class="topbar-notifs-empty">No finished runs yet.</div>`
      }
    </div>
  `;
}

// ---------- render: right bar ----------
//
// A persistent activity panel (every view, not just Home) — live/running
// tasks, a quick today-tally, and recent activity. Collapses to a narrow
// icon rail rather than disappearing entirely, so the toggle is always in
// the same reachable spot regardless of state (no hidden/escaping-overflow
// tricks needed for the toggle button itself).

function renderRightBar() {
  const running = activeRuns().filter((r) => r.status === "running");
  const today = activeRuns().filter((r) => isToday(r.createdAt));
  const doneToday = today.filter((r) => r.status === "success").length;
  const recent = activeRuns().slice(0, 8);
  const open = state.rightBarOpen;

  return `
    <aside class="right-bar${open ? "" : " collapsed"}">
      ${
        open
          ? `
        <div class="right-bar-inner">
          <div class="right-bar-head">
            <span class="right-bar-title">Live Activity</span>
            <button type="button" class="right-bar-toggle" id="right-bar-toggle" aria-label="Collapse activity panel" title="Collapse activity panel">
              ${icon("panel-right-close")}
            </button>
          </div>

          <div class="right-bar-stats">
            <div class="right-bar-stat">
              <span class="right-bar-stat-value${running.length ? " live" : ""}">${running.length}</span>
              <span class="right-bar-stat-label">Running</span>
            </div>
            <div class="right-bar-stat">
              <span class="right-bar-stat-value">${doneToday}</span>
              <span class="right-bar-stat-label">Done today</span>
            </div>
            <div class="right-bar-stat">
              <span class="right-bar-stat-value">${today.length}</span>
              <span class="right-bar-stat-label">Today</span>
            </div>
          </div>

          <div class="right-bar-section">
            <div class="right-bar-section-title">In Progress</div>
            ${
              running.length
                ? running.map((r) => renderRightBarRow(r)).join("")
                : `<div class="right-bar-empty">Nothing running right now.</div>`
            }
          </div>

          <div class="right-bar-section">
            <div class="right-bar-section-title">Recent Activity</div>
            ${
              recent.length
                ? recent.map((r) => renderRightBarRow(r)).join("")
                : `<div class="right-bar-empty">No activity yet.</div>`
            }
          </div>
        </div>
      `
          : `
        <button type="button" class="right-bar-toggle collapsed-btn" id="right-bar-toggle" aria-label="Expand activity panel" title="Expand activity panel">
          ${icon("panel-right-open")}
          ${running.length ? `<span class="right-bar-toggle-badge">${running.length}</span>` : ""}
        </button>
      `
      }
    </aside>
  `;
}

function renderRightBarRow(r) {
  const color = deptColor(r.agentKey);
  const dotStyle = r.status === "running" ? `background:${color}` : "";
  return `
    <button type="button" class="right-bar-row" data-open-run="${r.id}">
      <span class="right-bar-row-dot ${r.status}" style="${dotStyle}"></span>
      <span class="right-bar-row-body">
        <span class="right-bar-row-title">${escapeHtml(truncate(r.goal, 42))}</span>
        <span class="right-bar-row-meta">${escapeHtml(deptLabel(r.agentKey))} · ${formatRelativeTime(r.createdAt)}</span>
      </span>
    </button>
  `;
}

// ---------- render: views ----------

function renderView() {
  if (state.loading) return `<div class="stub-placeholder">Loading your dashboard…</div>`;
  if (state.loadError) return `<div class="stub-placeholder">Couldn't load data: ${escapeHtml(state.loadError)}</div>`;
  if (state.view === "home") return renderHome();
  if (state.view === "tasks") return renderTasksPage();
  if (state.view === "agents") return renderAgentsPage();
  if (state.view === "documents") return renderDocumentsPage();
  if (state.view === "analytics") return renderAnalyticsPage();
  if (state.view === "chat") return renderChatPage();
  if (state.view === "settings") return renderSettingsPage();
  if (VIEW_RENDERERS[state.view]) return VIEW_RENDERERS[state.view]();
  return "";
}

function renderHome() {
  const period = greetingPeriod();
  return `
    <div class="home-view">
      <div class="home-hero">
        <div class="home-hero-text">
          <div class="home-eyebrow">👋 Good ${period}, ${escapeHtml(firstName())}</div>
          <h1 class="home-greeting">What <strong>should</strong> we <strong>build</strong> today?</h1>
          <p class="home-subtitle">Your AI co-founder to plan, execute and grow your ideas.</p>
        </div>
      </div>

      ${renderOrbit()}

      <div class="composer-wrap">
        ${renderComposer()}
        ${renderSuggestionChips()}
      </div>

      ${renderHomeFocusCard()}
    </div>
  `;
}

// Fills the space left under the composer now that the old four-card
// bottom row is gone — one focused, actionable list (today's runs, as a
// checklist) rather than reviving the whole row, since the right bar
// already covers "recent activity across everything."
function renderHomeFocusCard() {
  const todays = activeRuns()
    .filter((r) => isToday(r.createdAt))
    .slice(0, 8);
  const doneCount = todays.filter((r) => r.status === "success").length;

  return `
    <div class="home-focus-card glass-surface">
      <div class="home-focus-head">
        <span class="home-focus-title">Today's Focus</span>
        ${todays.length ? `<span class="home-focus-count">${doneCount}/${todays.length} done</span>` : ""}
      </div>
      <div class="home-focus-list">
        ${
          todays.length
            ? todays
                .map(
                  (r) => `
          <button type="button" class="home-focus-row" data-open-run="${r.id}">
            <span class="home-focus-check ${r.status}">${r.status === "success" ? icon("check") : ""}</span>
            <span class="home-focus-text">${escapeHtml(truncate(r.goal, 64))}</span>
            <span class="home-focus-time">${new Date(r.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
          </button>
        `,
                )
                .join("")
            : `<div class="home-focus-empty">Nothing run yet today — try the composer above.</div>`
        }
      </div>
    </div>
  `;
}

// The home hero's central 3D metallic bot: a sleek titanium/platinum sphere with
// embedded dark curved OLED visor, glowing neon capsule eyes, autonomous
// looking/blinking, spring bounce jiggle, and real-time cursor tracking.
function renderHomeBotFace() {
  return `
    <div class="metallic-bot-container" id="metallic-bot-slot" aria-label="CEO Agent 3D Metallic Bot"></div>
  `;
}

// Percent-of-container anchor for each QUICK_ACTIONS card, in the same
// order — loosely hexagonal around the center sphere. Also drives the SVG
// connector lines in renderOrbit(), so the dashed line always lands on the
// card it points to even as the layout reflows.
const ORBIT_LAYOUT = [
  { x: 20, y: 20 }, // plan
  { x: 8, y: 50 }, // research
  { x: 20, y: 80 }, // execute
  { x: 80, y: 20 }, // analyze
  { x: 92, y: 50 }, // improve
  { x: 80, y: 80 }, // grow
];

function renderOrbit() {
  const connectors = QUICK_ACTIONS.map((a, i) => {
    const p = ORBIT_LAYOUT[i];
    const dx = p.x * 10;
    const dy = p.y * 10;
    const cx = 500;
    const cy = 500;
    const sx = dx + (cx - dx) * 0.3;
    const sy = dy + (cy - dy) * 0.3;
    const ex = dx + (cx - dx) * 0.64;
    const ey = dy + (cy - dy) * 0.64;
    return `
      <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" class="orbit-connector" />
      <circle cx="${sx}" cy="${sy}" r="9" class="orbit-dot" style="fill:${a.fg}" />
    `;
  }).join("");

  const cards = QUICK_ACTIONS.map(
    (a, i) => `
    <button type="button" class="orbit-card glass-surface" data-quick-action="${a.key}" style="left:${ORBIT_LAYOUT[i].x}%;top:${ORBIT_LAYOUT[i].y}%">
      <span class="orbit-card-icon" style="background:${a.bg};color:${a.fg}">${icon(a.icon)}</span>
      <span class="orbit-card-body">
        <span class="orbit-card-title">${a.label}${icon("arrow-right")}</span>
        <span class="orbit-card-desc">${a.desc}</span>
      </span>
    </button>
  `,
  ).join("");

  return `
    <div class="orbit">
      <div class="orbit-sphere" aria-hidden="true">${renderHomeBotFace()}</div>
      <svg class="orbit-lines" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">${connectors}</svg>
      ${cards}
    </div>
  `;
}

function renderComposer() {
  const target = state.composerTargetAgent ? deptMeta(state.composerTargetAgent) : null;
  const activeModel = MODEL_OPTIONS.find((o) => o.value === state.composerProvider)?.label ?? "Auto";
  return `
    <form id="composer-form" class="composer-form">
      ${
        target
          ? `<div class="composer-target-chip">
              ${icon("corner-down-right")}
              Sending directly to <strong>${escapeHtml(target.label)}</strong>
              <button type="button" id="composer-target-clear" aria-label="Send to CEO instead">${icon("x")}</button>
            </div>`
          : ""
      }
      ${renderAttachmentChips()}
      <div class="composer-laser-glow" aria-hidden="true"></div>
      <div class="composer-pill-shell glass-surface">
        <textarea id="composer-input" class="composer-pill-input" rows="1" placeholder="Ask your CEO Agent anything…" ${state.composerBusy ? "disabled" : ""}>${escapeHtml(state.composerDraft)}</textarea>
        <div class="composer-controls-row">
          <input type="file" id="composer-file-input" multiple hidden />
          <button type="button" class="composer-ctrl-btn" id="composer-attach-btn" title="Attach a file" ${state.composerUploading ? "disabled" : ""}>
            ${state.composerUploading ? icon("loader-circle") : icon("plus")}
          </button>
          <label class="composer-model-trigger" title="Model">
            ${icon("sparkles")}
            <span class="composer-model-label">${escapeHtml(activeModel)}</span>
            <span class="composer-model-chevron">${icon("chevron-down")}</span>
            <select id="composer-provider" aria-label="Model">
              ${MODEL_OPTIONS.map((o) => `<option value="${o.value}"${o.value === state.composerProvider ? " selected" : ""}>${o.label}</option>`).join("")}
            </select>
          </label>
          <button type="button" class="composer-ctrl-btn composer-ctrl-pill" title="Web context (coming soon)" disabled>${icon("globe")}<span>Web</span></button>
          <span class="composer-controls-spacer"></span>
          <button type="button" class="composer-ctrl-btn" title="Voice input (coming soon)" disabled>${icon("mic")}</button>
          <button type="submit" class="composer-send" ${state.composerBusy ? "disabled" : ""} aria-label="Send">
            ${state.composerBusy ? icon("loader-circle") : icon("arrow-up")}
          </button>
        </div>
      </div>
      ${state.composerError ? `<p class="composer-error">${escapeHtml(state.composerError)}</p>` : ""}
    </form>
  `;
}

function renderAttachmentChips() {
  if (!state.composerAttachments.length) return "";
  return `
    <div class="attachment-chip-row">
      ${state.composerAttachments
        .map(
          (a, i) => `
        <span class="attachment-chip">
          ${icon("file-text")}
          <span class="attachment-chip-name">${escapeHtml(a.filename)}</span>
          ${a.truncated ? `<span class="attachment-chip-flag" title="File was truncated to the first 50,000 characters">truncated</span>` : ""}
          <button type="button" data-remove-attachment="${i}" aria-label="Remove ${escapeHtml(a.filename)}">${icon("x")}</button>
        </span>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderSuggestionChips() {
  return `
    <div class="suggestion-chips">
      ${SUGGESTION_CHIPS.map((c) => `<button type="button" class="suggestion-chip" data-suggestion="${c.key}">${icon(c.icon)}${escapeHtml(c.label)}</button>`).join("")}
      <button type="button" class="suggestion-chip suggestion-chip-more" id="suggestion-more">${icon("grid-2x2")}More</button>
    </div>
  `;
}

function runningAgentKeys() {
  return new Set(activeRuns().filter((r) => r.status === "running").map((r) => r.agentKey));
}

// Sidebar card (above the Agents status card) — flat, no shadow, matching
// .sidebar-status-card's own look rather than Home's glass cards.
function renderSidebarToolsCard() {
  return `
    <div class="sidebar-tools-card">
      <div class="sidebar-tools-title">Quick Tools</div>
      <div class="sidebar-tools-grid">
        ${QUICK_TOOLS.map(
          (t) => `
          <button type="button" class="sidebar-tool-btn" ${t.nav ? `data-nav="${t.nav}"` : `data-quick-tool="${t.key}"`}>
            ${icon(t.icon)}
            <span>${t.label}</span>
          </button>
        `,
        ).join("")}
      </div>
    </div>
  `;
}

// ---------- stub / secondary pages ----------

function renderTasksPage() {
  const runs = activeRuns();
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Tasks</h1>
        <p class="stub-subtitle">Every run, most recent first.</p>
      </div>
      ${
        runs.length
          ? runs
              .map(
                (r) => `
          <button type="button" class="stub-list-row" data-open-run="${r.id}" style="width:100%;cursor:pointer">
            <span class="task-check ${r.status}">${r.status === "success" ? icon("check") : ""}</span>
            <span class="stub-list-title">${escapeHtml(r.goal)}</span>
            <span class="stub-list-meta">${escapeHtml(deptLabel(r.agentKey))} · ${formatRelativeTime(r.createdAt)}</span>
          </button>
        `,
              )
              .join("")
          : `<div class="stub-placeholder">No tasks yet — start one from Home.</div>`
      }
    </div>
  `;
}

function renderAgentsPage() {
  const running = runningAgentKeys();
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Agents</h1>
        <p class="stub-subtitle">Every department this organization can delegate to.</p>
      </div>
      ${state.departments
        .map((d) => {
          const isRunning = running.has(d.key);
          return `
          <div class="stub-list-row">
            <span class="agent-dot" style="background:${d.color[state.theme]}"></span>
            <span class="stub-list-title">${escapeHtml(d.label)} — <span style="font-weight:400;color:var(--text-muted)">${escapeHtml(d.tagline)}</span></span>
            <span class="stub-list-meta${isRunning ? "" : ""}" style="color:${isRunning ? "var(--warning)" : "var(--text-muted)"};font-weight:${isRunning ? 700 : 400}">${isRunning ? "Running now" : "Idle"}</span>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

function renderDocumentsPage() {
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Documents</h1>
        <p class="stub-subtitle">Deliverables your agents have produced.</p>
      </div>
      ${
        state.documents.length
          ? state.documents
              .map(
                (d) => `
          <div class="stub-list-row">
            <span class="stub-list-title">${escapeHtml(d.title)}</span>
            <span class="stub-list-meta">${escapeHtml(deptLabel(d.agentKey))} · ${formatRelativeTime(d.createdAt)}</span>
            <a class="stub-list-link" href="/api/documents/${d.id}/download" target="_blank" rel="noopener">Download</a>
          </div>
        `,
              )
              .join("")
          : `<div class="stub-placeholder">No documents yet.</div>`
      }
    </div>
  `;
}

function renderAnalyticsPage() {
  const a = state.analytics;
  if (!a) return `<div class="stub-placeholder">Analytics unavailable.</div>`;
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Analytics</h1>
        <p class="stub-subtitle">Real totals across every run this organization has made.</p>
      </div>
      <div class="stat-tiles">
        <div class="stat-tile"><div class="stat-tile-value">${a.totals.totalRuns}</div><div class="stat-tile-label">Total runs</div></div>
        <div class="stat-tile"><div class="stat-tile-value" style="color:var(--success)">${a.totals.successRuns}</div><div class="stat-tile-label">Succeeded</div></div>
        <div class="stat-tile"><div class="stat-tile-value" style="color:var(--error)">${a.totals.errorRuns}</div><div class="stat-tile-label">Failed</div></div>
        <div class="stat-tile"><div class="stat-tile-value" style="color:var(--warning)">${a.totals.runningRuns}</div><div class="stat-tile-label">Running now</div></div>
        <div class="stat-tile"><div class="stat-tile-value">$${a.totals.totalCostUsd.toFixed(2)}</div><div class="stat-tile-label">Total cost</div></div>
        <div class="stat-tile"><div class="stat-tile-value">${a.totals.totalDocuments}</div><div class="stat-tile-label">Documents</div></div>
      </div>
      <div class="stub-head" style="margin-top:12px">
        <h2 class="stub-title" style="font-size:16px">Runs by department</h2>
      </div>
      ${a.runsByDepartment
        .filter((d) => d.count > 0)
        .sort((x, y) => y.count - x.count)
        .map(
          (d) => `
        <div class="stub-list-row">
          <span class="stub-list-title">${escapeHtml(d.label)}</span>
          <span class="stub-list-meta">${d.count} run${d.count === 1 ? "" : "s"}</span>
        </div>
      `,
        )
        .join("")}
      <div class="stub-head" style="margin-top:12px">
        <h2 class="stub-title" style="font-size:16px">Connected project</h2>
      </div>
      ${renderExternalAnalytics()}
    </div>
  `;
}

function renderExternalAnalytics() {
  const ext = state.externalAnalytics;
  if (ext.loading && !ext.loaded) return `<div class="stub-placeholder">Loading connected project's analytics…</div>`;
  if (ext.error) return `<div class="stub-placeholder">Couldn't load connected project's analytics: ${escapeHtml(ext.error)}</div>`;
  const data = ext.data;
  if (!data || !data.configured) {
    return `
      <div class="stub-placeholder">
        No analytics source connected yet.<br /><br />
        <button type="button" class="btn-secondary" id="analytics-connect-btn">Connect one in Accounts</button>
      </div>
    `;
  }
  if (data.error) return `<div class="stub-placeholder">Connected, but the last fetch failed: ${escapeHtml(data.error)}</div>`;

  if (state.externalDashboard.expanded) return renderExternalDashboard();

  const known = ["login", "signup", "page_view"];
  const top = data.totals.byEventType.slice(0, 6);
  return `
    <button type="button" class="btn-primary" id="external-dashboard-btn" style="margin-bottom:12px">
      ${escapeHtml(data.label || "Connected Project")} analytics ${icon("bar-chart-3")}
    </button>
    <div class="stat-tiles">
      <div class="stat-tile"><div class="stat-tile-value">${data.totals.uniqueVisitors}</div><div class="stat-tile-label">Unique visitors (14d)</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${data.totals.totalEvents}</div><div class="stat-tile-label">Total events (14d)</div></div>
      ${top
        .filter((e) => known.includes(e.eventType))
        .map((e) => `<div class="stat-tile"><div class="stat-tile-value">${e.count}</div><div class="stat-tile-label">${escapeHtml(e.eventType.replace("_", " "))}s</div></div>`)
        .join("")}
    </div>
    ${top
      .filter((e) => !known.includes(e.eventType))
      .map(
        (e) => `
      <div class="stub-list-row">
        <span class="stub-list-title">${escapeHtml(e.eventType)}</span>
        <span class="stub-list-meta">${e.count} event${e.count === 1 ? "" : "s"}</span>
      </div>
    `,
      )
      .join("")}
  `;
}

async function loadExternalAnalytics(force) {
  if (state.externalAnalytics.loaded && !force) return;
  state.externalAnalytics.loading = true;
  render();
  try {
    state.externalAnalytics.data = await fetchJSON("/api/analytics/external");
    state.externalAnalytics.loaded = true;
    state.externalAnalytics.error = null;
  } catch (err) {
    state.externalAnalytics.error = err instanceof Error ? err.message : String(err);
  }
  state.externalAnalytics.loading = false;
  render();
}
LAZY_LOADERS.analytics = () => loadExternalAnalytics(false);

// ---------- Connected-project full dashboard (expanded in-place, same tab) ----------

const EXT_RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

const EXT_METRICS = [
  { key: "visitors", label: "Unique visitors" },
  { key: "pageViews", label: "Page views" },
  { key: "linkVisits", label: "Link visits" },
  { key: "clicks", label: "Clicks" },
  { key: "logins", label: "Logins" },
  { key: "signups", label: "Sign-ups" },
  { key: "listingViews", label: "Listing views" },
  { key: "bookingStarts", label: "Booking attempts" },
];

function formatCompact(n) {
  if (n == null) return "0";
  if (n < 10000) return n.toLocaleString();
  if (n < 1e6) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatChartDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function niceCeil(value) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function deltaBadge(pct) {
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const sign = pct > 0 ? "↑" : pct < 0 ? "↓" : "";
  return `<span class="delta ${dir}">${sign} ${Math.abs(pct)}%</span>`;
}

function buildTrendChart(daily, metricKey) {
  const W = 760, H = 220, padL = 42, padR = 12, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const values = daily.map((d) => d[metricKey] ?? 0);
  const niceMax = niceCeil(Math.max(...values, 1));
  const xStep = plotW / Math.max(values.length - 1, 1);

  const points = values.map((v, i) => ({
    x: padL + i * xStep,
    y: padT + plotH - (v / niceMax) * plotH,
    v,
    date: daily[i].date,
  }));

  const linePath = `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}`;
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const gridFracs = [0, 1 / 3, 2 / 3, 1];
  const gridlines = gridFracs
    .map((f) => {
      const y = padT + plotH * f;
      const val = Math.round(niceMax * (1 - f));
      return `
        <line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1" />
        <text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--text-faint)">${formatCompact(val)}</text>
      `;
    })
    .join("");

  const xLabelIdx = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
  const xLabels = [...new Set(xLabelIdx)]
    .map((i) => `<text x="${points[i].x}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="var(--text-faint)">${escapeHtml(formatChartDate(points[i].date))}</text>`)
    .join("");

  const last = points[points.length - 1];

  return {
    points,
    svg: `
      <svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="Trend chart">
        ${gridlines}
        <path d="${areaPath}" fill="var(--accent)" fill-opacity="0.1" stroke="none" />
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${last.x}" cy="${last.y}" r="4" fill="var(--accent)" stroke="var(--bg-raised)" stroke-width="2" />
        <text x="${Math.min(last.x + 8, W - padR - 24)}" y="${last.y - 8}" font-size="11" font-weight="700" fill="var(--text)">${formatCompact(last.v)}</text>
        ${xLabels}
        <line class="trend-crosshair" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}" stroke="var(--text-faint)" stroke-width="1" opacity="0" />
        <circle class="trend-hoverdot" r="4" fill="var(--accent)" stroke="var(--bg-raised)" stroke-width="2" opacity="0" />
        <rect class="trend-hit" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" />
      </svg>
    `,
  };
}

function attachTrendInteraction(points) {
  const svg = document.querySelector(".trend-svg");
  const hit = document.querySelector(".trend-hit");
  const crosshair = document.querySelector(".trend-crosshair");
  const dot = document.querySelector(".trend-hoverdot");
  const tooltip = document.getElementById("trend-tooltip");
  if (!svg || !hit || !tooltip) return;

  const metricLabel = EXT_METRICS.find((m) => m.key === state.externalDashboard.metric)?.label || "";

  function handleMove(clientX) {
    const rect = svg.getBoundingClientRect();
    const scale = 760 / rect.width;
    const xUser = (clientX - rect.left) * scale;
    let nearest = points[0], best = Infinity;
    for (const p of points) {
      const d = Math.abs(p.x - xUser);
      if (d < best) { best = d; nearest = p; }
    }
    crosshair.setAttribute("x1", nearest.x);
    crosshair.setAttribute("x2", nearest.x);
    crosshair.setAttribute("opacity", "1");
    dot.setAttribute("cx", nearest.x);
    dot.setAttribute("cy", nearest.y);
    dot.setAttribute("opacity", "1");

    const wrap = svg.closest(".chart-wrap");
    const wrapRect = wrap.getBoundingClientRect();
    const px = rect.left - wrapRect.left + nearest.x / scale;
    const py = rect.top - wrapRect.top + nearest.y / scale;
    tooltip.style.left = `${px}px`;
    tooltip.style.top = `${py}px`;
    tooltip.classList.add("show");
    tooltip.querySelector(".ct-value").textContent = `${formatCompact(nearest.v)} ${metricLabel}`;
    tooltip.querySelector(".ct-date").textContent = formatChartDate(nearest.date);
  }

  hit.addEventListener("pointermove", (e) => handleMove(e.clientX));
  hit.addEventListener("pointerleave", () => {
    crosshair.setAttribute("opacity", "0");
    dot.setAttribute("opacity", "0");
    tooltip.classList.remove("show");
  });
}

function renderExtHeader(data) {
  return `
    <div class="card" style="margin-bottom:18px">
      <div class="card-head">
        <span class="card-title">${escapeHtml(data.label || "Connected Project")}</span>
        <button type="button" class="row-icon-btn" id="external-dashboard-refresh-btn" aria-label="Refresh">${icon("refresh-cw")}</button>
      </div>
      <div class="page-tabs">
        ${EXT_RANGES.map((r) => `<button type="button" class="page-tab${state.externalDashboard.range === r.key ? " active" : ""}" data-ext-range="${r.key}">${r.label}</button>`).join("")}
      </div>
    </div>
  `;
}

function renderExtStatTiles(data) {
  const { current, pctChange } = data.totals;
  return `
    <div class="stat-tiles">
      ${EXT_METRICS.map(
        (m) => `
        <div class="stat-tile">
          <div class="stat-tile-head">
            <div class="stat-tile-value">${formatCompact(current[m.key])}</div>
            ${deltaBadge(pctChange[m.key])}
          </div>
          <div class="stat-tile-label">${escapeHtml(m.label)}</div>
        </div>
      `,
      ).join("")}
    </div>
  `;
}

function renderExtTrendSection(data) {
  const { svg, points } = buildTrendChart(data.daily, state.externalDashboard.metric);
  const tableRows = data.daily
    .map((d) => `<tr><td>${escapeHtml(formatChartDate(d.date))}</td><td>${formatCompact(d[state.externalDashboard.metric] ?? 0)}</td></tr>`)
    .join("");
  return `
    <div class="card" style="margin-top:18px">
      <div class="chart-card-head">
        <span class="card-title">Trend over time</span>
        <button type="button" class="table-toggle-btn" id="ext-trend-table-toggle">${state.externalDashboard.trendTableView ? "View as chart" : "View as table"}</button>
      </div>
      <div class="page-tabs" style="margin-bottom:14px">
        ${EXT_METRICS.map((m) => `<button type="button" class="page-tab${state.externalDashboard.metric === m.key ? " active" : ""}" data-ext-metric="${m.key}">${escapeHtml(m.label)}</button>`).join("")}
      </div>
      ${
        state.externalDashboard.trendTableView
          ? `<table class="viz-sr-table"><thead><tr><th>Date</th><th>${escapeHtml(EXT_METRICS.find((m) => m.key === state.externalDashboard.metric)?.label || "")}</th></tr></thead><tbody>${tableRows}</tbody></table>`
          : `
          <div class="chart-wrap">
            ${svg}
            <div class="chart-tooltip" id="trend-tooltip"><div class="ct-value"></div><div class="ct-date"></div></div>
          </div>
        `
      }
      <div data-trend-points='${JSON.stringify(points.map((p) => ({ x: p.x, y: p.y, v: p.v, date: p.date })))}' style="display:none"></div>
    </div>
  `;
}

function renderExtEventBreakdown(data) {
  const rows = EXT_METRICS.filter((m) => m.key !== "visitors")
    .map((m) => ({ label: m.label, value: data.totals.current[m.key] }))
    .sort((a, b) => b.value - a.value);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `
    <div class="card">
      <div class="card-head"><span class="card-title">Events this period</span></div>
      ${rows
        .map(
          (r) => `
        <div class="rank-row">
          <span class="rank-label">${escapeHtml(r.label)}</span>
          <span class="rank-bar-track"><span class="rank-bar-fill" style="width:${(r.value / max) * 100}%"></span></span>
          <span class="rank-value">${formatCompact(r.value)}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderExtFunnel(data) {
  const base = data.funnel[0]?.count || 1;
  return `
    <div class="card">
      <div class="card-head"><span class="card-title">Conversion funnel</span></div>
      ${data.funnel
        .map((f, i) => {
          const pctOfBase = Math.round((f.count / base) * 100);
          const opacity = 0.4 + i * (0.6 / Math.max(data.funnel.length - 1, 1));
          return `
          <div class="funnel-row">
            <div class="funnel-row-head">
              <span class="funnel-row-label">${escapeHtml(f.stage)}</span>
              <span class="funnel-row-meta">${formatCompact(f.count)} · ${pctOfBase}%</span>
            </div>
            <div class="funnel-track"><div class="funnel-fill" style="width:${pctOfBase}%;opacity:${opacity.toFixed(2)}"></div></div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

function renderExtDevice(data) {
  if (!data.device.length) return "";
  const slotVar = (i) => `var(--series-${(i % 3) + 1})`;
  return `
    <div class="card" style="margin-top:18px">
      <div class="card-head"><span class="card-title">Audience — device</span></div>
      <div class="device-track">
        ${data.device.map((d, i) => `<span class="device-seg" style="width:${d.pct}%;background:${slotVar(i)}"></span>`).join("")}
      </div>
      <div class="device-legend">
        ${data.device
          .map(
            (d, i) => `
          <span class="device-legend-item">
            <span class="device-legend-dot" style="background:${slotVar(i)}"></span>
            <span class="device-legend-label">${escapeHtml(d.device)}</span>
            <span class="device-legend-meta">${d.pct}% · ${formatCompact(d.visitors)}</span>
          </span>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderExtRankCard(title, items, labelKey, valueKey, valueFormatter) {
  if (!items.length) {
    return `<div class="card"><div class="card-head"><span class="card-title">${escapeHtml(title)}</span></div><div class="stub-placeholder" style="padding:24px">No data in this period.</div></div>`;
  }
  const max = Math.max(...items.map((it) => it[valueKey]), 1);
  return `
    <div class="card">
      <div class="card-head"><span class="card-title">${escapeHtml(title)}</span></div>
      ${items
        .map(
          (it) => `
        <div class="rank-row">
          <span class="rank-label">${escapeHtml(it[labelKey])}</span>
          <span class="rank-bar-track"><span class="rank-bar-fill" style="width:${(it[valueKey] / max) * 100}%"></span></span>
          <span class="rank-value">${valueFormatter ? valueFormatter(it) : formatCompact(it[valueKey])}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderExtHeatmap(data) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byDow = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const c of data.peakHours.cells) byDow[c.dow][c.hour] = c.count;
  const max = data.peakHours.max || 1;

  const hourHeaderCells = Array.from({ length: 24 }, (_, h) => `<div class="heatmap-hour-label">${h % 3 === 0 ? h : ""}</div>`).join("");
  const rows = DAYS.map((dayLabel, dow) => {
    const cells = byDow[dow]
      .map((count, hour) => {
        const opacity = count === 0 ? 0 : 0.12 + (count / max) * 0.88;
        return `<div class="heatmap-cell" style="opacity:${opacity.toFixed(2)}" tabindex="0" role="img" aria-label="${escapeHtml(dayLabel)} ${hour}:00, ${count} events"><title>${escapeHtml(dayLabel)} ${hour}:00 — ${count} event${count === 1 ? "" : "s"}</title></div>`;
      })
      .join("");
    return `<div class="heatmap-day-label">${dayLabel}</div>${cells}`;
  }).join("");

  return `
    <div class="card" style="margin-top:18px">
      <div class="card-head"><span class="card-title">Peak hours (UTC)</span></div>
      <div class="heatmap-scroll">
        <div class="heatmap-grid">
          <div></div>${hourHeaderCells}
          ${rows}
        </div>
      </div>
    </div>
  `;
}

function renderExternalDashboard() {
  const dash = state.externalDashboard;
  const backBtn = `<button type="button" class="card-link chat-back" id="external-dashboard-back-btn" style="margin-bottom:14px">${icon("chevron-left")} Back to summary</button>`;
  if (dash.loading && !dash.data) return `${backBtn}<div class="stub-placeholder">Loading dashboard…</div>`;
  if (dash.error) return `${backBtn}<div class="stub-placeholder">Couldn't load dashboard: ${escapeHtml(dash.error)}</div>`;
  const data = dash.data;
  if (!data || !data.configured) return `${backBtn}<div class="stub-placeholder">No analytics source connected.</div>`;
  if (data.error) return `${backBtn}<div class="stub-placeholder">Connected, but the last fetch failed: ${escapeHtml(data.error)}</div>`;

  return `
    <div class="viz-root">
      ${backBtn}
      ${renderExtHeader(data)}
      ${renderExtStatTiles(data)}
      ${renderExtTrendSection(data)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px">
        ${renderExtEventBreakdown(data)}
        ${renderExtFunnel(data)}
      </div>
      ${renderExtDevice(data)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px">
        ${renderExtRankCard("Top pages", data.topPages, "path", "views")}
        ${renderExtRankCard("Traffic sources", data.sources, "source", "visitors")}
      </div>
      ${renderExtRankCard("Exit pages", data.exitPages, "path", "exits", (it) => `${formatCompact(it.exits)} · ${it.exitRate}% exit`)}
      ${renderExtHeatmap(data)}
    </div>
  `;
}

async function loadExternalDashboard(range) {
  state.externalDashboard.range = range;
  state.externalDashboard.loading = true;
  state.externalDashboard.error = null;
  render();
  try {
    state.externalDashboard.data = await fetchJSON(`/api/analytics/external/dashboard?range=${encodeURIComponent(range)}`);
  } catch (err) {
    state.externalDashboard.error = err instanceof Error ? err.message : String(err);
  }
  state.externalDashboard.loading = false;
  render();
}

function renderSettingsPage() {
  if (state.settingsLoading && !state.settingsFields) return `<div class="stub-placeholder">Loading settings…</div>`;
  if (state.settingsError) return `<div class="stub-placeholder">Couldn't load settings: ${escapeHtml(state.settingsError)}</div>`;
  const fields = state.settingsFields || [];
  const groups = [];
  for (const f of fields) {
    let group = groups.find((g) => g.name === f.group);
    if (!group) {
      group = { name: f.group, fields: [] };
      groups.push(group);
    }
    group.fields.push(f);
  }
  const dirtyCount = Object.keys(state.settingsEdits).filter((k) => state.settingsEdits[k].trim()).length;

  return `
    <div class="stub-page settings-page">
      <div class="stub-head">
        <h1 class="stub-title">Settings</h1>
        <p class="stub-subtitle">Provider API keys and integration config — values are never shown back, only whether they're set.</p>
      </div>
      <div class="settings-savebar${dirtyCount ? " show" : ""}">
        <span>${dirtyCount} field${dirtyCount === 1 ? "" : "s"} changed</span>
        <button type="button" id="settings-save-btn" ${state.settingsSaving ? "disabled" : ""}>${state.settingsSaving ? "Saving…" : "Save changes"}</button>
      </div>
      ${groups
        .map(
          (g) => `
        <div class="card settings-group">
          <div class="card-head"><span class="card-title">${escapeHtml(g.name)}</span></div>
          ${g.fields
            .map(
              (f) => `
            <label class="settings-field">
              <span class="settings-field-label">${escapeHtml(f.label)}${f.isSet ? `<span class="settings-field-set">set · ${escapeHtml(f.masked)}</span>` : ""}</span>
              <input type="password" autocomplete="off" data-settings-field="${escapeHtml(f.envVar)}" placeholder="${f.isSet ? "Enter a new value to replace it" : "Not set"}" value="${escapeHtml(state.settingsEdits[f.envVar] ?? "")}" />
            </label>
          `,
            )
            .join("")}
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

// ---------- Chat / run-detail page ----------

function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function renderChatPage() {
  if (!state.openRunId) return renderConversationPicker();
  if (state.openRunLoading) return `<div class="stub-placeholder">Loading conversation…</div>`;
  if (state.openRunError) {
    return `
      <div class="stub-placeholder">
        Couldn't load this conversation: ${escapeHtml(state.openRunError)}<br /><br />
        <button type="button" class="card-link" id="chat-back-btn" style="display:inline-flex">← Back</button>
      </div>
    `;
  }
  const run = state.openRun;
  if (!run) return "";
  return `
    <div class="chat-page">
      ${renderChatHeader(run)}
      <div class="chat-log" id="chat-log">${renderChatLog(run)}</div>
      ${run.status !== "running" && run.sessionId ? renderChatReplyForm() : ""}
    </div>
  `;
}

function renderConversationPicker() {
  const recent = activeRuns().slice(0, 30);
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Chat</h1>
        <p class="stub-subtitle">Pick a conversation, or start a new one from Home.</p>
      </div>
      ${
        recent.length
          ? recent
              .map(
                (r) => `
          <button type="button" class="stub-list-row" data-open-run="${r.id}" style="width:100%;cursor:pointer">
            <span class="task-check ${r.status}">${r.status === "success" ? icon("check") : ""}</span>
            <span class="stub-list-title">${escapeHtml(r.goal)}</span>
            <span class="stub-list-meta">${escapeHtml(deptLabel(r.agentKey))} · ${formatRelativeTime(r.createdAt)}</span>
          </button>
        `,
              )
              .join("")
          : `<div class="stub-placeholder">No conversations yet — start one from Home.</div>`
      }
    </div>
  `;
}

function renderChatHeader(run) {
  return `
    <header class="chat-header">
      <button type="button" class="card-link chat-back" id="chat-back-btn">${icon("chevron-left")} Back</button>
      <div class="chat-header-row">
        <span class="status-badge ${run.status}">${run.status}</span>
        <span class="chat-header-agent">${escapeHtml(deptLabel(run.agentKey))}</span>
        ${run.costUsd != null ? `<span class="chat-header-cost">${formatCost(run.costUsd)}</span>` : ""}
        <span class="chat-header-spacer"></span>
        ${
          run.status === "running"
            ? `<button type="button" class="card-link chat-stop-btn" id="chat-stop-btn" ${state.cancelBusy ? "disabled" : ""}>${icon("square")} ${state.cancelBusy ? "Stopping…" : "Stop"}</button>`
            : ""
        }
      </div>
      <h1 class="chat-goal">${escapeHtml(run.goal)}</h1>
      <p class="chat-subheader">Started ${formatDateTime(run.createdAt)}${run.finishedAt ? ` · Finished ${formatDateTime(run.finishedAt)}` : ""}</p>
    </header>
  `;
}

function renderChatLog(run) {
  const resultsByToolUseId = new Map();
  for (const event of run.events) {
    if (event.type === "tool_result") resultsByToolUseId.set(event.toolUseId, event);
  }
  const parts = [];
  for (const event of run.events) {
    if (event.type === "tool_result") continue; // rendered inline with its tool_use
    if (event.type === "text") parts.push(renderChatTextMsg(event));
    else if (event.type === "tool_use") parts.push(renderChatToolCard(event, resultsByToolUseId.get(event.toolUseId)));
    else if (event.type === "done") parts.push(renderChatTurnDivider(event));
  }
  const body = parts.join("");
  if (!body) return run.status === "running" ? renderChatTyping() : `<div class="card-empty">No activity recorded.</div>`;
  return body + (run.status === "running" ? renderChatTyping() : "");
}

function renderChatTextMsg(event) {
  const color = deptColor(event.source) || "var(--accent)";
  const label = deptLabel(event.source);
  return `
    <div class="chat-msg">
      <span class="chat-msg-avatar" style="background:${color}">${escapeHtml((label || "?").slice(0, 1).toUpperCase())}</span>
      <div class="chat-msg-body">
        <div class="chat-msg-head"><span>${escapeHtml(label)}</span><span class="chat-msg-time">${formatClockTime(new Date(event.ts))}</span></div>
        <div class="chat-msg-text">${renderMarkdown(event.text)}</div>
      </div>
    </div>
  `;
}

function renderChatToolCard(event, result) {
  const isOpen = state.toolOpen.has(event.toolUseId);
  const isError = result?.isError;
  const statusIcon = !result ? "loader-circle" : isError ? "x-circle" : "check-circle";
  const statusClass = !result ? "pending" : isError ? "error" : "success";
  return `
    <div class="chat-msg">
      <span class="chat-msg-avatar tool-avatar">${icon("wrench")}</span>
      <div class="chat-msg-body">
        <button type="button" class="tool-card" data-toggle-tool="${event.toolUseId}">
          <span class="tool-card-head">
            <span class="tool-card-name">${escapeHtml(event.name)}</span>
            <span class="tool-card-status ${statusClass}">${icon(statusIcon)}</span>
            <span class="tool-card-chevron">${icon(isOpen ? "chevron-up" : "chevron-down")}</span>
          </span>
          ${
            isOpen
              ? `
            <span class="tool-card-body">
              <span class="tool-card-label">Input</span>
              <pre>${escapeHtml(JSON.stringify(event.input, null, 2))}</pre>
              ${
                result
                  ? `<span class="tool-card-label">${isError ? "Error" : "Result"}</span><pre>${escapeHtml(truncate(result.text, 2000))}</pre>`
                  : `<span class="tool-card-waiting">Waiting for result…</span>`
              }
            </span>
          `
              : ""
          }
        </button>
      </div>
    </div>
  `;
}

function renderChatTurnDivider(event) {
  return `
    <div class="turn-divider">
      <span>${event.status === "success" ? "Turn complete" : `Turn failed: ${escapeHtml(event.error || "unknown error")}`}</span>
      <span>${formatCost(event.costUsd)} · ${formatClockTime(new Date(event.ts))}</span>
    </div>
  `;
}

function renderChatTyping() {
  return `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
}

function renderChatReplyForm() {
  return `
    <form id="chat-reply-form" class="reply-form">
      <textarea id="chat-reply-input" placeholder="Reply to continue this conversation…" rows="1" required ${state.replyBusy ? "disabled" : ""}>${escapeHtml(state.chatReplyDraft)}</textarea>
      <button type="submit" class="reply-submit" aria-label="Send reply" ${state.replyBusy ? "disabled" : ""}>
        ${state.replyBusy ? icon("loader-circle") : icon("corner-down-left")}
      </button>
    </form>
  `;
}

// ---------- actions ----------

// ---------- generic modal ----------

// `renderer` is a () => htmlString, re-invoked on every render() so the
// modal's content stays current (e.g. a dirty/saving state) without each
// module needing its own overlay plumbing.
function openModal(renderer) {
  state.modal = renderer;
  render();
}

function closeModal() {
  state.modal = null;
  modalAttach = null;
  render();
}

// Set by whichever openXModal() is currently showing — attachHandlers()
// calls this unconditionally after every render() (same as VIEW_ATTACHERS),
// so a modal's own element bindings (inputs, save/cancel buttons) stay live
// across re-renders without each modal needing its own registry slot.
let modalAttach = null;

function renderModalOverlay() {
  return `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-card" id="modal-card">${state.modal()}</div>
    </div>
  `;
}

function showToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function switchView(view) {
  // Navigating via the sidebar always lands on the Chat picker (list), not
  // whatever conversation happened to be open last — individual runs are
  // only opened explicitly via openRun(). Closing the SSE connection here
  // (for every destination, "chat" included) means leaving a conversation
  // never leaves a live stream running in the background.
  closeRunEventSource();
  state.openRunId = null;
  state.openRun = null;
  state.view = view;
  state.sidebarOpen = false;
  state.userMenuOpen = false;
  if (view === "settings" && !state.settingsFields && !state.settingsLoading) loadSettings();
  LAZY_LOADERS[view]?.();
  render();
}

// ---------- Chat / run-detail ----------

function closeRunEventSource() {
  if (runEventSource) {
    runEventSource.close();
    runEventSource = null;
  }
}

function openRun(id) {
  closeRunEventSource();
  state.view = "chat";
  state.sidebarOpen = false;
  state.openRunId = id;
  state.openRun = null;
  state.openRunLoading = true;
  state.openRunError = null;
  state.toolOpen = new Set();
  render();
  loadOpenRun(id);
}

async function loadOpenRun(id) {
  try {
    const run = await fetchJSON(`/api/runs/${id}`);
    if (state.openRunId !== id) return; // user navigated away before this resolved
    state.openRun = run;
    state.openRunLoading = false;
    render();
    scrollChatLogToBottom();
    streamOpenRun(id);
  } catch (err) {
    if (state.openRunId !== id) return;
    state.openRunError = err instanceof Error ? err.message : String(err);
    state.openRunLoading = false;
    render();
  }
}

function streamOpenRun(id) {
  closeRunEventSource();
  // The GET above already has every event recorded so far — replay=0 so the
  // stream only adds what happens *after* this point.
  runEventSource = new EventSource(`/api/runs/${id}/stream?replay=0`);
  runEventSource.onmessage = (msg) => handleRunStreamEvent(id, JSON.parse(msg.data));
  runEventSource.onerror = () => closeRunEventSource();
}

function handleRunStreamEvent(id, event) {
  if (state.openRunId !== id || !state.openRun) return;
  if (event.type === "run_finished") {
    state.openRun.status = event.status;
    state.openRun.costUsd = event.costUsd;
    state.openRun.summary = event.summary;
    state.openRun.linearTasks = event.linearTasks;
    state.openRun.sessionId = event.sessionId ?? state.openRun.sessionId;
    loadAll(true);
  } else {
    state.openRun.events.push(event);
  }
  render();
  scrollChatLogToBottom();
}

async function sendReply(id, message) {
  state.replyBusy = true;
  render();
  try {
    await fetchJSON(`/api/runs/${id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    closeRunEventSource();
    const run = await fetchJSON(`/api/runs/${id}`);
    if (state.openRunId !== id) return;
    state.openRun = run;
    state.replyBusy = false;
    render();
    scrollChatLogToBottom();
    streamOpenRun(id);
  } catch (err) {
    state.openRunError = err instanceof Error ? err.message : String(err);
    state.replyBusy = false;
    render();
  }
}

// ---------- Settings ----------

async function loadSettings() {
  state.settingsLoading = true;
  state.settingsError = null;
  render();
  try {
    state.settingsFields = await fetchJSON("/api/settings");
  } catch (err) {
    state.settingsError = err instanceof Error ? err.message : String(err);
  }
  state.settingsLoading = false;
  render();
}

async function saveSettings() {
  const body = {};
  for (const [k, v] of Object.entries(state.settingsEdits)) {
    if (v.trim()) body[k] = v.trim();
  }
  if (!Object.keys(body).length) return;
  state.settingsSaving = true;
  render();
  try {
    state.settingsFields = await fetchJSON("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    state.settingsEdits = {};
    state.settingsSavedAt = Date.now();
    showToast("Settings saved.");
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err));
  }
  state.settingsSaving = false;
  render();
}

async function cancelOpenRun(id) {
  state.cancelBusy = true;
  render();
  try {
    await fetchJSON(`/api/runs/${id}/cancel`, { method: "POST" });
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err));
  }
  state.cancelBusy = false;
  render();
}

// Called explicitly after events that actually add new log content (initial
// open, a streamed event, a reply) — not from the generic render() path,
// which also fires on the unrelated 10s dashboard poll and would otherwise
// yank the log back to the bottom even when nothing in it changed.
function scrollChatLogToBottom() {
  const log = document.getElementById("chat-log");
  if (log) log.scrollTop = log.scrollHeight;
}

function toggleToolCard(toolUseId) {
  if (state.toolOpen.has(toolUseId)) state.toolOpen.delete(toolUseId);
  else state.toolOpen.add(toolUseId);
  render();
}

async function submitGoal(goal) {
  state.composerBusy = true;
  state.composerError = null;
  render();
  const targetAgent = state.composerTargetAgent;
  const url = targetAgent ? `/api/agents/${targetAgent}/runs` : "/api/runs";
  try {
    const result = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, provider: state.composerProvider, attachments: state.composerAttachments }),
    });
    state.composerDraft = "";
    state.composerAttachments = [];
    state.composerTargetAgent = null;
    await loadAll(true);
    if (result?.id) openRun(result.id);
    else showToast("Task started.");
  } catch (err) {
    state.composerError = err instanceof Error ? err.message : String(err);
  }
  state.composerBusy = false;
  render();
}

async function uploadAttachments(files) {
  state.composerUploading = true;
  render();
  for (const file of files) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Upload failed (${res.status})`);
      const data = await res.json();
      state.composerAttachments.push({ filename: data.filename, text: data.text, truncated: Boolean(data.truncated), path: data.path });
    } catch (err) {
      state.composerError = err instanceof Error ? err.message : String(err);
    }
  }
  state.composerUploading = false;
  render();
}

function markNotifsRead() {
  state.notifLastSeen = Date.now();
  localStorage.setItem(NOTIF_SEEN_KEY, String(state.notifLastSeen));
  render();
}

// Shared by the orbit cards, suggestion chips and Quick Tools grid — each
// just seeds the composer with a starting prompt and (optionally) routes it
// straight to one department instead of the CEO.
function fillComposerAndFocus(prompt, targetAgent = null) {
  state.composerDraft = prompt;
  state.composerTargetAgent = targetAgent;
  render();
  const input = document.getElementById("composer-input");
  if (input) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ---------- handlers ----------

let flurryTrackingBound = false;

function initFlurryBotInteraction() {
  const bot = document.getElementById("flurry-bot");
  if (!bot) return;

  bot.onclick = () => {
    bot.classList.add("is-winking");
    setTimeout(() => bot.classList.remove("is-winking"), 650);
  };

  if (flurryTrackingBound) return;
  flurryTrackingBound = true;

  window.addEventListener("pointermove", (e) => {
    const curBot = document.getElementById("flurry-bot");
    if (!curBot) return;

    const rect = curBot.getBoundingClientRect();
    const botCenterX = rect.left + rect.width * 0.5;
    const botCenterY = rect.top + rect.height * 0.5;

    const dx = e.clientX - botCenterX;
    const dy = e.clientY - botCenterY;
    const dist = Math.hypot(dx, dy);

    // Activated on hover or proximity (< 360px)
    const isOver = curBot.matches(":hover") || dist < 360;

    if (isOver) {
      curBot.setAttribute("data-mood", "active");
      const angle = Math.atan2(dy, dx);
      const distRatio = Math.min(1.0, Math.max(0.18, dist / 220));
      const eyeX = Math.cos(angle) * 14 * distRatio;
      const eyeY = Math.sin(angle) * 11 * distRatio;

      const tiltX = Math.max(-14, Math.min(14, -dy * 0.05));
      const tiltY = Math.max(-16, Math.min(16, dx * 0.05));

      curBot.style.setProperty("--eye-x", `${eyeX.toFixed(1)}px`);
      curBot.style.setProperty("--eye-y", `${eyeY.toFixed(1)}px`);
      curBot.style.setProperty("--bot-tilt-x", `${tiltX.toFixed(1)}deg`);
      curBot.style.setProperty("--bot-tilt-y", `${tiltY.toFixed(1)}deg`);
    } else {
      if (curBot.getAttribute("data-mood") === "active") {
        curBot.setAttribute("data-mood", "idle");
        curBot.style.removeProperty("--eye-x");
        curBot.style.removeProperty("--eye-y");
        curBot.style.removeProperty("--bot-tilt-x");
        curBot.style.removeProperty("--bot-tilt-y");
      }
    }
  }, { passive: true });
}

function attachHandlers() {
  const botEngine = window.MetallicBot || window.FluffyBot;
  if (botEngine) {
    const slot = document.getElementById("metallic-bot-slot") || document.getElementById("fluffy-bot-slot");
    if (slot) botEngine.mount(slot);
  }
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.nav));
  });

  document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  });
  document.getElementById("sidebar-collapse-toggle")?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    render();
  });
  document.getElementById("sidebar-brand-mark")?.addEventListener("click", () => {
    if (state.sidebarCollapsed) {
      state.sidebarCollapsed = false;
      render();
    }
  });
  document.getElementById("sidebar-backdrop")?.addEventListener("click", () => {
    state.sidebarOpen = false;
    render();
  });

  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

  document.getElementById("right-bar-toggle")?.addEventListener("click", () => {
    state.rightBarOpen = !state.rightBarOpen;
    render();
  });

  document.getElementById("sidebar-user-menu-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.userMenuOpen = !state.userMenuOpen;
    render();
  });
  document.getElementById("logout-btn")?.addEventListener("click", logout);

  document.getElementById("topbar-search-toggle")?.addEventListener("click", () => {
    state.searchFocused = true;
    state.notifsOpen = false;
    render();
    document.getElementById("topbar-search-input")?.focus();
  });

  const searchInput = document.getElementById("topbar-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      render();
      document.getElementById("topbar-search-input")?.focus();
      const v = document.getElementById("topbar-search-input");
      if (v) v.setSelectionRange(v.value.length, v.value.length);
    });
    searchInput.addEventListener("focus", () => {
      state.searchFocused = true;
      state.notifsOpen = false;
      render();
      document.getElementById("topbar-search-input")?.focus();
    });
  }

  document.querySelectorAll("[data-open-run]").forEach((btn) => {
    btn.addEventListener("click", () => openRun(btn.dataset.openRun));
  });
  document.querySelectorAll("[data-open-doc]").forEach((btn) => {
    btn.addEventListener("click", () => window.open(`/api/documents/${btn.dataset.openDoc}/download`, "_blank", "noopener"));
  });

  document.querySelectorAll("[data-settings-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const fieldKey = input.dataset.settingsField;
      const cursor = e.target.selectionStart;
      state.settingsEdits[fieldKey] = e.target.value;
      render(); // re-rendered (not just state-tracked) so the save-bar's dirty count stays live as you type
      const el = document.querySelector(`[data-settings-field="${fieldKey}"]`);
      if (el) {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      }
    });
  });
  document.getElementById("settings-save-btn")?.addEventListener("click", saveSettings);
  document.getElementById("analytics-connect-btn")?.addEventListener("click", () => switchView("accounts"));

  document.getElementById("chat-back-btn")?.addEventListener("click", () => switchView("chat"));
  document.getElementById("chat-stop-btn")?.addEventListener("click", () => {
    if (state.openRunId) cancelOpenRun(state.openRunId);
  });
  document.querySelectorAll("[data-toggle-tool]").forEach((btn) => {
    btn.addEventListener("click", () => toggleToolCard(btn.dataset.toggleTool));
  });
  document.getElementById("chat-reply-input")?.addEventListener("input", (e) => {
    state.chatReplyDraft = e.target.value;
  });
  document.getElementById("chat-reply-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-reply-input");
    const message = (input?.value || "").trim();
    if (!message || state.replyBusy || !state.openRunId) return;
    state.chatReplyDraft = "";
    sendReply(state.openRunId, message);
  });

  document.getElementById("notif-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.notifsOpen = !state.notifsOpen;
    state.searchFocused = false;
    render();
  });
  document.getElementById("notifs-mark-read")?.addEventListener("click", markNotifsRead);

  const composerInput = document.getElementById("composer-input");
  composerInput?.addEventListener("input", (e) => {
    state.composerDraft = e.target.value; // tracked so background-poll re-renders don't wipe it; deliberately no render() here (would cost focus/cursor position on every keystroke)
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  });
  if (composerInput) {
    composerInput.style.height = "auto";
    composerInput.style.height = `${Math.min(composerInput.scrollHeight, 120)}px`;
  }
  composerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("composer-form")?.requestSubmit();
    }
  });

  document.querySelectorAll("[data-quick-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = QUICK_ACTIONS.find((a) => a.key === btn.dataset.quickAction);
      if (action) fillComposerAndFocus(action.prompt, QUICK_ACTION_TARGETS[action.key] ?? null);
    });
  });
  document.querySelectorAll("[data-suggestion]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const chip = SUGGESTION_CHIPS.find((c) => c.key === btn.dataset.suggestion);
      if (chip) fillComposerAndFocus(chip.prompt);
    });
  });
  document.getElementById("suggestion-more")?.addEventListener("click", () => {
    document.getElementById("composer-input")?.focus();
  });
  document.querySelectorAll("[data-quick-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = QUICK_TOOLS.find((t) => t.key === btn.dataset.quickTool);
      if (!tool?.prompt) return;
      // Quick Tools now lives in the sidebar (visible on every view), but
      // the composer it fills only exists on Home — switch there first if
      // we're not already on it, or the draft would be set on state with
      // nothing visible to show for it.
      if (state.view !== "home") switchView("home");
      fillComposerAndFocus(tool.prompt);
    });
  });
  document.getElementById("promo-focus-btn")?.addEventListener("click", () => {
    const input = document.getElementById("composer-input");
    input?.scrollIntoView({ behavior: "smooth", block: "center" });
    input?.focus();
  });
  document.getElementById("composer-target-clear")?.addEventListener("click", () => {
    state.composerTargetAgent = null;
    render();
  });

  document.getElementById("composer-attach-btn")?.addEventListener("click", () => {
    document.getElementById("composer-file-input")?.click();
  });
  document.getElementById("composer-file-input")?.addEventListener("change", (e) => {
    const files = [...(e.target.files || [])];
    if (files.length) uploadAttachments(files);
  });
  document.querySelectorAll("[data-remove-attachment]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.composerAttachments.splice(Number(btn.dataset.removeAttachment), 1);
      render();
    });
  });

  const providerSelect = document.getElementById("composer-provider");
  providerSelect?.addEventListener("change", (e) => {
    state.composerProvider = e.target.value;
  });

  const form = document.getElementById("composer-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("composer-input");
    const goal = (input?.value || "").trim();
    if (!goal || state.composerBusy) return;
    submitGoal(goal);
  });

  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });
  document.getElementById("modal-card")?.addEventListener("click", (e) => e.stopPropagation());
  modalAttach?.();

  for (const attach of VIEW_ATTACHERS) attach();
}

// Closes search results / notifications when clicking elsewhere. Attached
// once at init (not inside attachHandlers(), which reruns on every render —
// including the background poll's — since a plain addEventListener there
// would stack up a fresh listener each time instead of replacing one).
function attachOutsideClickHandler() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".topbar-search") && state.searchFocused) {
      state.searchFocused = false;
      render();
    }
    if (!e.target.closest(".topbar-notifs") && !e.target.closest("#notif-toggle") && state.notifsOpen) {
      state.notifsOpen = false;
      render();
    }
    if (!e.target.closest(".sidebar-user") && state.userMenuOpen) {
      state.userMenuOpen = false;
      render();
    }
  });
}

function attachGlobalKeyboardShortcut() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (state.view !== "home") {
        state.view = "home";
        render();
      }
      document.getElementById("topbar-search-input")?.focus();
    }
  });
}

// ---------- init ----------

initTheme();
attachOutsideClickHandler();
attachGlobalKeyboardShortcut();
loadAll();
setInterval(() => loadAll(true), POLL_MS);
setInterval(() => {
  if (!state.loading) render();
}, 60000); // keep the topbar clock honest even with no other state change
