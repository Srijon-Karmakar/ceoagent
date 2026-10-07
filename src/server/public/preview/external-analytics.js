"use strict";

// Standalone dashboard for a connected external project's analytics — opened
// in its own browser tab from the Analytics page's "<project> analytics"
// button. Self-contained (own fetch/render loop), same pattern as the main
// preview app.js but scoped to one page instead of the whole SPA shell.

const THEME_KEY = "theme"; // same key app.js uses, so the toggle stays in sync across tabs
(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  document.documentElement.setAttribute("data-theme", saved === "light" || saved === "dark" ? saved : "light");
})();

const RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

const METRICS = [
  { key: "visitors", label: "Unique visitors" },
  { key: "pageViews", label: "Page views" },
  { key: "linkVisits", label: "Link visits" },
  { key: "clicks", label: "Clicks" },
  { key: "logins", label: "Logins" },
  { key: "signups", label: "Sign-ups" },
  { key: "listingViews", label: "Listing views" },
  { key: "bookingStarts", label: "Booking attempts" },
];

const state = {
  range: "7d",
  metric: "visitors",
  data: null,
  loading: true,
  error: null,
  trendTableView: false,
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatCompact(n) {
  if (n == null) return "0";
  if (n < 10000) return n.toLocaleString();
  if (n < 1e6) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function niceCeil(value) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

async function load(range) {
  state.range = range;
  state.loading = true;
  state.error = null;
  render();
  try {
    const res = await fetch(`/api/analytics/external/dashboard?range=${encodeURIComponent(range)}`);
    if (res.status === 401) throw new Error("Not signed in — sign in from the main app first, in this same browser.");
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    state.data = await res.json();
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  }
  state.loading = false;
  render();
}

// ---------- line/area trend chart ----------

function buildTrendChart(daily, metricKey) {
  const W = 760, H = 220, padL = 42, padR = 12, padT = 16, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const values = daily.map((d) => d[metricKey] ?? 0);
  const niceMax = niceCeil(Math.max(...values, 1));
  const xStep = plotW / Math.max(values.length - 1, 1);

  const points = values.map((v, i) => ({
    x: padL + i * xStep,
    y: padT + plotH - (v / niceMax) * plotH,
    v,
    date: daily[i].date,
  }));

  const linePath = `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}`;
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} L${points[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const gridFracs = [0, 1 / 3, 2 / 3, 1];
  const gridlines = gridFracs
    .map((f) => {
      const y = padT + plotH * f;
      const val = Math.round(niceMax * (1 - f));
      return `
        <line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--border)" stroke-width="1" />
        <text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--text-faint)">${formatCompact(val)}</text>
      `;
    })
    .join("");

  const xLabelIdx = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
  const xLabels = [...new Set(xLabelIdx)]
    .map((i) => `<text x="${points[i].x}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="var(--text-faint)">${escapeHtml(formatDate(points[i].date))}</text>`)
    .join("");

  const last = points[points.length - 1];

  return {
    points,
    svg: `
      <svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="Trend chart">
        ${gridlines}
        <path d="${areaPath}" fill="var(--accent)" fill-opacity="0.1" stroke="none" />
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <circle cx="${last.x}" cy="${last.y}" r="4" fill="var(--accent)" stroke="var(--bg-raised)" stroke-width="2" />
        <text x="${Math.min(last.x + 8, W - padR - 24)}" y="${last.y - 8}" font-size="11" font-weight="700" fill="var(--text)">${formatCompact(last.v)}</text>
        ${xLabels}
        <line class="trend-crosshair" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}" stroke="var(--text-faint)" stroke-width="1" opacity="0" />
        <circle class="trend-hoverdot" r="4" fill="var(--accent)" stroke="var(--bg-raised)" stroke-width="2" opacity="0" />
        <rect class="trend-hit" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" />
      </svg>
    `,
  };
}

function attachTrendInteraction(points) {
  const svg = document.querySelector(".trend-svg");
  const hit = document.querySelector(".trend-hit");
  const crosshair = document.querySelector(".trend-crosshair");
  const dot = document.querySelector(".trend-hoverdot");
  const tooltip = document.getElementById("trend-tooltip");
  if (!svg || !hit || !tooltip) return;

  const metricLabel = METRICS.find((m) => m.key === state.metric)?.label || "";

  function handleMove(clientX) {
    const rect = svg.getBoundingClientRect();
    const scale = 760 / rect.width;
    const xUser = (clientX - rect.left) * scale;
    let nearest = points[0], best = Infinity;
    for (const p of points) {
      const d = Math.abs(p.x - xUser);
      if (d < best) { best = d; nearest = p; }
    }
    crosshair.setAttribute("x1", nearest.x);
    crosshair.setAttribute("x2", nearest.x);
    crosshair.setAttribute("opacity", "1");
    dot.setAttribute("cx", nearest.x);
    dot.setAttribute("cy", nearest.y);
    dot.setAttribute("opacity", "1");

    const wrap = svg.closest(".chart-wrap");
    const wrapRect = wrap.getBoundingClientRect();
    const px = rect.left - wrapRect.left + nearest.x / scale;
    const py = rect.top - wrapRect.top + nearest.y / scale;
    tooltip.style.left = `${px}px`;
    tooltip.style.top = `${py}px`;
    tooltip.classList.add("show");
    tooltip.querySelector(".ct-value").textContent = `${formatCompact(nearest.v)} ${metricLabel}`;
    tooltip.querySelector(".ct-date").textContent = formatDate(nearest.date);
  }

  hit.addEventListener("pointermove", (e) => handleMove(e.clientX));
  hit.addEventListener("pointerleave", () => {
    crosshair.setAttribute("opacity", "0");
    dot.setAttribute("opacity", "0");
    tooltip.classList.remove("show");
  });
}

// ---------- section renderers ----------

function renderHeader(data) {
  return `
    <div class="viz-header">
      <div class="viz-title-group">
        <h1 class="viz-title">${escapeHtml(data.label || "Connected Project")}</h1>
        <p class="viz-subtitle">Real-time analytics, read live from the connected project.</p>
      </div>
      <div class="viz-range-group">
        ${RANGES.map((r) => `<button type="button" class="viz-range-btn${state.range === r.key ? " active" : ""}" data-range="${r.key}">${r.label}</button>`).join("")}
      </div>
      <button type="button" class="viz-icon-btn" id="refresh-btn" aria-label="Refresh" title="Refresh">${icon("refresh-cw")}</button>
    </div>
  `;
}

function deltaBadge(pct) {
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const sign = pct > 0 ? "↑" : pct < 0 ? "↓" : "";
  return `<span class="delta ${dir}">${sign} ${Math.abs(pct)}%</span>`;
}

function renderStatTiles(data) {
  const { current, pctChange } = data.totals;
  return `
    <div class="stat-tiles">
      ${METRICS.map(
        (m) => `
        <div class="stat-tile">
          <div class="stat-tile-head">
            <div class="stat-tile-value">${formatCompact(current[m.key])}</div>
            ${deltaBadge(pctChange[m.key])}
          </div>
          <div class="stat-tile-label">${escapeHtml(m.label)}</div>
        </div>
      `,
      ).join("")}
    </div>
  `;
}

function renderTrendSection(data) {
  const { svg, points } = buildTrendChart(data.daily, state.metric);
  const tableRows = data.daily
    .map((d) => `<tr><td>${escapeHtml(formatDate(d.date))}</td><td>${formatCompact(d[state.metric] ?? 0)}</td></tr>`)
    .join("");
  return `
    <div class="card viz-section">
      <div class="chart-card-head">
        <span class="card-title">Trend over time</span>
        <button type="button" class="table-toggle-btn" id="trend-table-toggle">${state.trendTableView ? "View as chart" : "View as table"}</button>
      </div>
      <div class="page-tabs" style="margin-bottom:14px">
        ${METRICS.map((m) => `<button type="button" class="page-tab${state.metric === m.key ? " active" : ""}" data-metric="${m.key}">${escapeHtml(m.label)}</button>`).join("")}
      </div>
      ${
        state.trendTableView
          ? `<table class="viz-sr-table"><thead><tr><th>Date</th><th>${escapeHtml(METRICS.find((m) => m.key === state.metric)?.label || "")}</th></tr></thead><tbody>${tableRows}</tbody></table>`
          : `
          <div class="chart-wrap">
            ${svg}
            <div class="chart-tooltip" id="trend-tooltip"><div class="ct-value"></div><div class="ct-date"></div></div>
          </div>
        `
      }
      <div data-trend-points='${JSON.stringify(points.map((p) => ({ x: p.x, y: p.y, v: p.v, date: p.date })))}' style="display:none"></div>
    </div>
  `;
}

function renderEventBreakdown(data) {
  const rows = METRICS.filter((m) => m.key !== "visitors")
    .map((m) => ({ label: m.label, value: data.totals.current[m.key] }))
    .sort((a, b) => b.value - a.value);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `
    <div class="card viz-section">
      <div class="card-head"><span class="card-title">Events this period</span></div>
      ${rows
        .map(
          (r) => `
        <div class="rank-row">
          <span class="rank-label">${escapeHtml(r.label)}</span>
          <span class="rank-bar-track"><span class="rank-bar-fill" style="width:${(r.value / max) * 100}%"></span></span>
          <span class="rank-value">${formatCompact(r.value)}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderFunnel(data) {
  const base = data.funnel[0]?.count || 1;
  return `
    <div class="card viz-section">
      <div class="card-head"><span class="card-title">Conversion funnel</span></div>
      ${data.funnel
        .map((f, i) => {
          const pctOfBase = Math.round((f.count / base) * 100);
          const opacity = 0.4 + i * (0.6 / Math.max(data.funnel.length - 1, 1));
          return `
          <div class="funnel-row">
            <div class="funnel-row-head">
              <span class="funnel-row-label">${escapeHtml(f.stage)}</span>
              <span class="funnel-row-meta">${formatCompact(f.count)} · ${pctOfBase}%</span>
            </div>
            <div class="funnel-track"><div class="funnel-fill" style="width:${pctOfBase}%;opacity:${opacity.toFixed(2)}"></div></div>
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

function renderDevice(data) {
  if (!data.device.length) return "";
  const slotVar = (i) => `var(--series-${(i % 3) + 1})`;
  return `
    <div class="card viz-section">
      <div class="card-head"><span class="card-title">Audience — device</span></div>
      <div class="device-track">
        ${data.device.map((d, i) => `<span class="device-seg" style="width:${d.pct}%;background:${slotVar(i)}"></span>`).join("")}
      </div>
      <div class="device-legend">
        ${data.device
          .map(
            (d, i) => `
          <span class="device-legend-item">
            <span class="device-legend-dot" style="background:${slotVar(i)}"></span>
            <span class="device-legend-label">${escapeHtml(d.device)}</span>
            <span class="device-legend-meta">${d.pct}% · ${formatCompact(d.visitors)}</span>
          </span>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderRankCard(title, items, labelKey, valueKey, valueFormatter) {
  if (!items.length) return `<div class="card viz-section"><div class="card-head"><span class="card-title">${escapeHtml(title)}</span></div><div class="stub-placeholder" style="padding:24px">No data in this period.</div></div>`;
  const max = Math.max(...items.map((it) => it[valueKey]), 1);
  return `
    <div class="card viz-section">
      <div class="card-head"><span class="card-title">${escapeHtml(title)}</span></div>
      ${items
        .map(
          (it) => `
        <div class="rank-row">
          <span class="rank-label">${escapeHtml(it[labelKey])}</span>
          <span class="rank-bar-track"><span class="rank-bar-fill" style="width:${(it[valueKey] / max) * 100}%"></span></span>
          <span class="rank-value">${valueFormatter ? valueFormatter(it) : formatCompact(it[valueKey])}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderHeatmap(data) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byDow = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const c of data.peakHours.cells) byDow[c.dow][c.hour] = c.count;
  const max = data.peakHours.max || 1;

  const hourHeaderCells = Array.from({ length: 24 }, (_, h) => `<div class="heatmap-hour-label">${h % 3 === 0 ? h : ""}</div>`).join("");
  const rows = DAYS.map((dayLabel, dow) => {
    const cells = byDow[dow]
      .map((count, hour) => {
        const opacity = count === 0 ? 0 : 0.12 + (count / max) * 0.88;
        return `<div class="heatmap-cell" style="opacity:${opacity.toFixed(2)}" tabindex="0" role="img" aria-label="${escapeHtml(dayLabel)} ${hour}:00, ${count} events"><title>${escapeHtml(dayLabel)} ${hour}:00 — ${count} event${count === 1 ? "" : "s"}</title></div>`;
      })
      .join("");
    return `<div class="heatmap-day-label">${dayLabel}</div>${cells}`;
  }).join("");

  return `
    <div class="card viz-section">
      <div class="card-head"><span class="card-title">Peak hours (UTC)</span></div>
      <div class="heatmap-scroll">
        <div class="heatmap-grid">
          <div></div>${hourHeaderCells}
          ${rows}
        </div>
      </div>
    </div>
  `;
}

// ---------- top-level render ----------

function render() {
  const app = document.getElementById("app");
  if (state.loading && !state.data) {
    app.innerHTML = `<div class="stub-placeholder">Loading…</div>`;
    return;
  }
  if (state.error) {
    app.innerHTML = `<div class="stub-placeholder">Couldn't load analytics: ${escapeHtml(state.error)}</div>`;
    return;
  }
  const data = state.data;
  if (!data || !data.configured) {
    app.innerHTML = `<div class="stub-placeholder">No analytics source connected. Go back and connect one from Accounts.</div>`;
    return;
  }
  if (data.error) {
    app.innerHTML = `<div class="stub-placeholder">Connected, but the last fetch failed: ${escapeHtml(data.error)}</div>`;
    return;
  }

  document.title = `${data.label || "Connected Project"} Analytics · CeoAgent`;

  app.innerHTML = `
    ${renderHeader(data)}
    ${renderStatTiles(data)}
    ${renderTrendSection(data)}
    <div class="viz-section" style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      ${renderEventBreakdown(data)}
      ${renderFunnel(data)}
    </div>
    ${renderDevice(data)}
    <div class="viz-section" style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      ${renderRankCard("Top pages", data.topPages, "path", "views")}
      ${renderRankCard("Traffic sources", data.sources, "source", "visitors")}
    </div>
    ${renderRankCard("Exit pages", data.exitPages, "path", "exits", (it) => `${formatCompact(it.exits)} · ${it.exitRate}% exit`)}
    ${renderHeatmap(data)}
  `;

  if (window.lucide) lucide.createIcons();
  attachHandlers();
  if (!state.trendTableView) {
    const holder = document.querySelector("[data-trend-points]");
    if (holder) attachTrendInteraction(JSON.parse(holder.dataset.trendPoints));
  }
}

function icon(name) {
  return `<i data-lucide="${escapeHtml(name)}"></i>`;
}

function attachHandlers() {
  document.querySelectorAll("[data-range]").forEach((btn) => {
    btn.addEventListener("click", () => load(btn.dataset.range));
  });
  document.querySelectorAll("[data-metric]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.metric = btn.dataset.metric;
      render();
    });
  });
  document.getElementById("refresh-btn")?.addEventListener("click", () => load(state.range));
  document.getElementById("trend-table-toggle")?.addEventListener("click", () => {
    state.trendTableView = !state.trendTableView;
    render();
  });
}

load(state.range);
