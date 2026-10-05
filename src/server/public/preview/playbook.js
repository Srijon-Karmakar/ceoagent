"use strict";

// Playbook — agent-created marketing/sales deliverables (no "create" UI by
// design, items only come from agent tool calls) plus a Content Calendar
// that's just the same items regrouped by createdAt day, client-side —
// there's no separate calendar data source on the backend.

const PLAYBOOK_TABS = ["sales", "marketing"];
const PLAYBOOK_ITEM_TYPES = ["ai-generative", "image", "carousel", "video", "reel", "email-script"];
const PLAYBOOK_TYPE_LABELS = {
  "ai-generative": "AI-generative",
  image: "Image",
  carousel: "Carousel",
  video: "Video",
  reel: "Reel",
  "email-script": "Email script",
};
const PLAYBOOK_TYPE_COLORS = {
  "ai-generative": "#6d5bf6",
  image: "#0891b2",
  carousel: "#e87ba4",
  video: "#eda100",
  reel: "#e34948",
  "email-script": "#17b26a",
};

state.playbook = {
  items: [],
  loaded: false,
  loading: false,
  error: null,
  tab: "sales",
  mode: "list", // list | calendar
  typeFilter: "",
  calendarCursor: ymd(new Date()).slice(0, 7), // "YYYY-MM"
  calendarSelectedDate: null,
};

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function loadPlaybookItems(force) {
  if (state.playbook.loaded && !force) return;
  state.playbook.loading = true;
  render();
  try {
    state.playbook.items = await fetchJSON("/api/playbook");
    state.playbook.loaded = true;
    state.playbook.error = null;
  } catch (err) {
    state.playbook.error = err instanceof Error ? err.message : String(err);
  }
  state.playbook.loading = false;
  render();
}
LAZY_LOADERS.playbook = () => loadPlaybookItems(false);

function playbookTabItems() {
  return state.playbook.items.filter((i) => i.tab === state.playbook.tab && (!state.playbook.typeFilter || i.type === state.playbook.typeFilter));
}

// ---------- render ----------

VIEW_RENDERERS.playbook = function renderPlaybookPage() {
  if (state.playbook.loading && !state.playbook.loaded) return `<div class="stub-placeholder">Loading playbook…</div>`;
  if (state.playbook.error) return `<div class="stub-placeholder">Couldn't load playbook: ${escapeHtml(state.playbook.error)}</div>`;
  const items = playbookTabItems();

  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Playbook</h1>
        <p class="stub-subtitle">Deliverables your agents have shipped — toggle done, edit, or remove. New items come from the agents themselves.</p>
      </div>
      <div class="page-tabs">
        ${PLAYBOOK_TABS.map((t) => `<button type="button" class="page-tab${state.playbook.tab === t ? " active" : ""}" data-playbook-tab="${t}">${capitalize(t)}</button>`).join("")}
        <span class="toolbar-spacer"></span>
        <button type="button" class="page-tab${state.playbook.mode === "list" ? " active" : ""}" data-playbook-mode="list">${icon("list-checks")} List</button>
        <button type="button" class="page-tab${state.playbook.mode === "calendar" ? " active" : ""}" data-playbook-mode="calendar">${icon("calendar-days")} Calendar</button>
      </div>
      <div class="toolbar">
        <span class="toolbar-label">Type:</span>
        <button type="button" class="chip-filter${!state.playbook.typeFilter ? " active" : ""}" data-playbook-type="">All</button>
        ${PLAYBOOK_ITEM_TYPES.map(
          (t) =>
            `<button type="button" class="chip-filter${state.playbook.typeFilter === t ? " active" : ""}" data-playbook-type="${t}" style="--chip-color:${PLAYBOOK_TYPE_COLORS[t]}">${PLAYBOOK_TYPE_LABELS[t]}</button>`,
        ).join("")}
      </div>
      ${state.playbook.mode === "list" ? renderPlaybookList(items) : renderPlaybookCalendar()}
    </div>
  `;
};

function renderPlaybookList(items) {
  if (!items.length) return `<div class="stub-placeholder">Nothing here yet.</div>`;
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th></th><th>Type</th><th>Platform</th><th>Details</th><th>Owner</th><th>Added</th><th></th></tr></thead>
        <tbody>
          ${items
            .map(
              (i) => `
            <tr>
              <td><button type="button" class="task-check ${i.done ? "success" : ""}" data-toggle-playbook="${i.id}">${i.done ? icon("check") : ""}</button></td>
              <td><span class="type-pill" style="--chip-color:${PLAYBOOK_TYPE_COLORS[i.type]}">${PLAYBOOK_TYPE_LABELS[i.type] ?? i.type}</span></td>
              <td>${escapeHtml(i.platform || "—")}</td>
              <td class="truncate-cell">${i.link ? `<a href="${escapeHtml(i.link)}" target="_blank" rel="noopener">${escapeHtml(i.details || i.link)}</a>` : escapeHtml(i.details || "—")}</td>
              <td><span class="owner-badge ${i.owner}">${i.owner === "agent" ? deptLabel(i.agentKey) : "Manual"}</span></td>
              <td>${formatDate(i.createdAt)}</td>
              <td class="row-actions-cell">
                <button type="button" class="row-icon-btn" data-edit-playbook="${i.id}" aria-label="Edit">${icon("pencil")}</button>
                <button type="button" class="row-icon-btn row-delete-btn" data-delete-playbook="${i.id}" aria-label="Delete">${icon("trash-2")}</button>
              </td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPlaybookCalendar() {
  const [year, month] = state.playbook.calendarCursor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(year, month, 0).getDate();
  const items = playbookTabItems();
  const byDay = new Map();
  for (const i of items) {
    const key = ymd(new Date(i.createdAt));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(i);
  }

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<span class="cal-cell-empty"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayItems = byDay.get(dateStr) || [];
    cells.push(`
      <button type="button" class="cal-cell${dateStr === state.playbook.calendarSelectedDate ? " selected" : ""}" data-select-date="${dateStr}">
        <span class="cal-cell-num">${d}</span>
        <span class="cal-cell-dots">${dayItems
          .slice(0, 4)
          .map((i) => `<span class="cal-dot" style="background:${PLAYBOOK_TYPE_COLORS[i.type]}"></span>`)
          .join("")}</span>
      </button>
    `);
  }

  const selected = state.playbook.calendarSelectedDate;
  const selectedItems = selected ? byDay.get(selected) || [] : [];

  return `
    <div class="cal-layout">
      <div class="card cal-grid-card">
        <div class="cal-grid-head">
          <button type="button" id="cal-prev-month">${icon("chevron-left")}</button>
          <span>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button type="button" id="cal-next-month">${icon("chevron-right")}</button>
        </div>
        <div class="cal-grid-weekdays">${["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="cal-grid">${cells.join("")}</div>
      </div>
      <div class="card cal-day-card">
        <div class="card-head"><span class="card-title">${selected ? formatDate(selected) : "Pick a day"}</span></div>
        ${
          selected
            ? selectedItems.length
              ? selectedItems
                  .map(
                    (i) => `
            <div class="stub-list-row">
              <span class="cal-dot" style="background:${PLAYBOOK_TYPE_COLORS[i.type]}"></span>
              <span class="stub-list-title">${escapeHtml(i.details || i.platform || PLAYBOOK_TYPE_LABELS[i.type])}</span>
              <span class="stub-list-meta">${deptLabel(i.agentKey)}</span>
            </div>
          `,
                  )
                  .join("")
              : `<div class="card-empty">Nothing on this day.</div>`
            : `<div class="card-empty">Click a date to see what shipped.</div>`
        }
      </div>
    </div>
  `;
}

