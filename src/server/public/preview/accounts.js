"use strict";

// Accounts/Connections — one GET /api/accounts call covers every
// integration (OAuth-capable and config-only alike); OAuth connect is a
// plain link navigation (not fetch — the browser needs to actually follow
// the redirect to the provider), disconnect is a real POST.

state.accounts = { items: [], loaded: false, loading: false, error: null };

async function loadAccounts(force) {
  if (state.accounts.loaded && !force) return;
  state.accounts.loading = true;
  render();
  try {
    state.accounts.items = await fetchJSON("/api/accounts");
    state.accounts.loaded = true;
    state.accounts.error = null;
  } catch (err) {
    state.accounts.error = err instanceof Error ? err.message : String(err);
  }
  state.accounts.loading = false;
  render();
}
LAZY_LOADERS.accounts = () => loadAccounts(false);

VIEW_RENDERERS.accounts = function renderAccountsPage() {
  if (state.accounts.loading && !state.accounts.loaded) return `<div class="stub-placeholder">Loading connections…</div>`;
  if (state.accounts.error) return `<div class="stub-placeholder">Couldn't load connections: ${escapeHtml(state.accounts.error)}</div>`;

  return `
    <div class="stub-page">
      <div class="stub-head">
        <h1 class="stub-title">Accounts</h1>
        <p class="stub-subtitle">Connect the accounts your agents can act through.</p>
      </div>
      <div class="account-grid">
        ${state.accounts.items.map(renderAccountCard).join("")}
      </div>
    </div>
  `;
};

function renderAccountCard(a) {
  const statusClass = a.connected ? "success" : "error";
  const statusLabel = a.connected ? "Connected" : a.unsupported ? "Unsupported" : "Not connected";
  return `
    <div class="card account-card">
      <div class="account-card-head">
        <span class="account-card-name">${escapeHtml(a.label)}</span>
        <span class="status-badge ${statusClass}">${statusLabel}</span>
      </div>
      ${a.configOnly ? `<p class="account-card-hint">${escapeHtml(a.configHint || "Configured via an API key in Settings.")}</p>` : ""}
      ${a.unsupported && a.reason ? `<p class="account-card-hint">${escapeHtml(a.reason)}</p>` : ""}
      <div class="account-card-actions">
        ${
          a.connectUrl
            ? a.connected
              ? `<button type="button" class="btn-secondary" data-disconnect="${a.key}">Disconnect</button>`
              : `<a class="btn-primary" href="${escapeHtml(a.connectUrl)}" target="_blank" rel="noopener">Connect</a>`
            : a.configOnly
              ? `<button type="button" class="btn-secondary" data-goto-settings>Configure in Settings</button>${a.signupUrl ? `<a class="btn-secondary" href="${escapeHtml(a.signupUrl)}" target="_blank" rel="noopener">Get a key</a>` : ""}`
              : ""
        }
      </div>
    </div>
  `;
}

VIEW_ATTACHERS.push(function attachAccountsHandlers() {
  document.querySelectorAll("[data-disconnect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const a = state.accounts.items.find((x) => x.key === btn.dataset.disconnect);
      if (!a) return;
      openConfirmModal({
        title: `Disconnect ${a.label}?`,
        message: "Agents will lose access to this account until you reconnect it.",
        confirmLabel: "Disconnect",
        onConfirm: async () => {
          await fetchJSON(`/api/accounts/${a.key}/disconnect`, { method: "POST" });
          await loadAccounts(true);
          showToast(`${a.label} disconnected.`);
        },
      });
    });
  });
  document.querySelectorAll("[data-goto-settings]").forEach((btn) => {
    btn.addEventListener("click", () => switchView("settings"));
  });
});
