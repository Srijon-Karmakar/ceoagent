"use strict";

// Scheduler/Calendar — recurring or one-time automations. A real month grid
// (distinct from Playbook's Content Calendar, which is just shipped
// deliverables regrouped by date) plus a flat list, since recurrence makes
// "which days does this actually fire on" easier to read as a list too.

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

state.scheduler = {
  schedules: [],
  loaded: false,
  loading: false,
  error: null,
  filter: "all", // all | active | disabled
  cursor: new Date().toISOString().slice(0, 7), // "YYYY-MM"
  selectedDate: null,
};

async function loadSchedules(force) {
  if (state.scheduler.loaded && !force) return;
  state.scheduler.loading = true;
  render();
  try {
    state.scheduler.schedules = await fetchJSON("/api/schedule");
    state.scheduler.loaded = true;
    state.scheduler.error = null;
  } catch (err) {
    state.scheduler.error = err instanceof Error ? err.message : String(err);
  }
  state.scheduler.loading = false;
  render();
}
LAZY_LOADERS.scheduler = () => loadSchedules(false);

function schedulerAgentOptions() {
  return [{ key: "ceo", label: "CEO" }, ...state.departments.map((d) => ({ key: d.key, label: d.label }))];
}

function recurrenceSummary(r) {
  if (r.type === "once") return `Once on ${formatDate(r.date)}`;
  if (r.type === "daily") return `Daily${r.endDate ? ` until ${formatDate(r.endDate)}` : ""}`;
  const days = r.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", ");
  return `Weekly (${days})${r.endDate ? ` until ${formatDate(r.endDate)}` : ""}`;
}

function scheduleOccursOn(schedule, dateStr) {
  const r = schedule.recurrence;
  if (r.type === "once") return r.date === dateStr;
  if (dateStr < r.startDate) return false;
  if (r.endDate && dateStr > r.endDate) return false;
  if (r.type === "daily") return true;
  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  return r.weekdays.includes(weekday);
}

function filteredSchedules() {
  return state.scheduler.schedules.filter((s) => (state.scheduler.filter === "all" ? true : state.scheduler.filter === "active" ? s.enabled : !s.enabled));
}

// ---------- render ----------

