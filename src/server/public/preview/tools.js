"use strict";

// Tools — "what can I ask for" showcase, one GET /api/tools call (a curated
// catalog distinct from /api/accounts — same connected/not status, but with
// usedBy/features/examplePrompt text that only lives on this endpoint).

state.toolsCatalog = { items: [], loaded: false, loading: false, error: null };

async function loadToolsCatalog(force) {
  if (state.toolsCatalog.loaded && !force) return;
  state.toolsCatalog.loading = true;
  render();
  try {
    state.toolsCatalog.items = await fetchJSON("/api/tools");
    state.toolsCatalog.loaded = true;
    state.toolsCatalog.error = null;
  } catch (err) {
    state.toolsCatalog.error = err instanceof Error ? err.message : String(err);
  }
  state.toolsCatalog.loading = false;
  render();
}
LAZY_LOADERS.tools = () => loadToolsCatalog(false);

VIEW_RENDERERS.tools = function renderToolsPage() {
  if (state.toolsCatalog.loading && !state.toolsCatalog.loaded) return `<div class="stub-placeholder">Loading tools…</div>`;
  if (state.toolsCatalog.error) return `<div class="stub-placeholder">Couldn't load tools: ${escapeHtml(state.toolsCatalog.error)}</div>`;
  const connected = state.toolsCatalog.items.filter((t) => t.connected);
  const notConnected = state.toolsCatalog.items.filter((t) => !t.connected);

  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Tools</h1>
        <p class="stub-subtitle">What your agents can actually do right now, based on what's connected.</p>
      </div>
      ${
        connected.length
          ? connected.map(renderToolCard).join("")
          : `<div class="stub-placeholder">Nothing connected yet — visit Accounts to connect an integration.</div>`
      }
      ${
        notConnected.length
          ? `<div class="stub-head" style="margin-top:16px"><h2 class="stub-title" style="font-size:16px">Not connected yet</h2></div>
             ${notConnected.map((t) => `<div class="stub-list-row"><span class="stub-list-title">${escapeHtml(t.label)}</span><span class="stub-list-meta">${(t.features || []).slice(0, 2).join(", ")}</span></div>`).join("")}`
          : ""
      }
    </div>
  `;
};

function renderToolCard(t) {
  return `
    <div class="card tool-card-page">
      <div class="card-head">
        <span class="card-title">${escapeHtml(t.label)}</span>
        <span class="status-badge success">Connected</span>
      </div>
      ${t.usedBy?.length ? `<p class="account-card-hint">Used by: ${t.usedBy.map(deptLabel).join(", ")}</p>` : ""}
      ${t.features?.length ? `<ul class="tool-feature-list">${t.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
      ${t.examplePrompt ? `<p class="tool-example-prompt">"${escapeHtml(t.examplePrompt)}"</p>` : ""}
    </div>
  `;
}
