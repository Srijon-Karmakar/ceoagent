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

const QUICK_ACTIONS = [
  {
    key: "plan",
    label: "Plan",
    icon: "list-checks",
    bg: "color-mix(in srgb, var(--accent) 16%, transparent)",
    fg: "var(--accent)",
    desc: "Turn goals into structured plans",
    prompt: "Help me turn this goal into a concrete, step-by-step plan: ",
  },
  {
    key: "research",
    label: "Research",
    icon: "search",
    bg: "color-mix(in srgb, #0891b2 16%, transparent)",
    fg: "#0891b2",
    desc: "Find insights and opportunities",
    prompt: "Research the following and summarize key findings: ",
  },
  {
    key: "create",
    label: "Create",
    icon: "sparkles",
    bg: "color-mix(in srgb, var(--warning) 20%, transparent)",
    fg: "var(--warning)",
    desc: "Draft content, documents and more",
    prompt: "Draft the following for me: ",
  },
  {
    key: "execute",
    label: "Execute",
    icon: "zap",
    bg: "color-mix(in srgb, var(--success) 18%, transparent)",
    fg: "var(--success)",
    desc: "Get things done with your agents",
    prompt: "Get this done end-to-end: ",
  },
];

const NOTIF_SEEN_KEY = "ceoagent_preview_notif_last_seen";
const THEME_KEY = "theme"; // same key the main app uses, so theme choice is shared across both pages
const POLL_MS = 10000;

// Quick-action cards that map cleanly onto one real department target the
// CEO directly (bypassing delegation) — Create/Execute stay routed through
// the CEO (POST /api/runs) since neither maps onto a single department
// without guessing.
const QUICK_ACTION_TARGETS = { plan: "manager", research: "analysis" };

const state = {
  theme: "light",
  view: "home",
  sidebarOpen: false,
  loading: true,
  loadError: null,
  tenant: null,
  departments: [],
  runs: [],
  documents: [],
  memory: [],
  analytics: null,
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
  progressRange: "week", // "week" | "month" | "all"

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
    state.loadError = null;
  } catch (err) {
    state.loadError = err instanceof Error ? err.message : String(err);
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

function formatClockDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
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
  const saved = localStorage.getItem(THEME_KEY);
  state.theme = saved === "light" || saved === "dark" ? saved : "light";
  document.documentElement.setAttribute("data-theme", state.theme);
}

