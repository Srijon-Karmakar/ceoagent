"use strict";

// Portfolio — projects, each with category-tabbed entries (Blog/Article/
// Collab/PR post/Email) and a separate freeform Notes system.

const PORTFOLIO_CATEGORIES = ["blog", "article", "collab", "pr-post", "email"];
const PORTFOLIO_CATEGORY_LABELS = { blog: "Blog", article: "Article", collab: "Collab", "pr-post": "PR Post", email: "Email" };
const PORTFOLIO_ENTRY_STATUSES = ["draft", "published"];
const PORTFOLIO_NOTE_TABS = ["project-details", "database"];
const PORTFOLIO_NOTE_TAB_LABELS = { "project-details": "Project Details", database: "Database" };
const PORTFOLIO_ENTRY_CSV_COLUMNS = ["title", "category", "status", "date", "subject", "recipient", "messageId", "link", "notes", "owner", "agentKey", "createdAt"].map((key) => ({
  label: key,
  get: (row) => row[key],
}));

state.portfolio = {
  projects: [],
  entries: [],
  notes: [],
  loaded: false,
  loading: false,
  error: null,
  selectedProjectId: null,
  mode: "entries", // entries | notes
  categoryTab: "blog",
  noteTab: "project-details",
  selectedNoteId: null,
  notePreviewMode: "preview",
};

async function loadPortfolioData(force) {
  if (state.portfolio.loaded && !force) return;
  state.portfolio.loading = true;
  render();
  try {
    const [projects, entries, notes] = await Promise.all([
      fetchJSON("/api/portfolio/projects"),
      fetchJSON("/api/portfolio/entries"),
      fetchJSON("/api/portfolio/notes"),
    ]);
    state.portfolio.projects = projects;
    state.portfolio.entries = entries;
    state.portfolio.notes = notes;
    state.portfolio.loaded = true;
    state.portfolio.error = null;
  } catch (err) {
    state.portfolio.error = err instanceof Error ? err.message : String(err);
  }
  state.portfolio.loading = false;
  render();
}
LAZY_LOADERS.portfolio = () => loadPortfolioData(false);

function selectedProject() {
  return state.portfolio.projects.find((p) => p.id === state.portfolio.selectedProjectId) || null;
}

// ---------- render ----------

VIEW_RENDERERS.portfolio = function renderPortfolioPage() {
  if (state.portfolio.loading && !state.portfolio.loaded) return `<div class="stub-placeholder">Loading portfolio…</div>`;
  if (state.portfolio.error) return `<div class="stub-placeholder">Couldn't load portfolio: ${escapeHtml(state.portfolio.error)}</div>`;
  const project = selectedProject();
  return project ? renderProjectDetail(project) : renderProjectsList();
};

