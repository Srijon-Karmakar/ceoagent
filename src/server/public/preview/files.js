"use strict";

// Files — browses the same three virtual roots production's VS Code-style
// tree does (Company Data / Deliverables / Agent Files), via the same
// path-validated /api/files/* endpoints. Simplified to breadcrumb
// single-pane navigation rather than an in-place expand/collapse tree —
// still fully functional (browse/preview/upload/new folder/delete), just a
// simpler interaction than production's tree widget.

const PREVIEWABLE_IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
const PREVIEWABLE_TEXT = [".md", ".txt", ".csv", ".json", ".js", ".ts", ".html", ".css", ".log", ".yml", ".yaml"];

state.files = {
  path: "",
  entries: [],
  loading: false,
  error: null,
  preview: null, // { kind: "image"|"pdf"|"text"|"markdown"|"none", url?, text?, name }
  uploading: false,
};

const DEFAULT_FILES_PREVIEW = [
  { name: "Deliverables", type: "dir", path: "Deliverables", size: 0 },
  { name: "Brand Assets", type: "dir", path: "Brand Assets", size: 0 },
  { name: "market_research_2026.pdf", type: "file", path: "market_research_2026.pdf", size: 2450000 },
  { name: "series_a_financial_model.xlsx", type: "file", path: "series_a_financial_model.xlsx", size: 1120000 },
  { name: "company_overview.md", type: "file", path: "company_overview.md", size: 14200 },
  { name: "architecture_diagram.png", type: "file", path: "architecture_diagram.png", size: 840000 },
];

async function loadFilesDir(path, force) {
  if (state.files.path === path && state.files.entries.length && !force) return;
  state.files.loading = true;
  state.files.path = path;
  state.files.preview = null;
  render();
  try {
    const result = await fetchJSON(`/api/files/list?path=${encodeURIComponent(path)}`);
    state.files.entries = result.entries;
    state.files.error = null;
  } catch (err) {
    if (String(err).includes("Not signed in") || String(err).includes("401")) {
      state.files.entries = DEFAULT_FILES_PREVIEW;
      state.files.error = null;
    } else {
      state.files.error = err instanceof Error ? err.message : String(err);
    }
  }
  state.files.loading = false;
  render();
}
LAZY_LOADERS.files = () => loadFilesDir("", false);

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function openFilePreview(entry) {
  const ext = extOf(entry.name);
  const rawUrl = `/api/files/raw?path=${encodeURIComponent(entry.path)}`;
  if (PREVIEWABLE_IMAGE.includes(ext)) {
    state.files.preview = { kind: "image", url: rawUrl, name: entry.name };
    render();
    return;
  }
  if (ext === ".pdf") {
    state.files.preview = { kind: "pdf", url: rawUrl, name: entry.name };
    render();
    return;
  }
  if (PREVIEWABLE_TEXT.includes(ext) && (entry.size ?? 0) <= 2 * 1024 * 1024) {
    state.files.preview = { kind: "loading", name: entry.name };
    render();
    try {
      const res = await fetch(rawUrl);
      const text = await res.text();
      state.files.preview = { kind: ext === ".md" ? "markdown" : "text", text, name: entry.name };
    } catch {
      state.files.preview = { kind: "none", name: entry.name, url: rawUrl };
    }
    render();
    return;
  }
  state.files.preview = { kind: "none", name: entry.name, url: rawUrl };
  render();
}

// ---------- render ----------

