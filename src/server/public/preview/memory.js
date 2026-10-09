"use strict";

// Knowledge (Memory) — full browse view: list, search, add manually,
// inline preview/edit drill-down (same pattern as Portfolio Notes), guarded
// delete. The "guarded" delete (type the title to confirm) is purely a
// client-side UX convention in production — the server has no confirmation
// check of its own — so openConfirmModal's requireText option reproduces it
// faithfully rather than inventing a different delete flow.

state.memoryBrowse = {
  entries: [],
  loaded: false,
  loading: false,
  error: null,
  search: "",
  selectedId: null,
  previewMode: "preview",
};

const DEFAULT_MEMORY_PREVIEW = [
  { id: "mem-1", title: "Company ICP & Core Customer Profile", content: "Target customers are seed-to-series-B founders, technical CEOs, and solo-operators scaling B2B SaaS applications.", owner: "agent", updatedAt: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: "mem-2", title: "Brand Voice & Tone Guidelines", content: "Concise, visionary, premium, authoritative yet accessible. Avoid corporate jargon; use direct active voice.", owner: "agent", updatedAt: new Date(Date.now() - 3600000 * 14).toISOString() },
  { id: "mem-3", title: "Pricing Tiers & Token Allowances", content: "Starter ($49/mo, 100k tokens), Pro ($199/mo, 1M tokens), Enterprise ($999/mo, dedicated models & custom agents).", owner: "manual", updatedAt: new Date(Date.now() - 86400000 * 3).toISOString() },
  { id: "mem-4", title: "Core Tech Stack Principles", content: "Node.js/TypeScript backend, vanilla CSS with custom design system tokens, Three.js/WebGL background animations, SQLite/PostgreSQL storage.", owner: "manual", updatedAt: new Date(Date.now() - 86400000 * 7).toISOString() },
];

async function loadMemoryEntries(force) {
  if (state.memoryBrowse.loaded && !force) return;
  state.memoryBrowse.loading = true;
  render();
  try {
    state.memoryBrowse.entries = await fetchJSON("/api/memory");
    state.memoryBrowse.loaded = true;
    state.memoryBrowse.error = null;
  } catch (err) {
    if (String(err).includes("Not signed in") || String(err).includes("401")) {
      state.memoryBrowse.entries = DEFAULT_MEMORY_PREVIEW;
      state.memoryBrowse.loaded = true;
      state.memoryBrowse.error = null;
    } else {
      state.memoryBrowse.error = err instanceof Error ? err.message : String(err);
    }
  }
  state.memoryBrowse.loading = false;
  render();
}
LAZY_LOADERS.knowledge = () => loadMemoryEntries(false);

VIEW_RENDERERS.knowledge = function renderKnowledgePage() {
  if (state.memoryBrowse.loading && !state.memoryBrowse.loaded) return `<div class="stub-placeholder">Loading memory…</div>`;
  if (state.memoryBrowse.error) return `<div class="stub-placeholder">Couldn't load memory: ${escapeHtml(state.memoryBrowse.error)}</div>`;
  if (state.memoryBrowse.selectedId) {
    const entry = state.memoryBrowse.entries.find((e) => e.id === state.memoryBrowse.selectedId);
    if (entry) return renderMemoryDetail(entry);
  }
  return renderMemoryList();
};