// ---------- edit modal ----------

function openPlaybookEditModal(item) {
  const form = { type: item.type, platform: item.platform || "", link: item.link || "", details: item.details || "", notes: item.notes || "" };
  let saving = false;
  const renderer = () => `
    <div class="modal-head"><h2>Edit item</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <label>Type
          <select data-pb-field="type">
            ${PLAYBOOK_ITEM_TYPES.map((t) => `<option value="${t}"${t === form.type ? " selected" : ""}>${PLAYBOOK_TYPE_LABELS[t]}</option>`).join("")}
          </select>
        </label>
        <label>Platform<input type="text" data-pb-field="platform" value="${escapeHtml(form.platform)}" /></label>
      </div>
      <label class="form-full">Link<input type="text" data-pb-field="link" value="${escapeHtml(form.link)}" /></label>
      <label class="form-full">Details<textarea data-pb-field="details" rows="2">${escapeHtml(form.details)}</textarea></label>
      <label class="form-full">Notes<textarea data-pb-field="notes" rows="2">${escapeHtml(form.notes)}</textarea></label>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="pb-save-btn" ${saving ? "disabled" : ""}>${saving ? "Saving…" : "Save"}</button>
    </div>
  `;
  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.querySelectorAll("[data-pb-field]").forEach((el) => {
      el.addEventListener("input", (e) => {
        form[el.dataset.pbField] = e.target.value;
      });
    });
    document.getElementById("pb-save-btn")?.addEventListener("click", async () => {
      saving = true;
      openModal(renderer);
      try {
        await fetchJSON(`/api/playbook/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
        closeModal();
        await loadPlaybookItems(true);
        showToast("Saved.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  };
  openModal(renderer);
}

// ---------- attach ----------

VIEW_ATTACHERS.push(function attachPlaybookHandlers() {
  document.querySelectorAll("[data-playbook-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.playbook.tab = btn.dataset.playbookTab;
      state.playbook.calendarSelectedDate = null;
      render();
    });
  });
  document.querySelectorAll("[data-playbook-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.playbook.mode = btn.dataset.playbookMode;
      render();
    });
  });
  document.querySelectorAll("[data-playbook-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.playbook.typeFilter = btn.dataset.playbookType;
      render();
    });
  });
  document.querySelectorAll("[data-toggle-playbook]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = state.playbook.items.find((i) => i.id === btn.dataset.togglePlaybook);
      if (!item) return;
      try {
        await fetchJSON(`/api/playbook/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: !item.done }),
        });
        await loadPlaybookItems(true);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  });
  document.querySelectorAll("[data-edit-playbook]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.playbook.items.find((i) => i.id === btn.dataset.editPlaybook);
      if (item) openPlaybookEditModal(item);
    });
  });
  document.querySelectorAll("[data-delete-playbook]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.playbook.items.find((i) => i.id === btn.dataset.deletePlaybook);
      if (!item) return;
      openConfirmModal({
        title: "Delete this item?",
        message: "This playbook entry will be permanently removed.",
        confirmLabel: "Delete",
        onConfirm: async () => {
          await fetchJSON(`/api/playbook/${item.id}`, { method: "DELETE" });
          await loadPlaybookItems(true);
          showToast("Deleted.");
        },
      });
    });
  });
  document.getElementById("cal-prev-month")?.addEventListener("click", () => {
    const [y, m] = state.playbook.calendarCursor.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    state.playbook.calendarCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    render();
  });
  document.getElementById("cal-next-month")?.addEventListener("click", () => {
    const [y, m] = state.playbook.calendarCursor.split("-").map(Number);
    const d = new Date(y, m, 1);
    state.playbook.calendarCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    render();
  });
  document.querySelectorAll("[data-select-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.playbook.calendarSelectedDate = btn.dataset.selectDate;
      render();
    });
  });
});
