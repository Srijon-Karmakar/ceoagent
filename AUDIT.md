# Architecture & Security Audit — CEO Agent OS

**Audited:** 2026-10-08 · **Commit:** `319c3f8` (main) · **Scope:** server (`src/`), both UIs (`src/server/public/`), storage, repo hygiene, tests.

Line references are as of the commit above and may drift — search for the named function if a line no longer matches. Tick items off in the [action plan](#prioritized-action-plan) as they're fixed, and add a dated note under [Change log](#change-log).

---

## Executive summary

The core is better engineered than most projects at this stage: TypeScript compiles cleanly, writes are atomic, there are per-tenant guardrails on spend and outbound actions ([src/guardrails.ts](src/guardrails.ts)), a path-escape guard on the file browser ([src/server/files.ts](src/server/files.ts) `resolve…` ~L56-75), and DOMPurify on rendered markdown. Comments explain *why*, which makes the code auditable.

The central problem is that a **single-user desktop tool became a multi-tenant web app without changing its trust model**. The most serious result: **any signed-in user can run arbitrary shell commands on the server** through the Developer agent (`Bash` + `permissionMode: "dontAsk"`, and `cwd` is not a sandbox). From there they can read every other organization's data, OAuth tokens and the server's `.env`. The same can be triggered by prompt injection from an email or web page an agent reads. Also urgent: 21 browser profiles (`Cookies`, `Login Data`, `History`) are committed and pushed to both GitHub remotes, and WhatsApp webhooks accept unsigned payloads. On performance, every streamed agent event rewrites the org's entire `runs.json` (largest already 1.6 MB), and every API request makes a network call to Supabase.

---

## Critical vulnerabilities

| # | Severity | Finding | Where |
|---|---|---|---|
| **S1** | **Critical** | **Remote code execution for any signed-in user.** Developer agent has `Bash`/`Read`/`Write` with `permissionMode: "dontAsk"`; the CEO session allows every built-in tool. `cwd` only sets the starting folder — `cat ../../../.env`, `cat ../../data/tenants.json`, or reading another org's `gmail-token.json` all work. Prompt injection via emails / web pages / WhatsApp text read by any agent can trigger it with no malicious user. Self-signup exists in the UI ([src/server/public/app.js](src/server/public/app.js) ~L535). | [src/orchestrator.ts](src/orchestrator.ts) `runCeoAgent` ~L275-287, `runSpecialistAgent` ~L314-319; [src/agents.ts](src/agents.ts) `developerAgent` ~L146 |
| **S2** | **High** | **Browser profiles committed and pushed.** `.tmp/` = 3,669 files across 21 Chrome/Edge profiles incl. `Cookies`, `Login Data`, `Web Data`, `History`. Windows DPAPI encryption limits cookie/password exposure, and no Supabase tokens were found in committed Local Storage, but history and site data are exposed. Added in `7be5191`; present on `origin/main` and `second/main`. | `.tmp/**`, [.gitignore](.gitignore) |
| **S3** | **High** | **Tenant data not git-ignored.** `orgs/` (every customer's tokens, settings with API keys, run history) is not in `.gitignore` — one `git add .` pushes it. Same for `server*.log`, `scratch/`, `deliverables/`, `.tmp/`. `deliverables/EEC_Potential_Customers.xlsx` (looks like real lead data) is already committed. | [.gitignore](.gitignore) |
| **S4** | **High** | **WhatsApp webhooks don't verify Meta's signature.** `POST /webhook/whatsapp/:orgId` accepts any JSON without checking `X-Hub-Signature-256`. Anyone who knows an org ID can forge inbound messages → the tenant's business number sends AI replies to any `from` number (spam, Meta ban risk, LLM spend), bypassing outbound guardrails. Untenanted `/webhook/whatsapp` runs on server-wide keys. | [src/server/index.ts](src/server/index.ts) `handleWhatsappMessages` ~L1423-1444, routes ~L1446-1490 |
| **S5** | **High** | **One automation key unlocks every org.** Global `AUTOMATION_API_KEY` + client-supplied `X-Organization-Id` header can act as any tenant. | [src/server/auth.ts](src/server/auth.ts) `requireAutomationTenant` ~L304-325 |
| **S6** | **Medium** | **Tenants silently share operator credentials.** `getEnvValue` falls back to the server `.env` when an org hasn't set a key — Org A's agents may use *your* Linear/Reddit/etc. Settings also shows every tenant the first/last 4 chars of the operator's keys. | [src/server/settings.ts](src/server/settings.ts) `getEnvValue` ~L112, `getMaskedSettings` ~L127 |
| **S7** | **Medium** | **OAuth callbacks accept a missing `state`** and fall back to the session cookie → login-CSRF account linking (attacker's Gmail/LinkedIn connected to victim's org). Error messages are reflected unescaped into HTML. | [src/server/auth.ts](src/server/auth.ts) `resolveAuthFlowTenant` ~L64; [src/server/index.ts](src/server/index.ts) `/auth/*/callback` ~L1551+ |
| **S8** | **Low** | CSP disabled; `MAX_COST_USD_PER_DAY` off by default; file browser would follow symlinks an agent creates in the workspace. | [src/server/index.ts](src/server/index.ts) helmet ~L199; [src/guardrails.ts](src/guardrails.ts) |

## Bottlenecks

| # | Impact | Finding | Where |
|---|---|---|---|
| **B1** | High | **Full run-history rewrite on every streamed event.** `appendEvent` → `persist()` synchronously serializes *all* of an org's runs+events (blocks the event loop); in Postgres mode also deep-copies and upserts the whole document per event. | [src/server/store.ts](src/server/store.ts) `persist` ~L70, `appendEvent` ~L128 |
| **B2** | High | **Supabase network round-trip on every authenticated request**, including the 10 s poll (6 parallel calls). | [src/server/auth.ts](src/server/auth.ts) `verifyAccessToken` ~L185, `readRequestTenant` ~L240 |
| **B3** | Medium | **Hard single-process limit.** Storage cache, SSE emitters, run controllers, scheduler timers and the OAuth state secret are all in-memory. Documented in `storage.ts`, not enforced. | [src/storage.ts](src/storage.ts), [src/server/auth.ts](src/server/auth.ts) `OAUTH_STATE_SECRET` |
| **B4** | Medium | **Documents bypass the storage layer** — plain `writeFile` (not atomic, read-modify-write race), never reach Postgres, and live inside the Developer agent's workspace where Bash can read/alter them. | [src/tools/documents.ts](src/tools/documents.ts) (`.documents` index) |

---

## Code quality & architecture critique

- **Very large files.** [src/server/index.ts](src/server/index.ts) (~1,750 lines: routes, webhooks, OAuth, uploads, startup — only `filesRoutes.ts` split out). Frontend has no build step: [public/app.js](src/server/public/app.js) (~6,700), [public/preview/app.js](src/server/public/preview/app.js) (~3,700), [public/style.css](src/server/public/style.css) (~8,850, with duplicated selectors such as `textarea` / `.reply-form textarea`).
- **Two full UIs maintained in parallel** — "ceopro" (`public/preview/`) and "ceounik" (`public/app.js`) each implement composer, runs, CRM, memory… Every fix lands twice. ceopro has no login screen, so it depends on ceounik.
- **Full-page re-render on every SSE event / poll.** `render()` replaces all of `#app`; focus, scroll, drafts, Lenis and animations each need hand-written save/restore. Anything without it breaks (root cause of the 2026-10-08 prompt-box focus bug). Targeted DOM updates or a small reactive layer would remove this bug class.
- **Persistence is a whole-JSON-blob key-value store** behind a file-path API ([src/storage.ts](src/storage.ts)). Good migration bridge; no schema, no queries, no append. Runs/events/leads are relational data stored as single documents.
- **Electron leftovers in a web-only project:** [electron/](electron/), `electron-builder` scripts/deps, `CEO_AGENT_DATA_DIR`, `monitorElectronParent` in `server/index.ts`, `focusWindow` calls, and auth.ts comments justifying design by Electron webview limits.
- **Repo hygiene:** committed `debug.cjs`, `verify.cjs`, `prompt.md`, `generate_project_presentations.py`, `UI/*.png`, an Office lock file (`deliverables/~$CEO-Agent-OS_Technical-Deck.pptx`), `server.err.log`. `.env.example` is git-ignored although PROJECT_DETAILS.md tells readers to use it.
- **Done well:** atomic writes, constant-time key compare, signed + expiring OAuth state, cost-aware rate limits, outbound kill switch + audit log, file-browser escape guard, DOMPurify.

## Testing & reliability

- **Thin coverage:** 4 test files (~230 lines). `vitest run` at audit time: 15 passed, 3 skipped (Postgres tests need `DATABASE_URL`). `tsc --noEmit`: clean.
- **Untested:** auth and tenant isolation, every HTTP route, file-path escape, WhatsApp webhook, OAuth state, scheduler, run lifecycle (cancel/reply/resume), provider fallback end-to-end, frontend.
- **Highest-value missing test:** a tenant-isolation suite — org A must be unable to read/modify org B's runs, files, settings or documents via any route or agent tool. Would have caught S1, S5, S6.
- **Reliability gaps:** Postgres write retry queue is memory-only (process crash during an outage = data loss); document index has a lost-update race; in-process scheduler misses jobs across restarts and would double-fire with two instances.

---

## Prioritized action plan

### P0 — this week (high impact, mostly low effort)

- [x] **S1** *(2026-10-08: Bash off unless `ALLOW_AGENT_SHELL=true`; Codex provider off too and given a stripped env; PreToolUse workspace guard in `src/agentSandbox.ts`. Containerised shell not done.)* — Remove `Bash` from the Developer agent and the CEO session's tool ceiling, or disable the Developer agent in multi-tenant mode. If shell is required: run it in a per-job container with no host filesystem, no secrets in env, restricted network. Also block absolute paths / `..` in Read/Write/Edit via a `PreToolUse` hook. *(S to disable, L for containers)*
- [ ] **S2/S3** *(2026-10-08: partly done — `.tmp/`, logs, Office lock file and the EEC customer sheet untracked; `.gitignore` covers `orgs/`, `.tmp/`, `scratch/`, `*.log`, `deliverables/`, `~$*`. `.env.example` deliberately stays ignored: the local copy holds real keys. **Open:** commit the untracking, and purge history if a repo is/was public.)* — `git rm -r --cached .tmp`; add `orgs/`, `.tmp/`, `scratch/`, `*.log`, `deliverables/`, `~$*` to `.gitignore`; un-ignore `.env.example`. If either repo is or was public: purge history (`git filter-repo`) and sign out of accounts used in those profiles. *(S)*
- [x] **S4** *(2026-10-08: `verifyWhatsappSignature` with new `WHATSAPP_APP_SECRET` setting, fails closed; unscoped route 404s when Supabase auth is on; auto-replies go through `checkOutbound`.)* — Verify `X-Hub-Signature-256` (per-tenant `WHATSAPP_APP_SECRET`, constant-time compare over the raw body); remove untenanted webhook routes; count auto-replies against outbound guardrails. *(S)*
- [x] **S7** *(2026-10-08: `state` required, no cookie fallback; errors sent as text/plain.)* — Require `state` on every `/auth/*/callback` (drop cookie fallback); HTML-escape error output. *(S)*

### P1 — next 2–4 weeks

- [x] **S5** *(2026-10-08: key read from the org's own Settings, never the server env; uniform 401s. `X-Organization-Id` kept to locate the org; keys stored as entered, not hashed.)* — Per-org automation keys (store a hash; org derived from the key; drop `X-Organization-Id`). *(M)*
- [x] **S6** *(2026-10-08: explicit `SHARED_WITH_ORGS` allowlist in `settings.ts` — model keys, OAuth app identities, ScrapeGraph/Hunter; everything else org-only. Orgs see "provided by server", no key fragments. Revisit the allowlist once open question 3 is answered.)* — Decide which operator keys are intentionally shared (likely only `ANTHROPIC_API_KEY`); stop falling back for the rest; stop showing masked operator keys to tenants. *(S)*
- [x] **B2** *(2026-10-08: 60 s cache keyed by token hash, parallel calls coalesced.)* — Cache verified sessions ~60 s, or verify Supabase JWTs locally. *(S)*
- [x] **B1** *(2026-10-08: event writes batched per org every 500 ms; other mutations and shutdown flush immediately.)* — Debounce `persist()` (≤ every 500 ms per org + on finish), or move events to an append-only per-run log. *(S–M)*
- [ ] **B4** *(2026-10-08: partly done — atomic writes + per-index lock; agents' file tools blocked from `.documents`. Still not in Postgres; kept in the workspace because of the delegated-write issue described in `src/workspace.ts`.)* — Move documents into `storage.ts`, outside the agent workspace. *(S)*
- [ ] **Tests/S8** *(2026-10-08: partly done — `test/security.test.ts` covers the sandbox, webhook signatures, settings isolation and automation keys. Open: HTTP route suite, default `MAX_COST_USD_PER_DAY` (needs a number from you), CSP.)* — Tenant-isolation suite + supertest route tests; set a default `MAX_COST_USD_PER_DAY`. *(M)*

### Long-term refactors

- [ ] Relational Postgres schema (`runs`, `run_events`, `leads`, `documents`, `settings`) with `org_id` + row-level security, replacing the blob store — fixes B1 and B3, enables stateless servers.
- [ ] Split `server/index.ts` into per-domain route modules with Zod input validation (Zod is already a dependency).
- [ ] Pick one UI, delete the other; move it to components or targeted DOM updates with a build step.
- [ ] Out-of-process agent execution: job queue (pg-boss / BullMQ), workers, durable scheduler.
- [ ] Remove Electron leftovers; enable CSP once CDN origins are pinned.

---

## Open questions

These change severity or approach; record answers here when known.

1. Are `yarrowtech-intern2/CeoAgent` and `Srijon-Karmakar/ceoagent` public or private? (Decides whether S2 needs a history purge + account sign-outs.)
2. Is Supabase self-signup enabled in production, or invite-only? (Changes S1 exposure; prompt injection keeps it critical either way.)
3. Is the server `.env` meant to supply shared default keys for all tenants, or only Anthropic? (S6)
4. Does production run with `DATABASE_URL`, as one process? Expected orgs and runs/day? (B1, B3)
5. Do customers need the Developer agent to *execute* code, or only write files/documents? (S1 approach)
6. Has `AUTOMATION_API_KEY` been shared outside the team? (S5)

---

## Change log

- **2026-10-08** — Audit written at `319c3f8`. Same session, unrelated UI fixes: preview `render()` now restores focus/cursor (prompt-box bug); ceounik reply box draft kept in `state.replyDraft`; preview composer mic button wired to the Web Speech API.
- **2026-10-08** — Fix pass (uncommitted at time of writing): S1, S4, S5, S6, S7, B1, B2 fixed; S2/S3, B4, tests partly done (see checkboxes). New setting `WHATSAPP_APP_SECRET`; new env flag `ALLOW_AGENT_SHELL` (server env only, default off). Found during the fix: the local `.env.example` contains real Anthropic/DeepSeek/Hugging Face keys (never committed) — keep it ignored or replace values with placeholders.
