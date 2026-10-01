# CEO Agent OS

**Package name:** `ceo-agent-os` · **Version:** 1.2.4

An AI-run "virtual company": a CEO agent receives a goal (typed in chat, emailed in, or triggered by automation) and delegates it to one of 13 specialist department agents, each backed by real tools (Linear, Gmail, LinkedIn, WhatsApp, a built-in CRM, document generation, etc.). It ships as both an Electron desktop app and a multi-tenant web app/server.

## What it does

The user (or an external trigger) gives the **CEO agent** a goal. The CEO:
1. Checks the system's permanent cross-agent memory for relevant standing context.
2. Decides whether the goal needs delegation and to which department(s).
3. Delegates via the Agent SDK's subagent mechanism, always **synchronously** (`run_in_background: false`) — enforced both in the CEO's system prompt and structurally via a `PreToolUse` hook in [orchestrator.ts](src/orchestrator.ts), because backgrounded delegate calls have been observed to silently lose their MCP tool results.
4. Reports back what was decided, who did it, and what they produced — honestly flagging anything unconfirmed (e.g. a "sent" claim with no message ID) rather than reporting it as done.

Specialists produce real artifacts: Linear tasks, saved documents, CRM leads, email drafts/sends, social posts/DMs, scheduled automations — not just chat replies.

## Departments / Agents

Defined in [src/agents.ts](src/agents.ts), rendered from [DEPARTMENTS](src/agents.ts):

| Key | Label | Role |
|---|---|---|
| `manager` | Manager | Breaks initiatives into sub-tasks, creates them in Linear |
| `hr` | HR | Onboarding docs, policies, job descriptions |
| `developer` | Developer | Reads/writes code, runs shell commands in a sandboxed workspace |
| `analysis` | Analysis | Web research → written analytical reports |
| `sales` | Sales | Outreach, proposals, cold-outreach campaigns, social posts/DMs |
| `crm` | CRM | Owns the local lead/pipeline CRM; prospecting and lead capture |
| `finance` | Finance | Budgets, expense summaries, financial write-ups |
| `seo` | SEO | Competitor/keyword research, dev-actionable SEO reports |
| `aeo` | AEO | Optimizing content to be cited by AI answer engines (ChatGPT, Perplexity, AI Overviews) |
| `emails` | Emails | Reads/drafts/sends from the connected Gmail inbox |
| `pr` | Public Relations | Press releases, media pitches, announcements |
| `calendar` | Calendar | Schedules one-time/recurring automations for any agent |
| `memory` | Memory | Permanent, cross-agent memory store (append/update only, no delete from chat) |

Every specialist agent runs with `background: false` and gets its tool list built per-run so it only sees tools for currently-connected integrations (see `buildAgentsRegistry()` in [agents.ts](src/agents.ts)).

## Architecture

- **Agent runtime:** `@anthropic-ai/claude-agent-sdk` — the CEO and specialists are `AgentDefinition`s invoked via `query()`. See [src/orchestrator.ts](src/orchestrator.ts) for the CEO system prompt, MCP server wiring, and event draining.
- **LLM provider fallback:** [src/providers/llmFallback.ts](src/providers/llmFallback.ts) chains Claude → OpenAI → DeepSeek → Ollama (local), so a rate-limited/expired/out-of-credit Claude account doesn't hard-fail a run. Fallback provider tool-calling is adapted via [src/providers/toolAdapter.ts](src/providers/toolAdapter.ts) / [toolRegistry.ts](src/providers/toolRegistry.ts).
- **Tools:** each integration lives in `src/tools/*.ts` as an MCP server + tool list + an `isXConnected()` gate (Linear, Gmail, Instagram, LinkedIn, Facebook, Zernio, Postiz, ScrapeGraphAI, Hunter.io, Canva, WhatsApp, n8n, Reddit, plus in-house CRM/playbook/portfolio/memory/scheduler/documents tools).
- **Server:** [src/server/index.ts](src/server/index.ts) — Express app serving the UI (`src/server/public`) and a JSON API for runs, settings, CRM, playbook, portfolio, memory, scheduling, OAuth callbacks for each integration, and file/document handling.
- **Multi-tenant / auth:** Supabase email auth gates web access (`src/server/auth.ts`); per-tenant data is isolated under `orgs/<organization-id>/...` (see [src/paths.ts](src/paths.ts) `runWithTenant`).
- **Desktop shell:** Electron ([electron/main.cjs](electron/main.cjs), [electron/preload.cjs](electron/preload.cjs)) wraps the same server/UI for a native Windows app, built via `electron-builder`.
- **CLI:** [src/index.ts](src/index.ts) — `npm run cli -- "<goal>"` runs the CEO agent headlessly from the terminal.
- **Scheduler:** [src/scheduler.ts](src/scheduler.ts) + Calendar agent — structured (not cron) recurrence: once/daily/weekly, persisted per tenant, fires an agent's goal automatically.