function renderMemoryList() {
  const q = state.memoryBrowse.search.trim().toLowerCase();
  const allEntries = state.memoryBrowse.entries || [];
  const entries = allEntries.filter((e) => !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));

  return `
    <div class="tasks-page knowledge-page">
      <div class="tasks-header">
        <div class="tasks-header-title-col">
          <div class="tasks-eyebrow">💡 Agent Memory</div>
          <h1 class="tasks-title">Knowledge <span class="tasks-count-pill">${allEntries.length}</span></h1>
          <p class="tasks-subtitle">Permanent, cross-agent memory — shared recall across your entire workforce.</p>
        </div>
      </div>

      <div class="tasks-list-card">
        <div class="tasks-toolbar">
          <div class="tasks-search-wrap">
            <span class="tasks-search-icon">${icon("search")}</span>
            <input 
              type="text" 
              class="tasks-search-input" 
              id="memory-search" 
              placeholder="Search knowledge by topic or content…" 
              value="${escapeHtml(state.memoryBrowse.search)}" 
            />
            ${state.memoryBrowse.search ? `<button type="button" class="tasks-search-clear" id="memory-search-clear" aria-label="Clear">${icon("x")}</button>` : ""}
          </div>
          <button type="button" class="btn-primary" id="memory-add-btn">${icon("plus")} Add manually</button>
        </div>

        <div class="tasks-list-head-row">
          <div class="tasks-col-status">Source</div>
          <div class="tasks-col-goal">Topic / Title</div>
          <div style="flex:1.5;min-width:0;padding:0 12px">Content Preview</div>
          <div class="tasks-col-time">Updated</div>
          <div class="tasks-col-action" style="width:70px;justify-content:flex-end">Actions</div>
        </div>

        <div class="tasks-items-list">
          ${
            entries.length
              ? entries
                  .map((e) => {
                    const preview = e.content.length > 140 ? `${e.content.slice(0, 140)}…` : e.content;
                    return `
              <div class="task-list-row memory-row" data-open-memory="${e.id}">
                <div class="tasks-col-status">
                  <span class="owner-badge ${e.owner}" style="margin:0">${e.owner === "agent" ? "Agent" : "Manual"}</span>
                </div>
                <div class="tasks-col-goal">
                  <span class="task-row-goal-text">${escapeHtml(e.title)}</span>
                </div>
                <div style="flex:1.5;min-width:0;padding:0 12px;overflow:hidden">
                  <span class="task-row-summary-text" style="margin-top:0">${escapeHtml(preview || "—")}</span>
                </div>
                <div class="tasks-col-time">
                  <span class="task-time-text">${formatRelativeTime(e.updatedAt)}</span>
                </div>
                <div class="tasks-col-action" style="width:70px;gap:6px;justify-content:flex-end">
                  <button type="button" class="row-icon-btn row-delete-btn" data-delete-memory="${e.id}" aria-label="Delete">${icon("trash-2")}</button>
                  <span class="task-open-arrow">${icon("chevron-right")}</span>
                </div>
              </div>
            `;
                  })
                  .join("")
              : `
              <div class="tasks-empty-state">
                <div class="tasks-empty-icon">${icon("lightbulb")}</div>
                <div class="tasks-empty-title">${q ? "No matching knowledge entries" : "No memories stored yet"}</div>
                <p class="tasks-empty-text">${q ? "Try searching for a different phrase or keyword." : "Add facts, business preferences, or guidance manually, or ask agents to remember them in chat."}</p>
              </div>
            `
          }
        </div>
      </div>
    </div>
  `;
}

function renderMemoryDetail(entry) {
  const previewMode = state.memoryBrowse.previewMode !== "edit";
  return `
    <div class="tasks-page knowledge-page">
      <div style="margin-bottom:8px">
        <button type="button" class="card-link chat-back" id="memory-back-btn">${icon("chevron-left")} Back to Knowledge</button>
      </div>
      <div class="tasks-list-card" style="padding:24px">
        <input type="text" class="note-title-input" id="memory-title-input" value="${escapeHtml(entry.title)}" style="font-size:20px;font-weight:700;margin-bottom:12px" />
        <div class="tasks-toolbar" style="margin-bottom:16px;border-radius:12px;border:1px solid rgba(0,0,0,0.06)">
          <div class="page-tabs" style="margin:0">
            <button type="button" class="page-tab${previewMode ? " active" : ""}" data-memory-mode="preview">Preview</button>
            <button type="button" class="page-tab${!previewMode ? " active" : ""}" data-memory-mode="edit">Edit</button>
          </div>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button type="button" class="btn-primary" id="memory-save-btn">Save changes</button>
            <button type="button" class="row-icon-btn row-delete-btn" id="memory-delete-btn" aria-label="Delete">${icon("trash-2")}</button>
          </div>
        </div>
        ${
          previewMode
            ? `<div class="chat-msg-text" style="padding:14px;background:rgba(255,255,255,0.4);border-radius:12px;border:1px solid rgba(0,0,0,0.04)">${renderMarkdown(entry.content || "*Empty*")}</div>`
            : `<textarea id="memory-content-input" rows="14" style="width:100%;border-radius:12px;padding:14px;border:1px solid rgba(0,0,0,0.08);background:rgba(255,255,255,0.7);color:var(--text);font-family:inherit;font-size:13px">${escapeHtml(entry.content || "")}</textarea>`
        }
      </div>
    </div>
  `;
}