function renderProjectsList() {
  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Portfolio</h1>
        <p class="stub-subtitle">Projects your agents produce deliverables against.</p>
      </div>
      <div class="toolbar">
        <span class="toolbar-spacer"></span>
        <button type="button" class="btn-primary" id="portfolio-new-project-btn">${icon("plus")} New Project</button>
      </div>
      ${
        state.portfolio.projects.length
          ? state.portfolio.projects
              .map((p) => {
                const count = state.portfolio.entries.filter((e) => e.projectId === p.id).length;
                return `
            <div class="stub-list-row" data-open-project="${p.id}" style="cursor:pointer">
              <span class="stub-list-title">${escapeHtml(p.name)}</span>
              <span class="stub-list-meta">${count} entr${count === 1 ? "y" : "ies"}</span>
              <button type="button" class="row-icon-btn" data-rename-project="${p.id}" aria-label="Rename">${icon("pencil")}</button>
              <button type="button" class="row-icon-btn row-delete-btn" data-delete-project="${p.id}" aria-label="Delete">${icon("trash-2")}</button>
            </div>
          `;
              })
              .join("")
          : `<div class="stub-placeholder">No projects yet.</div>`
      }
    </div>
  `;
}

function renderProjectDetail(project) {
  const mode = state.portfolio.mode;
  return `
    <div class="stub-page">
      <button type="button" class="card-link chat-back" id="portfolio-back-btn">${icon("chevron-left")} Back to Portfolio</button>
      <div class="stub-head"><h1 class="stub-title">${escapeHtml(project.name)}</h1></div>
      <div class="page-tabs">
        ${PORTFOLIO_CATEGORIES.map(
          (c) => `<button type="button" class="page-tab${mode === "entries" && state.portfolio.categoryTab === c ? " active" : ""}" data-portfolio-cat="${c}">${PORTFOLIO_CATEGORY_LABELS[c]}</button>`,
        ).join("")}
        <button type="button" class="page-tab${mode === "notes" ? " active" : ""}" data-portfolio-mode="notes">Notes</button>
      </div>
      ${mode === "entries" ? renderPortfolioEntries(project) : renderPortfolioNotes(project)}
    </div>
  `;
}

function renderPortfolioEntries(project) {
  const entries = state.portfolio.entries.filter((e) => e.projectId === project.id && e.category === state.portfolio.categoryTab);
  const isEmail = state.portfolio.categoryTab === "email";
  return `
    <div class="toolbar">
      <span class="toolbar-spacer"></span>
      <button type="button" class="btn-secondary" id="portfolio-export-btn">${icon("download")} Export CSV</button>
      <button type="button" class="btn-primary" id="portfolio-new-entry-btn">${icon("plus")} New Entry</button>
    </div>
    ${
      entries.length
        ? `<div class="data-table-wrap"><table class="data-table">
        <thead><tr><th>Title</th>${isEmail ? "<th>Recipient</th><th>Message ID</th>" : ""}<th>Status</th><th>Date</th><th>Owner</th><th></th></tr></thead>
        <tbody>
          ${entries
            .map(
              (e) => `
            <tr>
              <td>${e.link ? `<a href="${escapeHtml(e.link)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</td>
              ${isEmail ? `<td>${escapeHtml(e.recipient || "—")}</td><td>${escapeHtml(e.messageId || "—")}</td>` : ""}
              <td><span class="stage-pill stage-${e.status}">${e.status}</span></td>
              <td>${e.date ? formatDate(e.date) : "—"}</td>
              <td><span class="owner-badge ${e.owner}">${e.owner === "agent" ? deptLabel(e.agentKey) : "Manual"}</span></td>
              <td class="row-actions-cell">
                <button type="button" class="row-icon-btn" data-edit-entry="${e.id}" aria-label="Edit">${icon("pencil")}</button>
                <button type="button" class="row-icon-btn row-delete-btn" data-delete-entry="${e.id}" aria-label="Delete">${icon("trash-2")}</button>
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table></div>`
        : `<div class="stub-placeholder">No ${PORTFOLIO_CATEGORY_LABELS[state.portfolio.categoryTab].toLowerCase()} entries yet.</div>`
    }
  `;
}

function renderPortfolioNotes(project) {
  if (state.portfolio.selectedNoteId) {
    const note = state.portfolio.notes.find((n) => n.id === state.portfolio.selectedNoteId);
    if (note) return renderNoteDetail(note);
  }
  const tabs = `
    <div class="toolbar">
      ${PORTFOLIO_NOTE_TABS.map((t) => `<button type="button" class="chip-filter${state.portfolio.noteTab === t ? " active" : ""}" data-note-tab="${t}">${PORTFOLIO_NOTE_TAB_LABELS[t]}</button>`).join("")}
      <span class="toolbar-spacer"></span>
      <button type="button" class="btn-primary" id="portfolio-new-note-btn">${icon("plus")} New Note</button>
    </div>
  `;
  const notes = state.portfolio.notes.filter((n) => n.projectId === project.id && n.tab === state.portfolio.noteTab);
  return `
    ${tabs}
    ${
      notes.length
        ? notes
            .map(
              (n) => `
        <div class="stub-list-row" data-open-note="${n.id}" style="cursor:pointer">
          <span class="stub-list-title">${escapeHtml(n.title)}</span>
          <span class="stub-list-meta">${escapeHtml(deptLabel(n.agentKey) || "")} · ${formatRelativeTime(n.updatedAt)}</span>
        </div>
      `,
            )
            .join("")
        : `<div class="stub-placeholder">No notes yet.</div>`
    }
  `;
}

function renderNoteDetail(note) {
  const previewMode = state.portfolio.notePreviewMode !== "edit";
  return `
    <button type="button" class="card-link chat-back" id="note-back-btn">${icon("chevron-left")} Back to Notes</button>
    <div class="card">
      <input type="text" class="note-title-input" id="note-title-input" value="${escapeHtml(note.title)}" />
      <div class="toolbar" style="margin:10px 0">
        <button type="button" class="page-tab${previewMode ? " active" : ""}" data-note-mode="preview">Preview</button>
        <button type="button" class="page-tab${!previewMode ? " active" : ""}" data-note-mode="edit">Edit</button>
        <span class="toolbar-spacer"></span>
        <button type="button" class="btn-secondary" id="note-save-btn">Save</button>
        <button type="button" class="row-icon-btn row-delete-btn" id="note-delete-btn" aria-label="Delete">${icon("trash-2")}</button>
      </div>
      ${
        previewMode
          ? `<div class="chat-msg-text">${renderMarkdown(note.content || "*Empty*")}</div>`
          : `<textarea id="note-content-input" rows="14" style="width:100%">${escapeHtml(note.content || "")}</textarea>`
      }
    </div>
  `;
}

// ---------- modals ----------

function openProjectNameModal(project) {
  let name = project ? project.name : "";
  const renderer = () => `
    <div class="modal-head"><h2>${project ? "Rename project" : "New project"}</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body"><label class="form-full">Name<input type="text" id="project-name-input" value="${escapeHtml(name)}" autofocus /></label></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="project-save-btn">${project ? "Save" : "Create"}</button>
    </div>
  `;
  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.getElementById("project-name-input")?.addEventListener("input", (e) => (name = e.target.value));
    document.getElementById("project-save-btn")?.addEventListener("click", async () => {
      if (!name.trim()) return;
      try {
        if (project) await fetchJSON(`/api/portfolio/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
        else await fetchJSON("/api/portfolio/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
        closeModal();
        await loadPortfolioData(true);
        showToast(project ? "Renamed." : "Project created.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  };
  openModal(renderer);
}

function openEntryModal(project, entry) {
  const isNew = !entry;
  const isEmail = state.portfolio.categoryTab === "email";
  const form = entry
    ? { ...entry }
    : { title: "", category: state.portfolio.categoryTab, status: "draft", link: "", date: "", notes: "", recipient: "", subject: "", messageId: "" };
  const renderer = () => `
    <div class="modal-head"><h2>${isNew ? "New Entry" : "Edit Entry"}</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <label>Title<input type="text" data-entry-field="title" value="${escapeHtml(form.title)}" /></label>
        <label>Status
          <select data-entry-field="status">${PORTFOLIO_ENTRY_STATUSES.map((s) => `<option value="${s}"${s === form.status ? " selected" : ""}>${capitalize(s)}</option>`).join("")}</select>
        </label>
        <label>Date<input type="date" data-entry-field="date" value="${escapeHtml(form.date || "")}" /></label>
        <label>Link<input type="text" data-entry-field="link" value="${escapeHtml(form.link || "")}" /></label>
        ${
          isEmail
            ? `<label>Recipient<input type="text" data-entry-field="recipient" value="${escapeHtml(form.recipient || "")}" /></label>
               <label>Subject<input type="text" data-entry-field="subject" value="${escapeHtml(form.subject || "")}" /></label>
               <label>Message ID<input type="text" data-entry-field="messageId" value="${escapeHtml(form.messageId || "")}" /></label>`
            : ""
        }
      </div>
      <label class="form-full">Notes<textarea data-entry-field="notes" rows="3">${escapeHtml(form.notes || "")}</textarea></label>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="entry-save-btn">${isNew ? "Create" : "Save"}</button>
    </div>
  `;
  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.querySelectorAll("[data-entry-field]").forEach((el) => {
      el.addEventListener("input", (e) => (form[el.dataset.entryField] = e.target.value));
    });
    document.getElementById("entry-save-btn")?.addEventListener("click", async () => {
      if (!form.title.trim()) {
        showToast("Title is required.");
        return;
      }
      try {
        if (isNew) {
          await fetchJSON("/api/portfolio/entries", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...form, projectId: project.id, category: state.portfolio.categoryTab }),
          });
        } else {
          await fetchJSON(`/api/portfolio/entries/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
        }
        closeModal();
        await loadPortfolioData(true);
        showToast(isNew ? "Entry created." : "Entry saved.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  };
  openModal(renderer);
}

function openNoteCreateModal(project) {
  let title = "";
  const renderer = () => `
    <div class="modal-head"><h2>New note</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body"><label class="form-full">Title<input type="text" id="note-create-title" value="${escapeHtml(title)}" autofocus /></label></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="note-create-btn">Create</button>
    </div>
  `;
  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.getElementById("note-create-title")?.addEventListener("input", (e) => (title = e.target.value));
    document.getElementById("note-create-btn")?.addEventListener("click", async () => {
      if (!title.trim()) return;
      try {
        const note = await fetchJSON("/api/portfolio/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id, tab: state.portfolio.noteTab, title: title.trim() }),
        });
        closeModal();
        await loadPortfolioData(true);
        state.portfolio.selectedNoteId = note.id;
        state.portfolio.notePreviewMode = "edit";
        render();
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  };
  openModal(renderer);
}

// ---------- attach ----------

VIEW_ATTACHERS.push(function attachPortfolioHandlers() {
  document.querySelectorAll("[data-open-project]").forEach((el) => {
    el.addEventListener("click", () => {
      state.portfolio.selectedProjectId = el.dataset.openProject;
      state.portfolio.mode = "entries";
      state.portfolio.selectedNoteId = null;
      render();
    });
  });
  document.getElementById("portfolio-new-project-btn")?.addEventListener("click", () => openProjectNameModal(null));
  document.querySelectorAll("[data-rename-project]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = state.portfolio.projects.find((x) => x.id === btn.dataset.renameProject);
      if (p) openProjectNameModal(p);
    });
  });
  document.querySelectorAll("[data-delete-project]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = state.portfolio.projects.find((x) => x.id === btn.dataset.deleteProject);
      if (!p) return;
      openConfirmModal({
        title: "Delete this project?",
        message: `"${p.name}" and every entry/note inside it will be permanently removed.`,
        requireText: p.name,
        onConfirm: async () => {
          await fetchJSON(`/api/portfolio/projects/${p.id}`, { method: "DELETE" });
          await loadPortfolioData(true);
          showToast("Project deleted.");
        },
      });
    });
  });
  document.getElementById("portfolio-back-btn")?.addEventListener("click", () => {
    state.portfolio.selectedProjectId = null;
    render();
  });
  document.querySelectorAll("[data-portfolio-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.portfolio.mode = "entries";
      state.portfolio.categoryTab = btn.dataset.portfolioCat;
      render();
    });
  });
  document.querySelectorAll("[data-portfolio-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.portfolio.mode = btn.dataset.portfolioMode;
      render();
    });
  });
  document.getElementById("portfolio-new-entry-btn")?.addEventListener("click", () => {
    const p = selectedProject();
    if (p) openEntryModal(p, null);
  });
  document.querySelectorAll("[data-edit-entry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = state.portfolio.entries.find((e) => e.id === btn.dataset.editEntry);
      const p = selectedProject();
      if (entry && p) openEntryModal(p, entry);
    });
  });
  document.querySelectorAll("[data-delete-entry]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = state.portfolio.entries.find((e) => e.id === btn.dataset.deleteEntry);
      if (!entry) return;
      openConfirmModal({
        title: "Delete this entry?",
        message: `"${entry.title}" will be permanently removed.`,
        onConfirm: async () => {
          await fetchJSON(`/api/portfolio/entries/${entry.id}`, { method: "DELETE" });
          await loadPortfolioData(true);
          showToast("Deleted.");
        },
      });
    });
  });
  document.getElementById("portfolio-export-btn")?.addEventListener("click", () => {
    const p = selectedProject();
    if (!p) return;
    const rows = state.portfolio.entries.filter((e) => e.projectId === p.id && e.category === state.portfolio.categoryTab);
    downloadText(`${p.name}-${state.portfolio.categoryTab}.csv`, rowsToCSV(PORTFOLIO_ENTRY_CSV_COLUMNS, rows));
  });

  document.querySelectorAll("[data-note-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.portfolio.noteTab = btn.dataset.noteTab;
      render();
    });
  });
  document.getElementById("portfolio-new-note-btn")?.addEventListener("click", () => {
    const p = selectedProject();
    if (p) openNoteCreateModal(p);
  });
  document.querySelectorAll("[data-open-note]").forEach((el) => {
    el.addEventListener("click", () => {
      state.portfolio.selectedNoteId = el.dataset.openNote;
      state.portfolio.notePreviewMode = "preview";
      render();
    });
  });
  document.getElementById("note-back-btn")?.addEventListener("click", () => {
    state.portfolio.selectedNoteId = null;
    render();
  });
  document.querySelectorAll("[data-note-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.portfolio.notePreviewMode = btn.dataset.noteMode;
      render();
    });
  });
  document.getElementById("note-title-input")?.addEventListener("input", (e) => {
    const note = state.portfolio.notes.find((n) => n.id === state.portfolio.selectedNoteId);
    if (note) note.title = e.target.value;
  });
  document.getElementById("note-content-input")?.addEventListener("input", (e) => {
    const note = state.portfolio.notes.find((n) => n.id === state.portfolio.selectedNoteId);
    if (note) note.content = e.target.value;
  });
  document.getElementById("note-save-btn")?.addEventListener("click", async () => {
    const note = state.portfolio.notes.find((n) => n.id === state.portfolio.selectedNoteId);
    if (!note) return;
    try {
      await fetchJSON(`/api/portfolio/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: note.title, content: note.content }),
      });
      showToast("Note saved.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  });
  document.getElementById("note-delete-btn")?.addEventListener("click", () => {
    const note = state.portfolio.notes.find((n) => n.id === state.portfolio.selectedNoteId);
    if (!note) return;
    openConfirmModal({
      title: "Delete this note?",
      message: `"${note.title}" will be permanently removed.`,
      onConfirm: async () => {
        await fetchJSON(`/api/portfolio/notes/${note.id}`, { method: "DELETE" });
        state.portfolio.selectedNoteId = null;
        await loadPortfolioData(true);
        showToast("Deleted.");
      },
    });
  });
});