function toggleTheme() {
  state.theme = state.theme === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, state.theme);
  document.documentElement.setAttribute("data-theme", state.theme);
  render();
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
        <div class="content">${renderView()}</div>
      </div>
    </div>
    <div class="toast" id="toast"></div>
    ${state.modal ? renderModalOverlay() : ""}
  `;
  attachHandlers();
  if (window.lucide) window.lucide.createIcons();
}

function renderSidebar() {
  const orgName = state.tenant?.organizationName || "Your organization";
  const initial = (state.tenant?.name || state.tenant?.email || "?").slice(0, 1).toUpperCase();
  return `
    <aside class="sidebar${state.sidebarOpen ? " open" : ""}" id="sidebar">
      <div class="sidebar-brand">
        <span class="sidebar-brand-mark">${icon("sparkle")}</span>
        <span class="sidebar-brand-text">
          <div class="sidebar-brand-title">CeoAgent</div>
          <div class="sidebar-brand-sub">${escapeHtml(orgName)}</div>
        </span>
      </div>
      <nav class="sidebar-nav">
        ${NAV_ITEMS.map(
          (item) => `
          <button type="button" class="sidebar-nav-link${state.view === item.key ? " active" : ""}" data-nav="${item.key}">
            ${icon(item.icon)}<span>${item.label}</span>
          </button>
        `,
        ).join("")}
      </nav>
      <div class="sidebar-user">
        <span class="sidebar-user-avatar">${escapeHtml(initial)}</span>
        <span class="sidebar-user-text">
          <div class="sidebar-user-name">${escapeHtml(state.tenant?.name || state.tenant?.email || "Signed in")}</div>
          <div class="sidebar-user-sub">${escapeHtml(state.tenant?.email || "")}</div>
        </span>
      </div>
    </aside>
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
  const now = new Date();
  const results = state.searchFocused ? searchResults() : null;
  const unseenNotifs = notificationItems().filter((n) => n.ts > state.notifLastSeen);

  return `
    <header class="topbar">
      <button type="button" class="topbar-menu-btn" id="sidebar-toggle" aria-label="Menu">${icon("menu")}</button>
      <div class="topbar-search">
        <span class="topbar-search-icon">${icon("search")}</span>
        <input id="topbar-search-input" type="text" placeholder="Search anything…" value="${escapeHtml(state.searchQuery)}" autocomplete="off" />
        <span class="topbar-search-kbd">Ctrl K</span>
        ${state.searchFocused && state.searchQuery.trim() ? renderSearchResults(results) : ""}
      </div>
      <div class="topbar-spacer"></div>
      <button type="button" class="topbar-icon-btn" id="theme-toggle" aria-label="Toggle theme">
        ${icon(state.theme === "light" ? "sun" : "moon")}
      </button>
      <button type="button" class="topbar-icon-btn" id="notif-toggle" aria-label="Notifications">
        ${icon("bell")}
        ${unseenNotifs.length ? `<span class="topbar-badge">${unseenNotifs.length > 9 ? "9+" : unseenNotifs.length}</span>` : ""}
      </button>
      ${state.notifsOpen ? renderNotifs() : ""}
      <div class="topbar-clock">
        <strong>${formatClockTime(now)}</strong>
        ${formatClockDate(now)}
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
    <div class="home-eyebrow">Plan · Research · Create · Execute</div>
    <h1 class="home-greeting">Good ${period}, ${escapeHtml(firstName())}</h1>
    <p class="home-subtitle">Your AI executive team is ready to turn ideas into progress.</p>

    <div class="home-grid">
      <div class="home-col-main">
        <div class="hero-card">
          <div class="hero-blob" aria-hidden="true"></div>
          ${renderComposer()}
        </div>
        ${renderQuickActions()}
        <div class="panel-row">
          ${renderTodayTasksCard()}
          ${renderRecentConversationsCard()}
        </div>
      </div>
      <div class="home-col-side">
        ${renderAgentsCard()}
        ${renderProgressCard()}
      </div>
    </div>
  `;
}

