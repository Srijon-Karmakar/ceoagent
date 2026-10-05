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

async function loadMemoryEntries(force) {
  if (state.memoryBrowse.loaded && !force) return;
  state.memoryBrowse.loading = true;
  render();
  try {
    state.memoryBrowse.entries = await fetchJSON("/api/memory");
    state.memoryBrowse.loaded = true;
    state.memoryBrowse.error = null;
  } catch (err) {
    state.memoryBrowse.error = err instanceof Error ? err.message : String(err);
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
  const entries = state.memoryBrowse.entries.filter((e) => !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Knowledge</h1>
        <p class="stub-subtitle">Permanent, cross-agent memory — tell any agent something once and every agent remembers it.</p>
      </div>
      <div class="toolbar">
        <input type="text" class="toolbar-search" id="memory-search" placeholder="Search memory…" value="${escapeHtml(state.memoryBrowse.search)}" />
        <span class="toolbar-spacer"></span>
        <button type="button" class="btn-primary" id="memory-add-btn">${icon("plus")} Add manually</button>
      </div>
      ${
        entries.length
          ? entries
              .map((e) => {
                const preview = e.content.length > 160 ? `${e.content.slice(0, 160)}…` : e.content;
                return `
            <div class="stub-list-row memory-card" data-open-memory="${e.id}" style="cursor:pointer;align-items:flex-start">
              <span class="memory-card-body">
                <span class="stub-list-title" style="display:block">${escapeHtml(e.title)} <span class="owner-badge ${e.owner}">${e.owner === "agent" ? "Memory chat" : "Manual"}</span></span>
                <span class="memory-card-preview">${escapeHtml(preview)}</span>
                <span class="stub-list-meta">Updated ${formatRelativeTime(e.updatedAt)}</span>
              </span>
              <button type="button" class="row-icon-btn row-delete-btn" data-delete-memory="${e.id}" aria-label="Delete">${icon("trash-2")}</button>
            </div>
          `;
              })
              .join("")
          : `<div class="stub-placeholder">${q ? "No matches." : "Nothing stored in memory yet."}</div>`
      }
    </div>
  `;
}

function renderMemoryDetail(entry) {
  const previewMode = state.memoryBrowse.previewMode !== "edit";
  return `
    <button type="button" class="card-link chat-back" id="memory-back-btn">${icon("chevron-left")} Back to Knowledge</button>
    <div class="card">
      <input type="text" class="note-title-input" id="memory-title-input" value="${escapeHtml(entry.title)}" />
      <div class="toolbar" style="margin:10px 0">
        <button type="button" class="page-tab${previewMode ? " active" : ""}" data-memory-mode="preview">Preview</button>
        <button type="button" class="page-tab${!previewMode ? " active" : ""}" data-memory-mode="edit">Edit</button>
        <span class="toolbar-spacer"></span>
        <button type="button" class="btn-secondary" id="memory-save-btn">Save</button>
        <button type="button" class="row-icon-btn row-delete-btn" id="memory-delete-btn" aria-label="Delete">${icon("trash-2")}</button>
      </div>
      ${
        previewMode
          ? `<div class="chat-msg-text">${renderMarkdown(entry.content || "*Empty*")}</div>`
          : `<textarea id="memory-content-input" rows="14" style="width:100%">${escapeHtml(entry.content || "")}</textarea>`
      }
    </div>
  `;
}

VIEW_ATTACHERS.push(function attachMemoryHandlers() {
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
