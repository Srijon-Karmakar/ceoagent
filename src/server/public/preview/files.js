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
    state.files.error = err instanceof Error ? err.message : String(err);
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
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Files</h1>
        <p class="stub-subtitle">Company Data, Deliverables, and Agent Files — the same sandboxed folders your agents can read/write.</p>
      </div>
      <div class="toolbar">
        <div class="breadcrumbs">
          <button type="button" data-files-nav="" class="breadcrumb-item${!state.files.path ? " active" : ""}">Root</button>
          ${crumbs
            .map((seg, i) => {
              const path = crumbs.slice(0, i + 1).join("/");
              return `<span class="breadcrumb-sep">/</span><button type="button" data-files-nav="${escapeHtml(path)}" class="breadcrumb-item${path === state.files.path ? " active" : ""}">${escapeHtml(seg)}</button>`;
            })
            .join("")}
        </div>
        <span class="toolbar-spacer"></span>
        ${
          state.files.path
            ? `<button type="button" class="btn-secondary" id="files-mkdir-btn">${icon("folder-plus")} New folder</button>
               <input type="file" id="files-upload-input" multiple hidden />
               <button type="button" class="btn-primary" id="files-upload-btn" ${state.files.uploading ? "disabled" : ""}>${state.files.uploading ? "Uploading…" : `${icon("upload")} Upload`}</button>`
            : ""
        }
      </div>
      <div class="files-layout">
        <div class="card files-list-card">
          ${
            state.files.loading
              ? `<div class="card-empty">Loading…</div>`
              : state.files.error
                ? `<div class="card-empty">${escapeHtml(state.files.error)}</div>`
                : state.files.entries.length
                  ? state.files.entries
                      .map(
                        (e) => `
                <div class="file-row" data-files-open="${escapeHtml(e.path)}" data-files-type="${e.type}">
                  ${icon(e.type === "dir" ? "folder" : "file")}
                  <span class="file-row-name">${escapeHtml(e.name)}</span>
                  <span class="file-row-meta">${e.type === "file" ? formatSize(e.size) : ""}</span>
                  ${
                    state.files.path
                      ? `<button type="button" class="row-icon-btn row-delete-btn" data-files-delete="${escapeHtml(e.path)}" aria-label="Delete">${icon("trash-2")}</button>`
                      : ""
                  }
                </div>
              `,
                      )
                      .join("")
                  : `<div class="card-empty">Empty folder.</div>`
          }
        </div>
        <div class="card files-preview-card">${renderFilePreview()}</div>
      </div>
    </div>
  `;
};

function renderFilePreview() {
  const p = state.files.preview;
  if (!p) return `<div class="card-empty">Select a file to preview it.</div>`;
  if (p.kind === "loading") return `<div class="card-empty">Loading preview…</div>`;
  if (p.kind === "image") return `<div class="file-preview-head">${escapeHtml(p.name)}</div><img src="${p.url}" class="file-preview-image" alt="${escapeHtml(p.name)}" />`;
  if (p.kind === "pdf") return `<div class="file-preview-head">${escapeHtml(p.name)}</div><iframe src="${p.url}" class="file-preview-pdf" title="${escapeHtml(p.name)}"></iframe>`;
  if (p.kind === "markdown") return `<div class="file-preview-head">${escapeHtml(p.name)}</div><div class="chat-msg-text">${renderMarkdown(p.text)}</div>`;
  if (p.kind === "text") return `<div class="file-preview-head">${escapeHtml(p.name)}</div><pre class="file-preview-text">${escapeHtml(p.text)}</pre>`;
  return `<div class="file-preview-head">${escapeHtml(p.name)}</div><p class="card-empty">No inline preview for this file type.</p><a class="btn-secondary" href="${p.url}&download=1">Download</a>`;
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