function renderComposer() {
  const target = state.composerTargetAgent ? deptMeta(state.composerTargetAgent) : null;
  return `
    <form id="composer-form" class="composer-form">
      <div class="composer-shell">
        ${
          target
            ? `<div class="composer-target-chip">
                ${icon("corner-down-right")}
                Sending directly to <strong>${escapeHtml(target.label)}</strong>
                <button type="button" id="composer-target-clear" aria-label="Send to CEO instead">${icon("x")}</button>
              </div>`
            : ""
        }
        <textarea id="composer-input" class="composer-textarea" rows="2" placeholder="Tell me what you want to do today…" ${state.composerBusy ? "disabled" : ""}>${escapeHtml(state.composerDraft)}</textarea>
        ${renderAttachmentChips()}
        <div class="composer-row">
          <input type="file" id="composer-file-input" multiple hidden />
          <button type="button" class="composer-icon-btn" id="composer-attach-btn" title="Attach a file" ${state.composerUploading ? "disabled" : ""}>
            ${state.composerUploading ? icon("loader-circle") : icon("paperclip")}
          </button>
          <button type="button" class="composer-icon-btn" title="Web context (coming soon)" disabled>${icon("globe")}</button>
          <button type="button" class="composer-icon-btn" title="More options (coming soon)" disabled>${icon("sliders-horizontal")}</button>
          <label class="composer-model">
            ${icon("sparkles")}
            <select id="composer-provider">
              ${MODEL_OPTIONS.map((o) => `<option value="${o.value}"${o.value === state.composerProvider ? " selected" : ""}>${o.label}</option>`).join("")}
            </select>
          </label>
          <span class="composer-spacer"></span>
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

function renderQuickActions() {
  return `
    <div class="quick-actions">
      ${QUICK_ACTIONS.map(
        (a) => `
        <button type="button" class="quick-action-card" data-quick-action="${a.key}">
          <span class="quick-action-icon" style="background:${a.bg};color:${a.fg}">${icon(a.icon)}</span>
          <span class="quick-action-title">${a.label}${icon("chevron-right")}</span>
          <span class="quick-action-desc">${a.desc}</span>
        </button>
      `,
      ).join("")}
    </div>
  `;
}

function renderTodayTasksCard() {
  const todays = activeRuns()
    .filter((r) => isToday(r.createdAt))
    .slice(0, 6);
  return `
    <div class="card">
      <div class="card-head">
        <span class="card-title">Today's Tasks</span>
        <button type="button" class="card-link" data-nav="tasks">View all${icon("chevron-right")}</button>
      </div>
      ${
        todays.length
          ? todays
              .map(
                (r) => `
          <button type="button" class="task-row" data-open-run="${r.id}" style="width:100%;text-align:left;border-left:none;border-right:none;background:none">
            <span class="task-check ${r.status}">${r.status === "success" ? icon("check") : ""}</span>
            <span class="task-text">${escapeHtml(r.goal)}</span>
            <span class="task-time">${new Date(r.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
          </button>
        `,
              )
              .join("")
          : `<div class="card-empty">Nothing run yet today — try the composer above.</div>`
      }
    </div>
  `;
}

function renderRecentConversationsCard() {
  const recent = activeRuns().slice(0, 6);
  return `
    <div class="card">
      <div class="card-head">
        <span class="card-title">Recent Conversations</span>
        <button type="button" class="card-link" data-nav="tasks">View all${icon("chevron-right")}</button>
      </div>
      ${
        recent.length
          ? recent
              .map(
                (r) => `
          <button type="button" class="convo-row" data-open-run="${r.id}" style="width:100%;text-align:left;border-top:1px solid var(--border);background:none">
            <span class="convo-dot" style="background:${deptColor(r.agentKey)}"></span>
            <span class="convo-text">${escapeHtml(r.goal)}</span>
            <span class="convo-time">${formatRelativeTime(r.createdAt)}</span>
          </button>
        `,
              )
              .join("")
          : `<div class="card-empty">No conversations yet.</div>`
      }
    </div>
  `;
}

function runningAgentKeys() {
  return new Set(activeRuns().filter((r) => r.status === "running").map((r) => r.agentKey));
}

function renderAgentsCard() {
  const running = runningAgentKeys();
  return `
    <div class="card">
      <div class="card-head">
        <span class="card-title">AI Agents</span>
        <button type="button" class="card-link" data-nav="agents">View all${icon("chevron-right")}</button>
      </div>
      <div class="agent-list">
        ${state.departments
          .map((d) => {
            const isRunning = running.has(d.key);
            return `
            <div class="agent-row">
              <span class="agent-dot" style="background:${d.color[state.theme]}"></span>
              <span class="agent-text">
                <div class="agent-name">${escapeHtml(d.label)}</div>
                <div class="agent-status${isRunning ? " running" : ""}">${isRunning ? "Running now" : "Idle"}</div>
              </span>
            </div>
          `;
          })
          .join("")}
      </div>
    </div>
  `;
}

const PROGRESS_RANGE_LABELS = { week: "This Week", month: "This Month", all: "All Time" };

function rangeStartDate(range) {
  const now = new Date();
  if (range === "all") return new Date(0);
  if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return start;
  }
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// Completed/In Progress/Blocked only — real run statuses are
// running/success/error, nothing maps to a 4th "pending" state, so that
// category is deliberately not shown rather than faked as a permanent 0.
// The ring/legend reflect the selected range; the bar strip below it always
// shows the last 7 days as a fixed trend line, regardless of range, since
// the backend's runsByDay only covers the last 14 days — stretching that
// into a monthly/all-time bar chart would mean fabricating buckets it
// doesn't have data for.
function computeProgress(range) {
  const start = rangeStartDate(range);
  const rangeRuns = activeRuns().filter((r) => new Date(r.createdAt) >= start);
  const completed = rangeRuns.filter((r) => r.status === "success").length;
  const inProgress = rangeRuns.filter((r) => r.status === "running").length;
  const blocked = rangeRuns.filter((r) => r.status === "error").length;
  const total = rangeRuns.length;

  const byDay = state.analytics?.runsByDay ?? [];
  const last7 = byDay.slice(-7);
  const bars = last7.map((entry) => ({
    label: new Date(entry.date).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1),
    count: entry.count,
  }));

  return { completed, inProgress, blocked, total, bars };
}

function progressRing(pct, { size = 86, strokeWidth = 8 } = {}) {
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const dash = clamped * circumference;
  const fillArc =
    clamped > 0
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--success)" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${dash} ${circumference - dash}" transform="rotate(-90 ${c} ${c})" />`
      : "";
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeWidth}" />
      ${fillArc}
    </svg>
  `;
}

function renderProgressCard() {
  const { completed, inProgress, blocked, total, bars } = computeProgress(state.progressRange);
  const pct = total > 0 ? completed / total : 0;
  const maxBar = Math.max(1, ...bars.map((b) => b.count));

  return `
    <div class="card">
      <div class="card-head">
        <span class="card-title">Progress</span>
        <select class="progress-range-select" id="progress-range-select">
          ${Object.entries(PROGRESS_RANGE_LABELS)
            .map(([value, label]) => `<option value="${value}"${value === state.progressRange ? " selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </div>
      <div class="progress-card-body">
        <div class="progress-ring-wrap">
          ${progressRing(pct)}
          <span class="progress-ring-label">
            <div class="progress-ring-frac">${completed}/${total}</div>
            <div class="progress-ring-sub">Tasks</div>
          </span>
        </div>
        <div class="progress-legend">
          <span class="progress-legend-item"><span class="progress-legend-dot" style="background:var(--success)"></span>${completed} Completed</span>
          <span class="progress-legend-item"><span class="progress-legend-dot" style="background:var(--warning)"></span>${inProgress} In Progress</span>
          <span class="progress-legend-item"><span class="progress-legend-dot" style="background:var(--error)"></span>${blocked} Blocked</span>
        </div>
      </div>
      <div class="progress-bars">
        ${bars
          .map(
            (b) => `
          <div class="progress-bar-col">
            <span class="progress-bar" style="height:${Math.max(3, (b.count / maxBar) * 40)}px"></span>
            <span class="progress-bar-label">${b.label[0]}</span>
          </div>
        `,
          )
          .join("")}
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
    </div>
  `;
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

// ---------- handlers ----------

function attachHandlers() {
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.nav));
  });

  document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    render();
  });
  document.getElementById("sidebar-backdrop")?.addEventListener("click", () => {
    state.sidebarOpen = false;
    render();
  });

  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

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
  });

  document.querySelectorAll("[data-quick-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = QUICK_ACTIONS.find((a) => a.key === btn.dataset.quickAction);
      if (!action) return;
      state.composerTargetAgent = QUICK_ACTION_TARGETS[action.key] ?? null;
      state.composerDraft = action.prompt;
      render();
      const input = document.getElementById("composer-input");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
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

  document.getElementById("progress-range-select")?.addEventListener("change", (e) => {
    state.progressRange = e.target.value;
    render();
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