VIEW_ATTACHERS.push(function attachMemoryHandlers() {
  document.getElementById("memory-search-clear")?.addEventListener("click", () => {
    state.memoryBrowse.search = "";
    render();
  });
  document.getElementById("memory-search")?.addEventListener("input", (e) => {
    const cursor = e.target.selectionStart;
    state.memoryBrowse.search = e.target.value;
    render();
    const el = document.getElementById("memory-search");
    if (el) {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    }
  });
  document.getElementById("memory-add-btn")?.addEventListener("click", async () => {
    try {
      const entry = await fetchJSON("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled memory", content: "" }),
      });
      await loadMemoryEntries(true);
      state.memoryBrowse.selectedId = entry.id;
      state.memoryBrowse.previewMode = "edit";
      render();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  });
  document.querySelectorAll("[data-open-memory]").forEach((el) => {
    el.addEventListener("click", () => {
      state.memoryBrowse.selectedId = el.dataset.openMemory;
      state.memoryBrowse.previewMode = "preview";
      render();
    });
  });
  document.querySelectorAll("[data-delete-memory]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const entry = state.memoryBrowse.entries.find((x) => x.id === btn.dataset.deleteMemory);
      if (!entry) return;
      openConfirmModal({
        title: "Delete this memory entry?",
        message: `"${entry.title}" will be permanently forgotten by every agent.`,
        requireText: entry.title,
        onConfirm: async () => {
          await fetchJSON(`/api/memory/${entry.id}`, { method: "DELETE" });
          await loadMemoryEntries(true);
          showToast("Deleted.");
        },
      });
    });
  });

  document.getElementById("memory-back-btn")?.addEventListener("click", () => {
    state.memoryBrowse.selectedId = null;
    render();
  });
  document.querySelectorAll("[data-memory-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.memoryBrowse.previewMode = btn.dataset.memoryMode;
      render();
    });
  });
  document.getElementById("memory-title-input")?.addEventListener("input", (e) => {
    const entry = state.memoryBrowse.entries.find((x) => x.id === state.memoryBrowse.selectedId);
    if (entry) entry.title = e.target.value;
  });
  document.getElementById("memory-content-input")?.addEventListener("input", (e) => {
    const entry = state.memoryBrowse.entries.find((x) => x.id === state.memoryBrowse.selectedId);
    if (entry) entry.content = e.target.value;
  });
  document.getElementById("memory-save-btn")?.addEventListener("click", async () => {
    const entry = state.memoryBrowse.entries.find((x) => x.id === state.memoryBrowse.selectedId);
    if (!entry) return;
    try {
      await fetchJSON(`/api/memory/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: entry.title, content: entry.content }),
      });
      showToast("Saved.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  });
  document.getElementById("memory-delete-btn")?.addEventListener("click", () => {
    const entry = state.memoryBrowse.entries.find((x) => x.id === state.memoryBrowse.selectedId);
    if (!entry) return;
    openConfirmModal({
      title: "Delete this memory entry?",
      message: `"${entry.title}" will be permanently forgotten by every agent.`,
      requireText: entry.title,
      onConfirm: async () => {
        await fetchJSON(`/api/memory/${entry.id}`, { method: "DELETE" });
        state.memoryBrowse.selectedId = null;
        await loadMemoryEntries(true);
        showToast("Deleted.");
      },
    });
  });
});
