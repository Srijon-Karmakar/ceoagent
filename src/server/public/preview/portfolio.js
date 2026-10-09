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
  search: "",
};

const DEFAULT_PORTFOLIO_PROJECTS = [
  { id: "proj-1", name: "Acme AI Co-founder Launch", createdAt: new Date(Date.now() - 86400000 * 5).toISOString() },
  { id: "proj-2", name: "Q4 Enterprise Growth Engine", createdAt: new Date(Date.now() - 86400000 * 12).toISOString() },
  { id: "proj-3", name: "Brand Repositioning & Design System", createdAt: new Date(Date.now() - 86400000 * 20).toISOString() },
];
const DEFAULT_PORTFOLIO_ENTRIES = [
  { id: "ent-1", projectId: "proj-1", title: "Announcing CeoAgent 2.0 on Product Hunt", category: "blog", status: "published", date: "2026-10-01", owner: "agent", agentKey: "marketing", link: "https://example.com/blog/launch" },
  { id: "ent-2", projectId: "proj-1", title: "Enterprise Outreach Sequence — VP Product", category: "email", recipient: "sarah@techgiant.io", subject: "Next-gen Autonomous AI Workforce", status: "published", date: "2026-10-03", owner: "agent", agentKey: "sales" },
  { id: "ent-3", projectId: "proj-1", title: "TechCrunch Exclusive Pitch Draft", category: "article", status: "draft", date: "2026-10-05", owner: "agent", agentKey: "marketing" },
  { id: "ent-4", projectId: "proj-2", title: "Series A Deck Narrative & Strategy", category: "blog", status: "published", date: "2026-09-28", owner: "agent", agentKey: "ceo" },
];
const DEFAULT_PORTFOLIO_NOTES = [
  { id: "note-1", projectId: "proj-1", tab: "project-details", title: "Executive Vision & Objectives", content: "Build an autonomous AI workforce that pairs with the founder to ideate, execute, and scale companies.", updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(), agentKey: "ceo" },
  { id: "note-2", projectId: "proj-1", tab: "database", title: "PostgreSQL & Vector Store Architecture", content: "Supabase pgvector schema configured for embeddings, tenant isolation, and session memory.", updatedAt: new Date(Date.now() - 3600000 * 18).toISOString(), agentKey: "developer" },
];

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
    if (String(err).includes("Not signed in") || String(err).includes("401")) {
      state.portfolio.projects = DEFAULT_PORTFOLIO_PROJECTS;
      state.portfolio.entries = DEFAULT_PORTFOLIO_ENTRIES;
      state.portfolio.notes = DEFAULT_PORTFOLIO_NOTES;
      state.portfolio.loaded = true;
      state.portfolio.error = null;
    } else {
      state.portfolio.error = err instanceof Error ? err.message : String(err);
    }
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
  const projects = state.portfolio.projects || [];
  const q = (state.portfolio.search || "").trim().toLowerCase();
  const filtered = projects.filter((p) => !q || p.name.toLowerCase().includes(q));

  return `
    <div class="tasks-page portfolio-page">
      <div class="tasks-header">
        <div class="tasks-header-title-col">
          <div class="tasks-eyebrow">📁 Workspaces & Content</div>
          <h1 class="tasks-title">Portfolio <span class="tasks-count-pill">${projects.length}</span></h1>
          <p class="tasks-subtitle">Projects and deliverables produced by your autonomous agents.</p>
        </div>
      </div>

      <div class="tasks-list-card">
        <div class="tasks-toolbar">
          <div class="tasks-search-wrap">
            <span class="tasks-search-icon">${icon("search")}</span>
            <input 
              type="text" 
              id="portfolio-search-input" 
              class="tasks-search-input" 
              placeholder="Search projects by name..." 
              value="${escapeHtml(state.portfolio.search || "")}"
            />
            ${state.portfolio.search ? `<button type="button" class="tasks-search-clear" id="portfolio-search-clear" aria-label="Clear">${icon("x")}</button>` : ""}
          </div>
          <button type="button" class="btn-primary" id="portfolio-new-project-btn">${icon("plus")} New Project</button>
        </div>

        <div class="tasks-list-head-row">
          <div class="tasks-col-status">Icon</div>
          <div class="tasks-col-goal">Project Name</div>
          <div class="tasks-col-agent">Entries</div>
          <div class="tasks-col-action" style="width:100px;justify-content:flex-end">Actions</div>
        </div>

        <div class="tasks-items-list">
          ${
            filtered.length
              ? filtered
                  .map((p) => {
                    const count = state.portfolio.entries.filter((e) => e.projectId === p.id).length;
                    return `
              <div class="task-list-row" data-open-project="${p.id}">
                <div class="tasks-col-status">
                  <span class="doc-file-icon" style="color:var(--accent)">${icon("folder")}</span>
                </div>
                <div class="tasks-col-goal">
                  <span class="task-row-goal-text">${escapeHtml(p.name)}</span>
                </div>
                <div class="tasks-col-agent">
                  <span class="task-agent-badge" style="--badge-color:var(--accent)">
                    ${count} entr${count === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div class="tasks-col-action" style="width:100px;gap:6px;justify-content:flex-end">
                  <button type="button" class="row-icon-btn" data-rename-project="${p.id}" aria-label="Rename">${icon("pencil")}</button>
                  <button type="button" class="row-icon-btn row-delete-btn" data-delete-project="${p.id}" aria-label="Delete">${icon("trash-2")}</button>
                  <span class="task-open-arrow" style="margin-left:4px">${icon("chevron-right")}</span>
                </div>
              </div>
            `;
                  })
                  .join("")
              : `
              <div class="tasks-empty-state">
                <div class="tasks-empty-icon">${icon("folder")}</div>
                <div class="tasks-empty-title">${q ? "No matching projects" : "No projects yet"}</div>
                <p class="tasks-empty-text">${q ? "Try adjusting your search query." : "Create your first project to start tracking agent outputs and assets."}</p>
              </div>
            `
          }
        </div>
      </div>
    </div>
  `;
}