VIEW_RENDERERS.scheduler = function renderSchedulerPage() {
  if (state.scheduler.loading && !state.scheduler.loaded) return `<div class="stub-placeholder">Loading schedule…</div>`;
  if (state.scheduler.error) return `<div class="stub-placeholder">Couldn't load schedule: ${escapeHtml(state.scheduler.error)}</div>`;
  const schedules = filteredSchedules();

  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Calendar</h1>
        <p class="stub-subtitle">Recurring or one-time automations for any agent.</p>
      </div>
      <div class="toolbar">
        ${["all", "active", "disabled"]
          .map((f) => `<button type="button" class="chip-filter${state.scheduler.filter === f ? " active" : ""}" data-sched-filter="${f}">${capitalize(f)}</button>`)
          .join("")}
        <span class="toolbar-spacer"></span>
        <button type="button" class="btn-primary" id="sched-new-btn">${icon("plus")} New automation</button>
      </div>
      ${renderSchedulerGrid()}
      <div class="card" style="margin-top:16px">
        <div class="card-head"><span class="card-title">All automations</span></div>
        ${
          schedules.length
            ? schedules
                .map(
                  (s) => `
          <div class="stub-list-row">
            <span class="agent-dot" style="background:${deptColor(s.agentKey)}"></span>
            <span class="stub-list-title">${escapeHtml(s.label)}</span>
            <span class="stub-list-meta">${escapeHtml(deptLabel(s.agentKey))} · ${recurrenceSummary(s.recurrence)} · ${escapeHtml(s.time)}</span>
            <button type="button" class="chip-toggle ${s.enabled ? "on" : ""}" data-toggle-sched="${s.id}">${s.enabled ? "Enabled" : "Disabled"}</button>
            <button type="button" class="row-icon-btn" data-edit-sched="${s.id}" aria-label="Edit">${icon("pencil")}</button>
            <button type="button" class="row-icon-btn row-delete-btn" data-delete-sched="${s.id}" aria-label="Delete">${icon("trash-2")}</button>
          </div>
        `,
                )
                .join("")
            : `<div class="card-empty">No automations yet.</div>`
        }
      </div>
    </div>
  `;
};

function renderSchedulerGrid() {
  const [year, month] = state.scheduler.cursor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const schedules = filteredSchedules();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<span class="cal-cell-empty"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayItems = schedules.filter((s) => scheduleOccursOn(s, dateStr));
    cells.push(`
      <button type="button" class="cal-cell${dateStr === state.scheduler.selectedDate ? " selected" : ""}" data-select-sched-date="${dateStr}">
        <span class="cal-cell-num">${d}</span>
        <span class="cal-cell-dots">${dayItems
          .slice(0, 4)
          .map((s) => `<span class="cal-dot" style="background:${deptColor(s.agentKey)}"></span>`)
          .join("")}</span>
      </button>
    `);
  }

  const selected = state.scheduler.selectedDate;
  const selectedItems = selected ? schedules.filter((s) => scheduleOccursOn(s, selected)) : [];

  return `
    <div class="cal-layout">
      <div class="card cal-grid-card">
        <div class="cal-grid-head">
          <button type="button" id="sched-prev-month">${icon("chevron-left")}</button>
          <span>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button type="button" id="sched-next-month">${icon("chevron-right")}</button>
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
                  .map((s) => `<div class="stub-list-row"><span class="agent-dot" style="background:${deptColor(s.agentKey)}"></span><span class="stub-list-title">${escapeHtml(s.label)}</span><span class="stub-list-meta">${escapeHtml(s.time)}</span></div>`)
                  .join("")
              : `<div class="card-empty">Nothing scheduled this day.</div>`
            : `<div class="card-empty">Click a date to see what's scheduled.</div>`
        }
      </div>
    </div>
  `;
}

// ---------- create/edit modal ----------

function openScheduleModal(schedule) {
  const isNew = !schedule;
  const r = schedule?.recurrence;
  const form = {
    label: schedule?.label || "",
    goal: schedule?.goal || "",
    agentKey: schedule?.agentKey || "ceo",
    time: schedule?.time || "09:00",
    type: r?.type || "once",
    date: r?.type === "once" ? r.date : "",
    startDate: r?.type !== "once" ? r?.startDate || "" : "",
    endDate: r?.type !== "once" ? r?.endDate || "" : "",
    weekdays: r?.type === "weekly" ? [...r.weekdays] : [],
  };

  const renderer = () => `
    <div class="modal-head"><h2>${isNew ? "New automation" : "Edit automation"}</h2><button type="button" class="modal-close" id="modal-close-btn">${icon("x")}</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <label>Label<input type="text" data-sched-field="label" value="${escapeHtml(form.label)}" /></label>
        <label>Agent
          <select data-sched-field="agentKey">${schedulerAgentOptions().map((a) => `<option value="${a.key}"${a.key === form.agentKey ? " selected" : ""}>${escapeHtml(a.label)}</option>`).join("")}</select>
        </label>
        <label>Time<input type="time" data-sched-field="time" value="${escapeHtml(form.time)}" /></label>
        <label>Recurrence
          <select data-sched-field="type">
            <option value="once"${form.type === "once" ? " selected" : ""}>Once</option>
            <option value="daily"${form.type === "daily" ? " selected" : ""}>Daily</option>
            <option value="weekly"${form.type === "weekly" ? " selected" : ""}>Weekly</option>
          </select>
        </label>
      </div>
      ${
        form.type === "once"
          ? `<label class="form-full">Date<input type="date" data-sched-field="date" value="${escapeHtml(form.date)}" /></label>`
          : `
          <div class="form-grid">
            <label>Start date<input type="date" data-sched-field="startDate" value="${escapeHtml(form.startDate)}" /></label>
            <label>End date (optional)<input type="date" data-sched-field="endDate" value="${escapeHtml(form.endDate)}" /></label>
          </div>
          ${
            form.type === "weekly"
              ? `<div class="weekday-picker">${WEEKDAY_LABELS.map(
                  (label, i) => `<button type="button" class="weekday-chip${form.weekdays.includes(i) ? " active" : ""}" data-weekday="${i}">${label}</button>`,
                ).join("")}</div>`
              : ""
          }
        `
      }
      <label class="form-full">Goal (what the agent receives)<textarea data-sched-field="goal" rows="3">${escapeHtml(form.goal)}</textarea></label>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button type="button" class="btn-primary" id="sched-save-btn">${isNew ? "Create" : "Save"}</button>
    </div>
  `;

  modalAttach = () => {
    document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
    document.getElementById("modal-cancel-btn")?.addEventListener("click", closeModal);
    document.querySelectorAll("[data-sched-field]").forEach((el) => {
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", (e) => {
        form[el.dataset.schedField] = e.target.value;
        if (el.dataset.schedField === "type") openModal(renderer);
      });
    });
    document.querySelectorAll("[data-weekday]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const d = Number(btn.dataset.weekday);
        if (form.weekdays.includes(d)) form.weekdays = form.weekdays.filter((x) => x !== d);
        else form.weekdays = [...form.weekdays, d].sort();
        openModal(renderer);
      });
    });
    document.getElementById("sched-save-btn")?.addEventListener("click", async () => {
      if (!form.label.trim() || !form.goal.trim()) {
        showToast("Label and goal are required.");
        return;
      }
      let recurrence;
      if (form.type === "once") {
        if (!form.date) return showToast("Pick a date.");
        recurrence = { type: "once", date: form.date };
      } else if (form.type === "daily") {
        if (!form.startDate) return showToast("Pick a start date.");
        recurrence = { type: "daily", startDate: form.startDate, endDate: form.endDate || undefined };
      } else {
        if (!form.startDate || !form.weekdays.length) return showToast("Pick a start date and at least one weekday.");
        recurrence = { type: "weekly", startDate: form.startDate, endDate: form.endDate || undefined, weekdays: form.weekdays };
      }
      const body = { label: form.label.trim(), goal: form.goal.trim(), agentKey: form.agentKey, time: form.time, recurrence };
      try {
        if (isNew) await fetchJSON("/api/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        else await fetchJSON(`/api/schedule/${schedule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        closeModal();
        await loadSchedules(true);
        showToast(isNew ? "Automation created." : "Saved.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  };
  openModal(renderer);
}

// ---------- attach ----------

VIEW_ATTACHERS.push(function attachSchedulerHandlers() {
  document.querySelectorAll("[data-sched-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scheduler.filter = btn.dataset.schedFilter;
      render();
    });
  });
  document.getElementById("sched-new-btn")?.addEventListener("click", () => openScheduleModal(null));
  document.getElementById("sched-prev-month")?.addEventListener("click", () => {
    const [y, m] = state.scheduler.cursor.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    state.scheduler.cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    render();
  });
  document.getElementById("sched-next-month")?.addEventListener("click", () => {
    const [y, m] = state.scheduler.cursor.split("-").map(Number);
    const d = new Date(y, m, 1);
    state.scheduler.cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    render();
  });
  document.querySelectorAll("[data-select-sched-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.scheduler.selectedDate = btn.dataset.selectSchedDate;
      render();
    });
  });
  document.querySelectorAll("[data-toggle-sched]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const s = state.scheduler.schedules.find((x) => x.id === btn.dataset.toggleSched);
      if (!s) return;
      try {
        await fetchJSON(`/api/schedule/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !s.enabled }) });
        await loadSchedules(true);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  });
  document.querySelectorAll("[data-edit-sched]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = state.scheduler.schedules.find((x) => x.id === btn.dataset.editSched);
      if (s) openScheduleModal(s);
    });
  });
  document.querySelectorAll("[data-delete-sched]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const s = state.scheduler.schedules.find((x) => x.id === btn.dataset.deleteSched);
      if (!s) return;
      openConfirmModal({
        title: "Delete this automation?",
        message: `"${s.label}" will stop firing and be permanently removed.`,
        onConfirm: async () => {
          await fetchJSON(`/api/schedule/${s.id}`, { method: "DELETE" });
          await loadSchedules(true);
          showToast("Deleted.");
        },
      });
    });
  });
});