VIEW_RENDERERS.files = function renderFilesPage() {
  const crumbs = state.files.path ? state.files.path.split("/") : [];
  const entries = state.files.entries || [];
  return `
    <div class="tasks-page files-page">
      <div class="tasks-header">
        <div class="tasks-header-title-col">
          <div class="tasks-eyebrow">📁 Sandboxed Storage</div>
          <h1 class="tasks-title">Files <span class="tasks-count-pill">${entries.length}</span></h1>
          <p class="tasks-subtitle">Company assets, deliverables, and file storage accessible by your autonomous agent workforce.</p>
        </div>
      </div>

      <div class="files-layout">
        <div class="tasks-list-card files-list-card">
          <div class="tasks-toolbar">
            <div class="breadcrumbs" style="flex:1;overflow:hidden">
              <button type="button" data-files-nav="" class="breadcrumb-item${!state.files.path ? " active" : ""}">Root</button>
              ${crumbs
                .map((seg, i) => {
                  const path = crumbs.slice(0, i + 1).join("/");
                  return `<span class="breadcrumb-sep">/</span><button type="button" data-files-nav="${escapeHtml(path)}" class="breadcrumb-item${path === state.files.path ? " active" : ""}">${escapeHtml(seg)}</button>`;
                })
                .join("")}
            </div>
            ${
              state.files.path
                ? `<div style="display:flex;gap:6px;align-items:center">
                     <button type="button" class="btn-secondary" style="font-size:11.5px;padding:4px 9px" id="files-mkdir-btn">${icon("folder-plus")} New folder</button>
                     <input type="file" id="files-upload-input" multiple hidden />
                     <button type="button" class="btn-primary" style="font-size:11.5px;padding:4px 10px" id="files-upload-btn" ${state.files.uploading ? "disabled" : ""}>${state.files.uploading ? "Uploading…" : `${icon("upload")} Upload`}</button>
                   </div>`
                : ""
            }
          </div>

          <div class="tasks-list-head-row">
            <div style="flex:1;min-width:0;padding:0 12px">Name</div>
            <div style="width:100px;flex-shrink:0;padding:0 10px">Type</div>
            <div style="width:90px;flex-shrink:0;padding:0 10px;text-align:right">Size</div>
            <div class="tasks-col-action" style="width:40px;justify-content:flex-end"></div>
          </div>

          <div class="tasks-items-list">
            ${
              state.files.loading
                ? `<div class="card-empty">Loading directory…</div>`
                : state.files.error
                  ? `<div class="card-empty">${escapeHtml(state.files.error)}</div>`
                  : entries.length
                    ? entries
                        .map(
                          (e) => `
                  <div class="task-list-row file-row" data-files-open="${escapeHtml(e.path)}" data-files-type="${e.type}">
                    <div style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:0 12px">
                      <span class="doc-file-icon" style="color:${e.type === "dir" ? "var(--accent)" : "var(--text-muted)"}">${icon(e.type === "dir" ? "folder" : "file-text")}</span>
                      <span class="task-row-goal-text">${escapeHtml(e.name)}</span>
                    </div>
                    <div style="width:100px;flex-shrink:0;padding:0 10px">
                      <span class="stub-list-meta" style="font-weight:600">${e.type === "dir" ? "Directory" : "File"}</span>
                    </div>
                    <div style="width:90px;flex-shrink:0;padding:0 10px;text-align:right">
                      <span class="task-time-text">${e.type === "file" ? formatSize(e.size) : "—"}</span>
                    </div>
                    <div class="tasks-col-action" style="width:40px;justify-content:flex-end">
                      ${
                        state.files.path
                          ? `<button type="button" class="row-icon-btn row-delete-btn" data-files-delete="${escapeHtml(e.path)}" aria-label="Delete">${icon("trash-2")}</button>`
                          : `<span class="task-open-arrow">${icon("chevron-right")}</span>`
                      }
                    </div>
                  </div>
                `,
                        )
                        .join("")
                    : `
                    <div class="tasks-empty-state">
                      <div class="tasks-empty-icon">${icon("folder")}</div>
                      <div class="tasks-empty-title">Folder is empty</div>
                      <p class="tasks-empty-text">Upload documents or create subfolders here.</p>
                    </div>
                  `
            }
          </div>
        </div>
        <div class="tasks-list-card files-preview-card" style="padding:16px">${renderFilePreview()}</div>
      </div>
    </div>
  `;
};