function renderProjectDetail(project) {
  const mode = state.portfolio.mode;
  return `
    <div class="tasks-page portfolio-page">
      <div style="margin-bottom:8px">
        <button type="button" class="card-link chat-back" id="portfolio-back-btn">${icon("chevron-left")} Back to Portfolio</button>
      </div>
      <div class="tasks-header">
        <div class="tasks-header-title-col">
          <div class="tasks-eyebrow">📁 Project Workspace</div>
          <h1 class="tasks-title">${escapeHtml(project.name)}</h1>
        </div>
      </div>
      <div class="page-tabs" style="margin-bottom:14px">
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
    <div class="tasks-list-card">
      <div class="tasks-toolbar">
        <span class="tasks-stat-chip-label" style="font-weight:700;color:var(--text);font-size:13px">${PORTFOLIO_CATEGORY_LABELS[state.portfolio.categoryTab]} (${entries.length})</span>
        <div style="display:flex;gap:8px;margin-left:auto">
          <button type="button" class="btn-secondary" id="portfolio-export-btn">${icon("download")} Export CSV</button>
          <button type="button" class="btn-primary" id="portfolio-new-entry-btn">${icon("plus")} New Entry</button>
        </div>
      </div>
      ${
        entries.length
          ? `<div class="data-table-wrap" style="border:none;border-radius:0;box-shadow:none;background:transparent"><table class="data-table">
          <thead><tr><th>Title</th>${isEmail ? "<th>Recipient</th><th>Message ID</th>" : ""}<th>Status</th><th>Date</th><th>Owner</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            ${entries
              .map(
                (e) => `
              <tr>
                <td>${e.link ? `<a href="${escapeHtml(e.link)}" target="_blank" rel="noopener" style="font-weight:600;color:var(--accent)">${escapeHtml(e.title)}</a>` : `<strong>${escapeHtml(e.title)}</strong>`}</td>
                ${isEmail ? `<td>${escapeHtml(e.recipient || "—")}</td><td>${escapeHtml(e.messageId || "—")}</td>` : ""}
                <td><span class="stage-pill stage-${e.status}">${e.status}</span></td>
                <td>${e.date ? formatDate(e.date) : "—"}</td>
                <td><span class="owner-badge ${e.owner}">${e.owner === "agent" ? deptLabel(e.agentKey) : "Manual"}</span></td>
                <td class="row-actions-cell" style="justify-content:flex-end">
                  <button type="button" class="row-icon-btn" data-edit-entry="${e.id}" aria-label="Edit">${icon("pencil")}</button>
                  <button type="button" class="row-icon-btn row-delete-btn" data-delete-entry="${e.id}" aria-label="Delete">${icon("trash-2")}</button>
                </td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table></div>`
          : `
          <div class="tasks-empty-state">
            <div class="tasks-empty-icon">${icon("file-text")}</div>
            <div class="tasks-empty-title">No ${PORTFOLIO_CATEGORY_LABELS[state.portfolio.categoryTab].toLowerCase()} entries yet</div>
            <p class="tasks-empty-text">Create entries manually or have agents deliver them here.</p>
          </div>
        `
      }
    </div>
  `;
}

function renderPortfolioNotes(project) {
  if (state.portfolio.selectedNoteId) {
    const note = state.portfolio.notes.find((n) => n.id === state.portfolio.selectedNoteId);
    if (note) return renderNoteDetail(note);
  }
  const notes = state.portfolio.notes.filter((n) => n.projectId === project.id && n.tab === state.portfolio.noteTab);
  return `
    <div class="tasks-list-card">
      <div class="tasks-toolbar">
        <div class="tasks-filter-pills">
          ${PORTFOLIO_NOTE_TABS.map((t) => `<button type="button" class="tasks-filter-pill${state.portfolio.noteTab === t ? " active" : ""}" data-note-tab="${t}">${PORTFOLIO_NOTE_TAB_LABELS[t]}</button>`).join("")}
        </div>
        <button type="button" class="btn-primary" id="portfolio-new-note-btn" style="margin-left:auto">${icon("plus")} New Note</button>
      </div>

      <div class="tasks-list-head-row">
        <div class="tasks-col-status">Icon</div>
        <div class="tasks-col-goal">Note Title</div>
        <div class="tasks-col-agent">Author / Dept</div>
        <div class="tasks-col-time">Updated</div>
        <div class="tasks-col-action"></div>
      </div>

      <div class="tasks-items-list">
        ${
          notes.length
            ? notes
                .map(
                  (n) => `
            <div class="task-list-row" data-open-note="${n.id}">
              <div class="tasks-col-status">
                <span class="doc-file-icon">${icon("file-text")}</span>
              </div>
              <div class="tasks-col-goal">
                <span class="task-row-goal-text">${escapeHtml(n.title)}</span>
              </div>
              <div class="tasks-col-agent">
                <span class="task-agent-badge" style="--badge-color:${deptColor(n.agentKey)}">
                  <span class="task-agent-dot"></span>
                  ${escapeHtml(deptLabel(n.agentKey) || "Manual")}
                </span>
              </div>
              <div class="tasks-col-time">
                <span class="task-time-text">${formatRelativeTime(n.updatedAt)}</span>
              </div>
              <div class="tasks-col-action">
                <span class="task-open-arrow">${icon("chevron-right")}</span>
              </div>
            </div>
          `,
                )
                .join("")
            : `
            <div class="tasks-empty-state">
              <div class="tasks-empty-icon">${icon("file-text")}</div>
              <div class="tasks-empty-title">No notes yet</div>
              <p class="tasks-empty-text">Add project requirements, architectural notes, or database specs.</p>
            </div>
          `
        }
      </div>
    </div>
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
  const searchInput = document.getElementById("portfolio-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.portfolio.search = e.target.value;
      render();
      const el = document.getElementById("portfolio-search-input");
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }
  document.getElementById("portfolio-search-clear")?.addEventListener("click", () => {
    state.portfolio.search = "";
    render();
  });

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
