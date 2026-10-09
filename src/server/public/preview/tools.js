"use strict";

// Tools — "what can I ask for" showcase, one GET /api/tools call (a curated
// catalog distinct from /api/accounts — same connected/not status, but with
// usedBy/features/examplePrompt text that only lives on this endpoint).

state.toolsCatalog = { items: [], loaded: false, loading: false, error: null, search: "", filter: "all" };

const DEFAULT_TOOLS_PREVIEW = [
  { key: "browser", label: "Web Search & Scraping", connected: true, usedBy: ["ceo", "analysis", "manager"], features: ["Real-time search", "Extract content", "Competitor research"], examplePrompt: "Research our top 3 competitors in AI automation" },
  { key: "email", label: "Gmail Sending & Drafting", connected: true, usedBy: ["ceo", "sales", "hr"], features: ["Draft emails", "Send transactional notes", "Read inbox"], examplePrompt: "Draft an intro email to venture partners" },
  { key: "code", label: "Code Interpreter & Terminal", connected: true, usedBy: ["developer", "product"], features: ["Execute scripts", "File transformations", "Data analysis"], examplePrompt: "Write a script to analyze user retention" },
  { key: "social", label: "Social Media Auto-Publish", connected: true, usedBy: ["marketing", "sales"], features: ["Schedule tweets", "LinkedIn updates", "Track impressions"], examplePrompt: "Schedule an announcement tweet for tomorrow morning" },
  { key: "crm", label: "CRM Pipeline Sync", connected: true, usedBy: ["sales", "manager"], features: ["Create leads", "Update stage", "Track deals"], examplePrompt: "Move TechCorp to Qualified stage with $25k value" },
  { key: "notion_sync", label: "Notion Knowledge Base", connected: false, usedBy: ["product", "analysis"], features: ["Sync specs", "Update wiki", "Search company knowledge"], examplePrompt: "Sync PRD with Notion product roadmap" },
];

async function loadToolsCatalog(force) {
  if (state.toolsCatalog.loaded && !force) return;
  state.toolsCatalog.loading = true;
  render();
  try {
    state.toolsCatalog.items = await fetchJSON("/api/tools");
    state.toolsCatalog.loaded = true;
    state.toolsCatalog.error = null;
  } catch (err) {
    if (String(err).includes("Not signed in") || String(err).includes("401")) {
      state.toolsCatalog.items = DEFAULT_TOOLS_PREVIEW;
      state.toolsCatalog.loaded = true;
      state.toolsCatalog.error = null;
    } else {
      state.toolsCatalog.error = err instanceof Error ? err.message : String(err);
    }
  }
  state.toolsCatalog.loading = false;
  render();
}
LAZY_LOADERS.tools = () => loadToolsCatalog(false);