function renderFilePreview() {
  const p = state.files.preview;
  if (!p) return `<div class="card-empty">Select a file from the list to preview it.</div>`;
  if (p.kind === "loading") return `<div class="card-empty">Loading file preview…</div>`;
  if (p.kind === "image") return `<div class="file-preview-head" style="font-weight:700;margin-bottom:12px">${escapeHtml(p.name)}</div><img src="${p.url}" class="file-preview-image" alt="${escapeHtml(p.name)}" style="border-radius:10px;max-width:100%" />`;
  if (p.kind === "pdf") return `<div class="file-preview-head" style="font-weight:700;margin-bottom:12px">${escapeHtml(p.name)}</div><iframe src="${p.url}" class="file-preview-pdf" title="${escapeHtml(p.name)}" style="border-radius:10px;width:100%;height:450px;border:none"></iframe>`;
  if (p.kind === "markdown") return `<div class="file-preview-head" style="font-weight:700;margin-bottom:12px">${escapeHtml(p.name)}</div><div class="chat-msg-text" style="padding:12px;background:rgba(255,255,255,0.4);border-radius:10px">${renderMarkdown(p.text)}</div>`;
  if (p.kind === "text") return `<div class="file-preview-head" style="font-weight:700;margin-bottom:12px">${escapeHtml(p.name)}</div><pre class="file-preview-text" style="padding:12px;background:rgba(255,255,255,0.4);border-radius:10px;font-size:12px;overflow-x:auto">${escapeHtml(p.text)}</pre>`;
  return `<div class="file-preview-head" style="font-weight:700;margin-bottom:12px">${escapeHtml(p.name)}</div><p class="card-empty">No inline preview for this file type.</p><a class="btn-secondary" href="${p.url}&download=1">Download</a>`;
}

// ---------- attach ----------

VIEW_ATTACHERS.push(function attachFilesHandlers() {
  document.querySelectorAll("[data-files-nav]").forEach((btn) => {
    btn.addEventListener("click", () => loadFilesDir(btn.dataset.filesNav, true));
  });
  document.querySelectorAll("[data-files-open]").forEach((row) => {
    row.addEventListener("click", () => {
      const path = row.dataset.filesOpen;
      if (row.dataset.filesType === "dir") loadFilesDir(path, true);
      else {
        const entry = state.files.entries.find((e) => e.path === path);
        if (entry) openFilePreview(entry);
      }
    });
  });
  document.querySelectorAll("[data-files-delete]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = btn.dataset.filesDelete;
      const entry = state.files.entries.find((x) => x.path === path);
      if (!entry) return;
      openConfirmModal({
        title: `Delete "${entry.name}"?`,
        message: entry.type === "dir" ? "This folder and everything inside it will be permanently removed." : "This file will be permanently removed.",
        requireText: entry.name,
        onConfirm: async () => {
          await fetchJSON(`/api/files/entry?path=${encodeURIComponent(path)}`, { method: "DELETE" });
          await loadFilesDir(state.files.path, true);
          showToast("Deleted.");
        },
      });
    });
  });
  document.getElementById("files-mkdir-btn")?.addEventListener("click", () => {
    let name = "";
    const renderer = () => `
      <div class="modal-head"><h2>New folder</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
      <div class="modal-body"><label class="form-full">Folder name<input type="text" id="mkdir-name-input" value="${escapeHtml(name)}" autofocus /></label></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
        <button type="button" class="btn-primary" id="mkdir-create-btn">Create</button>
      </div>
    `;
    modalAttach = () => {
      document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
      document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
      document.getElementById("mkdir-name-input")?.addEventListener("input", (e) => (name = e.target.value));
      document.getElementById("mkdir-create-btn")?.addEventListener("click", async () => {
        if (!name.trim()) return;
        try {
          await fetchJSON("/api/files/mkdir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: state.files.path, name: name.trim() }) });
          closeModal();
          await loadFilesDir(state.files.path, true);
        } catch (err) {
          showToast(err instanceof Error ? err.message : String(err));
        }
      });
    };
    openModal(renderer);
  });
  document.getElementById("files-upload-btn")?.addEventListener("click", () => document.getElementById("files-upload-input")?.click());
  document.getElementById("files-upload-input")?.addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    state.files.uploading = true;
    render();
    try {
      const formData = new FormData();
      formData.append("path", state.files.path);
      for (const f of files) formData.append("files", f);
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Upload failed (${res.status})`);
      await loadFilesDir(state.files.path, true);
      showToast("Uploaded.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
    state.files.uploading = false;
    render();
  });
});