## Integrations (env-gated, all optional except Anthropic)

Configured via `.env` (see [.env.example](.env.example) for full setup notes per integration):

- **Anthropic** (`ANTHROPIC_API_KEY`) — required, powers the CEO/specialist agents
- **Supabase** — auth for web/SaaS deployment
- **Linear** — Manager agent's task tracker
- **Gmail** (Google OAuth) — Emails agent
- **Instagram / LinkedIn / Facebook Groups** (Meta/LinkedIn OAuth) — Sales/PR agents
- **Zernio** / **Postiz** — unified multi-platform social posting/DM APIs
- **ScrapeGraphAI** — structured web extraction for Analysis/SEO/AEO/CRM
- **Hunter.io** — email finder for CRM prospecting
- **Canva** — designed-graphic creation via Connect API
- **WhatsApp Cloud API** — direct messaging + inbound auto-reply webhook (FAQ match, Haiku/OpenAI fallback)
- **n8n** — CEO/Manager-triggered outbound workflows, plus an inbound run-finished webhook (`WEBHOOK_URL`)
- **Reddit** — SEO/AEO agents auto-publish report summaries to pre-approved subreddits
- **OpenAI / DeepSeek / Ollama / Hugging Face / Pollinations** — LLM and image-generation fallback chain

## Data & storage

Per-tenant runtime data (see [DEPLOYMENT.md](DEPLOYMENT.md)):
- `data/tenants.json` — tenant registry
- `orgs/<organization-id>/data/{runs,settings}.json`
- OAuth token files (`gmail-token.json`, `instagram-token.json`, `linkedin-token.json`, …)
- `orgs/<organization-id>/workspace/` — Developer agent's sandboxed workspace
- `orgs/<organization-id>/deliverables/` — generated documents/exports
- `data/post-images/` — local drop folder for Sales agent image posting

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Run the Express server (`tsx src/server/index.ts`) |
| `npm run cli -- "<goal>"` | Run the CEO agent once from the terminal |
| `npm run build` | `tsc` + copy static assets ([scripts/copy-assets.mjs](scripts/copy-assets.mjs)) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run electron:dev` | Build then launch the Electron desktop shell |
| `npm run dist:win` | Build a Windows installer (no publish) |
| `npm run release` | Build and publish a Windows release via `electron-builder` |

## Deployment

Two supported modes, documented separately:
- **Desktop (Electron/Windows):** built via `electron-builder`, configured in [electron-builder.yml](electron-builder.yml).
- **VPS / web (multi-tenant SaaS):** [DEPLOYMENT.md](DEPLOYMENT.md) — Ubuntu + Nginx + Certbot + Node 22, Supabase-gated, compiled server run from `dist/server/index.js`.
- [OFFICE_LOCAL_SETUP.md](OFFICE_LOCAL_SETUP.md) covers local/office network setup specifics.

## Tech stack

TypeScript (ESM, `tsx` for dev), Express, `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, Zod, Electron + `electron-builder`, `googleapis` (Gmail/OAuth), `exceljs`/`mammoth`/`pdf-parse` (document/attachment handling), `ai` SDK + `@ai-sdk/openai` + `@ai-sdk/deepseek` (fallback providers).