VIEW_RENDERERS.tools = function renderToolsPage() {
  if (state.toolsCatalog.loading && !state.toolsCatalog.loaded) return `<div class="stub-placeholder">Loading tools…</div>`;
  if (state.toolsCatalog.error) return `<div class="stub-placeholder">Couldn't load tools: ${escapeHtml(state.toolsCatalog.error)}</div>`;

  const items = state.toolsCatalog.items || [];
  const totalCount = items.length;
  const connectedCount = items.filter((t) => t.connected).length;
  const availableCount = items.filter((t) => !t.connected).length;

  const q = (state.toolsCatalog.search || "").trim().toLowerCase();
  const filter = state.toolsCatalog.filter || "all";

  const filtered = items.filter((t) => {
    if (filter === "connected" && !t.connected) return false;
    if (filter === "available" && t.connected) return false;
    if (q) {
      const matchLabel = (t.label || "").toLowerCase().includes(q);
      const matchFeat = (t.features || []).some((f) => f.toLowerCase().includes(q));
      const matchAgents = (t.usedBy || []).some((u) => deptLabel(u).toLowerCase().includes(q));
      if (!matchLabel && !matchFeat && !matchAgents) return false;
    }
    return true;
  });

  return `
    <div class="tasks-page tools-page">
      <div class="tasks-header">
        <div class="tasks-header-title-col">
          <div class="tasks-eyebrow">⚡ Workforce Capabilities</div>
          <h1 class="tasks-title">Tools <span class="tasks-count-pill">${totalCount}</span></h1>
          <p class="tasks-subtitle">Active skills, integrations, and capabilities accessible to your agents right now.</p>
        </div>
        <div class="tasks-stats-strip">
          <div class="tasks-stat-chip${filter === "all" ? " active" : ""}" data-tools-filter="all">
            <span class="tasks-stat-chip-label">Total Tools</span>
            <span class="tasks-stat-chip-val">${totalCount}</span>
          </div>
          <div class="tasks-stat-chip${filter === "connected" ? " active" : ""}" data-tools-filter="connected">
            <span class="tasks-stat-dot success"></span>
            <span class="tasks-stat-chip-label">Connected</span>
            <span class="tasks-stat-chip-val">${connectedCount}</span>
          </div>
          <div class="tasks-stat-chip${filter === "available" ? " active" : ""}" data-tools-filter="available">
            <span class="tasks-stat-chip-label">Available</span>
            <span class="tasks-stat-chip-val">${availableCount}</span>
          </div>
        </div>
      </div>

      <div class="tasks-list-card">
        <div class="tasks-toolbar">
          <div class="tasks-search-wrap">
            <span class="tasks-search-icon">${icon("search")}</span>
            <input 
              type="text" 
              id="tools-search-input" 
              class="tasks-search-input" 
              placeholder="Search tools, features, or agents..." 
              value="${escapeHtml(state.toolsCatalog.search || "")}"
            />
            ${state.toolsCatalog.search ? `<button type="button" class="tasks-search-clear" id="tools-search-clear" aria-label="Clear">${icon("x")}</button>` : ""}
          </div>
          <div class="tasks-filter-pills">
            <button type="button" class="tasks-filter-pill${filter === "all" ? " active" : ""}" data-tools-filter="all">All (${totalCount})</button>
            <button type="button" class="tasks-filter-pill${filter === "connected" ? " active" : ""}" data-tools-filter="connected">
              ${connectedCount ? `<span class="tasks-pill-dot running" style="background:var(--success)"></span>` : ""}Connected (${connectedCount})
            </button>
            <button type="button" class="tasks-filter-pill${filter === "available" ? " active" : ""}" data-tools-filter="available">Available (${availableCount})</button>
          </div>
        </div>

        <div class="tasks-list-head-row">
          <div style="width:190px;flex-shrink:0;padding:0 12px">Tool / Capability</div>
          <div style="flex:1.2;min-width:0;padding:0 12px">Features & Details</div>
          <div style="width:180px;flex-shrink:0;padding:0 10px">Used By</div>
          <div style="width:110px;flex-shrink:0;padding:0 10px">Status</div>
          <div class="tasks-col-action" style="width:140px;justify-content:flex-end">Action</div>
        </div>

        <div class="tasks-items-list">
          ${
            filtered.length
              ? filtered
                  .map((t) => {
                    const statusClass = t.connected ? "success" : "running";
                    const statusLabel = t.connected ? "Connected" : "Available";
                    return `
              <div class="task-list-row tool-row">
                <div style="width:190px;flex-shrink:0;padding:0 12px;display:flex;align-items:center;gap:10px">
                  <span class="doc-file-icon" style="color:var(--accent)">${icon("wrench")}</span>
                  <span class="task-row-goal-text">${escapeHtml(t.label)}</span>
                </div>
                <div style="flex:1.2;min-width:0;padding:0 12px;overflow:hidden">
                  <span class="task-row-summary-text" style="margin-top:0">
                    ${(t.features || []).length ? escapeHtml((t.features || []).join(" · ")) : t.examplePrompt ? `"${escapeHtml(t.examplePrompt)}"` : "Tool capability"}
                  </span>
                </div>
                <div style="width:180px;flex-shrink:0;padding:0 10px;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
                  ${
                    (t.usedBy || []).length
                      ? t.usedBy
                          .map(
                            (u) => `
                        <span class="task-agent-badge" style="--badge-color:${deptColor(u)};font-size:10px;padding:2px 7px">
                          <span class="task-agent-dot"></span>
                          ${escapeHtml(deptLabel(u))}
                        </span>
                      `,
                          )
                          .join("")
                      : `<span class="stub-list-meta">All agents</span>`
                  }
                </div>
                <div style="width:110px;flex-shrink:0;padding:0 10px">
                  <span class="status-badge ${statusClass}" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600">
                    <span class="task-agent-dot" style="background:currentColor"></span>
                    ${statusLabel}
                  </span>
                </div>
                <div class="tasks-col-action" style="width:140px;gap:6px;justify-content:flex-end">
                  ${
                    t.connected
                      ? t.examplePrompt
                        ? `<button type="button" class="btn-secondary" style="font-size:11px;padding:4px 9px" data-tool-prompt="${escapeHtml(t.examplePrompt)}">Try prompt</button>`
                        : `<button type="button" class="btn-secondary" style="font-size:11px;padding:4px 9px" data-goto-chat>Open Chat</button>`
                      : `<button type="button" class="btn-primary" style="font-size:11px;padding:4px 10px" data-goto-accounts>Connect</button>`
                  }
                </div>
              </div>
            `;
                  })
                  .join("")
              : `
              <div class="tasks-empty-state">
                <div class="tasks-empty-icon">${icon("wrench")}</div>
                <div class="tasks-empty-title">No tools match</div>
                <p class="tasks-empty-text">Try adjusting your search query or filter.</p>
              </div>
            `
          }
        </div>
      </div>
    </div>
  `;
};

VIEW_ATTACHERS.push(function attachToolsHandlers() {
  const searchInput = document.getElementById("tools-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.toolsCatalog.search = e.target.value;
      render();
      const el = document.getElementById("tools-search-input");
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }
  document.getElementById("tools-search-clear")?.addEventListener("click", () => {
    state.toolsCatalog.search = "";
    render();
  });

  document.querySelectorAll("[data-tools-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.toolsCatalog.filter = btn.dataset.toolsFilter;
      render();
    });
  });

  document.querySelectorAll("[data-goto-accounts]").forEach((btn) => {
    btn.addEventListener("click", () => switchView("accounts"));
  });

  document.querySelectorAll("[data-goto-chat]").forEach((btn) => {
    btn.addEventListener("click", () => switchView("chat"));
  });

  document.querySelectorAll("[data-tool-prompt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchView("chat");
      const composer = document.getElementById("chat-composer-input") || document.getElementById("composer-input");
      if (composer) {
        composer.value = btn.dataset.toolPrompt;
        composer.focus();
      }
    });
  });
});
