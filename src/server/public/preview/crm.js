"use strict";

// CRM — leads/pipeline. Loaded lazily the first time you open the CRM nav
// item (see LAZY_LOADERS.crm below), reusing the same /api/leads endpoints
// production's CRM page calls.

const LEAD_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"];
const LEAD_STAGE_LABELS = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};
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
].map((key) => ({ label: key, get: (row) => row[key] }));
const LEAD_IMPORT_ALIASES = {
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

state.crm = {
  leads: [],
  loaded: false,
  loading: false,
  error: null,
  view: "board",
  search: "",
  sourceFilter: "",
  importPreview: null, // { rows: [{data, errors}], fileName }
};

async function loadCrmLeads(force) {
  if (state.crm.loaded && !force) return;
  state.crm.loading = true;
  render();
  try {
    state.crm.leads = await fetchJSON("/api/leads");
    state.crm.loaded = true;
    state.crm.error = null;
  } catch (err) {
    state.crm.error = err instanceof Error ? err.message : String(err);
  }
  state.crm.loading = false;
  render();
}
LAZY_LOADERS.crm = () => loadCrmLeads(false);

function filteredLeads() {
  const q = state.crm.search.trim().toLowerCase();
  return state.crm.leads.filter((l) => {
    if (state.crm.sourceFilter && l.source !== state.crm.sourceFilter) return false;
    if (!q) return true;
    return [l.name, l.company, l.email, l.notes].some((f) => (f || "").toLowerCase().includes(q));
  });
}

function leadSources() {
  return [...new Set(state.crm.leads.map((l) => l.source).filter(Boolean))].sort();
}

// ---------- render ----------

VIEW_RENDERERS.crm = function renderCrmPage() {
  if (state.crm.loading && !state.crm.loaded) return `<div class="stub-placeholder">Loading leads…</div>`;
  if (state.crm.error) return `<div class="stub-placeholder">Couldn't load CRM: ${escapeHtml(state.crm.error)}</div>`;
  const leads = filteredLeads();
  const sources = leadSources();

  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">CRM</h1>
        <p class="stub-subtitle">${state.crm.leads.length} lead${state.crm.leads.length === 1 ? "" : "s"} in the pipeline.</p>
      </div>
      <div class="page-tabs">
        ${["board", "table", "stats"]
          .map((v) => `<button type="button" class="page-tab${state.crm.view === v ? " active" : ""}" data-crm-view="${v}">${capitalize(v)}</button>`)
          .join("")}
      </div>
      <div class="toolbar">
        <input type="text" class="toolbar-search" id="crm-search" placeholder="Search leads…" value="${escapeHtml(state.crm.search)}" />
        <select id="crm-source-filter">
          <option value="">All sources</option>
          ${sources.map((s) => `<option value="${escapeHtml(s)}"${s === state.crm.sourceFilter ? " selected" : ""}>${escapeHtml(s)}</option>`).join("")}
        </select>
        <span class="toolbar-spacer"></span>
        <button type="button" class="btn-secondary" id="crm-export-btn">${icon("download")} Export CSV</button>
        <button type="button" class="btn-secondary" id="crm-import-btn">${icon("upload")} Import CSV</button>
        <input type="file" id="crm-import-file" accept=".csv" hidden />
        <button type="button" class="btn-primary" id="crm-new-lead-btn">${icon("plus")} New Lead</button>
      </div>
      ${state.crm.view === "board" ? renderCrmBoard(leads) : state.crm.view === "table" ? renderCrmTable(leads) : renderCrmStats(leads)}
    </div>
  `;
};

function leadCard(lead) {
  const idx = LEAD_STAGES.indexOf(lead.stage);
  return `
    <div class="lead-card" data-open-lead="${lead.id}">
      <div class="lead-card-name">${escapeHtml(lead.name)}</div>
      ${lead.company ? `<div class="lead-card-company">${escapeHtml(lead.company)}</div>` : ""}
      ${lead.value != null ? `<div class="lead-card-value">${escapeHtml(lead.currency || "$")}${lead.value.toLocaleString()}</div>` : ""}
      <div class="lead-card-move">
        <button type="button" data-move-lead="${lead.id}" data-dir="-1" ${idx <= 0 ? "disabled" : ""} aria-label="Move back">${icon("chevron-left")}</button>
        <span>${escapeHtml(LEAD_STAGE_LABELS[lead.stage] ?? lead.stage)}</span>
        <button type="button" data-move-lead="${lead.id}" data-dir="1" ${idx >= LEAD_STAGES.length - 1 ? "disabled" : ""} aria-label="Move forward">${icon("chevron-right")}</button>
      </div>
    </div>
  `;
}

function renderCrmBoard(leads) {
  return `
    <div class="crm-board">
      ${LEAD_STAGES.map((stage) => {
        const stageLeads = leads.filter((l) => l.stage === stage);
        return `
          <div class="crm-board-col">
            <div class="crm-board-col-head">
              <span>${LEAD_STAGE_LABELS[stage]}</span>
              <span class="crm-board-col-count">${stageLeads.length}</span>
            </div>
            <div class="crm-board-col-body">
              ${stageLeads.map(leadCard).join("") || `<div class="card-empty">No leads</div>`}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCrmTable(leads) {
  if (!leads.length) return `<div class="stub-placeholder">No leads match.</div>`;
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Name</th><th>Company</th><th>Stage</th><th>Source</th><th>Value</th><th>Follow-up</th><th></th></tr></thead>
        <tbody>
          ${leads
            .map(
              (l) => `
            <tr data-open-lead="${l.id}">
              <td>${escapeHtml(l.name)}</td>
              <td>${escapeHtml(l.company || "—")}</td>
              <td><span class="stage-pill stage-${l.stage}">${LEAD_STAGE_LABELS[l.stage] ?? l.stage}</span></td>
              <td>${escapeHtml(l.source)}</td>
              <td>${l.value != null ? `${escapeHtml(l.currency || "$")}${l.value.toLocaleString()}` : "—"}</td>
              <td>${l.followUpAt ? formatDate(l.followUpAt) : "—"}</td>
              <td><button type="button" class="row-delete-btn" data-delete-lead="${l.id}" aria-label="Delete">${icon("trash-2")}</button></td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderCrmStats(leads) {
  const byStage = LEAD_STAGES.map((s) => ({ stage: s, count: leads.filter((l) => l.stage === s).length }));
  const totalValue = leads.reduce((sum, l) => sum + (l.value || 0), 0);
  const bySource = leadSources().map((s) => ({ source: s, count: leads.filter((l) => l.source === s).length }));
  const maxStage = Math.max(1, ...byStage.map((s) => s.count));
  return `
    <div class="stat-tiles">
      <div class="stat-tile"><div class="stat-tile-value">${leads.length}</div><div class="stat-tile-label">Leads</div></div>
      <div class="stat-tile"><div class="stat-tile-value">$${totalValue.toLocaleString()}</div><div class="stat-tile-label">Pipeline value</div></div>
      <div class="stat-tile"><div class="stat-tile-value">${leads.filter((l) => l.stage === "won").length}</div><div class="stat-tile-label">Won</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card-head"><span class="card-title">By stage</span></div>
      ${byStage
        .map(
          (s) => `
        <div class="stat-bar-row">
          <span class="stat-bar-label">${LEAD_STAGE_LABELS[s.stage]}</span>
          <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${(s.count / maxStage) * 100}%"></span></span>
          <span class="stat-bar-count">${s.count}</span>
        </div>
      `,
        )
        .join("")}
    </div>
    ${
      bySource.length
        ? `<div class="card" style="margin-top:14px">
            <div class="card-head"><span class="card-title">By source</span></div>
            ${bySource.map((s) => `<div class="stub-list-row"><span class="stub-list-title">${escapeHtml(s.source)}</span><span class="stub-list-meta">${s.count}</span></div>`).join("")}
          </div>`
        : ""
    }
  `;
}

// ---------- lead modal ----------

function emptyLead() {
  return { name: "", company: "", title: "", email: "", phone: "", source: "", stage: "new", value: "", currency: "USD", owner: "", tags: "", followUpAt: "", notes: "" };
}

function openLeadModal(lead) {
  const isNew = !lead;
  const form = lead
    ? { ...lead, value: lead.value != null ? String(lead.value) : "", tags: (lead.tags || []).join(", ") }
    : emptyLead();
  let saving = false;
  let noteDraft = "";

  const renderer = () => `
    <div class="modal-head"><h2>${isNew ? "New Lead" : escapeHtml(lead.name)}</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <label>Name<input type="text" data-lead-field="name" value="${escapeHtml(form.name)}" /></label>
        <label>Company<input type="text" data-lead-field="company" value="${escapeHtml(form.company)}" /></label>
        <label>Title<input type="text" data-lead-field="title" value="${escapeHtml(form.title)}" /></label>
        <label>Source<input type="text" data-lead-field="source" value="${escapeHtml(form.source)}" /></label>
        <label>Email<input type="email" data-lead-field="email" value="${escapeHtml(form.email)}" /></label>
        <label>Phone<input type="text" data-lead-field="phone" value="${escapeHtml(form.phone)}" /></label>
        <label>Stage
          <select data-lead-field="stage">
            ${LEAD_STAGES.map((s) => `<option value="${s}"${s === form.stage ? " selected" : ""}>${LEAD_STAGE_LABELS[s]}</option>`).join("")}
          </select>
        </label>
        <label>Value<input type="number" data-lead-field="value" value="${escapeHtml(form.value)}" /></label>
        <label>Currency<input type="text" data-lead-field="currency" value="${escapeHtml(form.currency)}" /></label>
        <label>Owner<input type="text" data-lead-field="owner" value="${escapeHtml(form.owner)}" /></label>
        <label>Follow-up<input type="date" data-lead-field="followUpAt" value="${escapeHtml(form.followUpAt || "")}" /></label>
        <label>Tags (comma-separated)<input type="text" data-lead-field="tags" value="${escapeHtml(form.tags)}" /></label>
      </div>
      <label class="form-full">Notes<textarea data-lead-field="notes" rows="3">${escapeHtml(form.notes)}</textarea></label>
      ${
        !isNew
          ? `
        <div class="lead-activity">
          <div class="card-title" style="margin-bottom:6px">Activity</div>
          <div class="lead-activity-list">
            ${
              (lead.activity || []).length
                ? [...lead.activity]
                    .reverse()
                    .map((a) => `<div class="lead-activity-item"><span class="lead-activity-ts">${formatDateTime(a.ts)}</span><span>${escapeHtml(a.note)}</span></div>`)
                    .join("")
                : `<div class="card-empty">No activity logged.</div>`
            }
          </div>
          <div class="lead-activity-add">
            <input type="text" id="lead-note-input" placeholder="Add a note…" value="${escapeHtml(noteDraft)}" />
            <button type="button" class="btn-secondary" id="lead-note-add-btn">Add</button>
          </div>
        </div>
      `
          : ""
      }
    </div>
    <div class="modal-footer">
      ${!isNew ? `<button type="button" class="btn-danger" id="lead-delete-btn">Delete</button>` : "<span></span>"}
      <span class="modal-footer-spacer"></span>
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="lead-save-btn" ${saving ? "disabled" : ""}>${saving ? "Saving…" : isNew ? "Create" : "Save"}</button>
    </div>
  `;

  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.querySelectorAll("[data-lead-field]").forEach((el) => {
      el.addEventListener("input", (e) => {
        form[el.dataset.leadField] = e.target.value;
      });
    });
    document.getElementById("lead-note-input")?.addEventListener("input", (e) => {
      noteDraft = e.target.value;
    });
    document.getElementById("lead-note-add-btn")?.addEventListener("click", async () => {
      if (!noteDraft.trim() || !lead) return;
      try {
        const updated = await fetchJSON(`/api/leads/${lead.id}/activity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: noteDraft.trim() }),
        });
        Object.assign(lead, updated);
        noteDraft = "";
        openLeadModal(lead);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
    document.getElementById("lead-delete-btn")?.addEventListener("click", () => {
      openConfirmModal({
        title: "Delete this lead?",
        message: `"${lead.name}" and its activity log will be permanently removed.`,
        requireText: lead.name,
        onConfirm: async () => {
          await fetchJSON(`/api/leads/${lead.id}`, { method: "DELETE" });
          await loadCrmLeads(true);
          showToast("Lead deleted.");
        },
      });
    });
    document.getElementById("lead-save-btn")?.addEventListener("click", async () => {
      if (!form.name.trim() || !form.source.trim()) {
        showToast("Name and source are required.");
        return;
      }
      saving = true;
      openLeadModal(lead);
      const body = {
        name: form.name.trim(),
        company: form.company.trim() || undefined,
        title: form.title.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        source: form.source.trim(),
        stage: form.stage,
        value: form.value !== "" ? Number(form.value) : undefined,
        currency: form.currency.trim() || undefined,
        owner: form.owner.trim() || undefined,
        followUpAt: form.followUpAt || undefined,
        tags: form.tags
          ? form.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        notes: form.notes.trim() || undefined,
      };
      try {
        if (isNew) await fetchJSON("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        else await fetchJSON(`/api/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        closeModal();
        await loadCrmLeads(true);
        showToast(isNew ? "Lead created." : "Lead saved.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  };
  openModal(renderer);
}

// ---------- import preview modal ----------

function openLeadImportModal(rows, fileName) {
  const parsed = rows.map((data) => {
    const errors = [];
    if (!data.name?.trim()) errors.push("missing name");
    if (!data.source?.trim()) errors.push("missing source");
    if (data.stage && !LEAD_STAGES.includes(data.stage)) errors.push(`invalid stage "${data.stage}"`);
    return { data, errors };
  });
  const validCount = parsed.filter((r) => !r.errors.length).length;
  let importing = false;

  const renderer = () => `
    <div class="modal-head"><h2>Import ${escapeHtml(fileName)}</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body">
      <p>${validCount} of ${parsed.length} rows look valid.</p>
      <div class="data-table-wrap" style="max-height:300px">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Company</th><th>Source</th><th>Stage</th><th>Issues</th></tr></thead>
          <tbody>
            ${parsed
              .map(
                (r) => `
              <tr class="${r.errors.length ? "import-row-error" : ""}">
                <td>${escapeHtml(r.data.name || "")}</td>
                <td>${escapeHtml(r.data.company || "")}</td>
                <td>${escapeHtml(r.data.source || "")}</td>
                <td>${escapeHtml(r.data.stage || "")}</td>
                <td>${r.errors.length ? escapeHtml(r.errors.join(", ")) : icon("check")}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="import-confirm-btn" ${importing || !validCount ? "disabled" : ""}>${importing ? "Importing…" : `Import ${validCount} lead${validCount === 1 ? "" : "s"}`}</button>
    </div>
  `;

  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.getElementById("import-confirm-btn")?.addEventListener("click", async () => {
      importing = true;
      openModal(renderer);
      let ok = 0;
      for (const r of parsed) {
        if (r.errors.length) continue;
        try {
          const body = { ...r.data };
          if (body.value) body.value = Number(body.value);
          if (body.tags) body.tags = body.tags.split(";").map((t) => t.trim()).filter(Boolean);
          await fetchJSON("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          ok++;
        } catch {
          // skip failed rows, continue importing the rest
        }
      }
      closeModal();
      await loadCrmLeads(true);
      showToast(`Imported ${ok} lead${ok === 1 ? "" : "s"}.`);
    });
  };
  openModal(renderer);
}

function handleLeadImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCSV(String(reader.result || ""));
    if (rows.length < 2) {
      showToast("CSV has no data rows.");
      return;
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const fieldMap = header.map((h) => LEAD_IMPORT_ALIASES[h] || null);
    const dataRows = rows.slice(1).map((row) => {
      const obj = {};
      fieldMap.forEach((field, i) => {
        if (field) obj[field] = row[i] || "";
      });
      return obj;
    });
    openLeadImportModal(dataRows, file.name);
  };
  reader.readAsText(file);
}

// ---------- attach ----------

VIEW_ATTACHERS.push(function attachCrmHandlers() {
  document.querySelectorAll("[data-crm-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.crm.view = btn.dataset.crmView;
      render();
    });
  });
  document.getElementById("crm-search")?.addEventListener("input", (e) => {
    const cursor = e.target.selectionStart;
    state.crm.search = e.target.value;
    render();
    const el = document.getElementById("crm-search");
    if (el) {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    }
  });
  document.getElementById("crm-source-filter")?.addEventListener("change", (e) => {
    state.crm.sourceFilter = e.target.value;
    render();
  });
  document.getElementById("crm-new-lead-btn")?.addEventListener("click", () => openLeadModal(null));
  document.querySelectorAll("[data-open-lead]").forEach((el) => {
    el.addEventListener("click", () => {
      const lead = state.crm.leads.find((l) => l.id === el.dataset.openLead);
      if (lead) openLeadModal(lead);
    });
  });
  document.querySelectorAll("[data-move-lead]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const lead = state.crm.leads.find((l) => l.id === btn.dataset.moveLead);
      if (!lead) return;
      const idx = LEAD_STAGES.indexOf(lead.stage) + Number(btn.dataset.dir);
      if (idx < 0 || idx >= LEAD_STAGES.length) return;
      try {
        await fetchJSON(`/api/leads/${lead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: LEAD_STAGES[idx] }),
        });
        await loadCrmLeads(true);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  });
  document.querySelectorAll("[data-delete-lead]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lead = state.crm.leads.find((l) => l.id === btn.dataset.deleteLead);
      if (!lead) return;
      openConfirmModal({
        title: "Delete this lead?",
        message: `"${lead.name}" and its activity log will be permanently removed.`,
        requireText: lead.name,
        onConfirm: async () => {
          await fetchJSON(`/api/leads/${lead.id}`, { method: "DELETE" });
          await loadCrmLeads(true);
          showToast("Lead deleted.");
        },
      });
    });
  });
  document.getElementById("crm-export-btn")?.addEventListener("click", () => {
    const csv = rowsToCSV(
      LEAD_CSV_COLUMNS,
      filteredLeads().map((l) => ({ ...l, tags: (l.tags || []).join(";") })),
    );
    downloadText(`leads-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  });
  document.getElementById("crm-import-btn")?.addEventListener("click", () => {
    document.getElementById("crm-import-file")?.click();
  });
  document.getElementById("crm-import-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleLeadImportFile(file);
    e.target.value = "";
  });
});
