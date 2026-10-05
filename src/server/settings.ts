import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, getTenantContext } from "../paths.js";

function settingsFile(): string {
  return join(getDataDir(), "settings.json");
}

interface FieldMeta {
  envVar: string;
  label: string;
  group: string;
}

// Every credential from .env.example except PORT and the *_REDIRECT_URI
// vars — those stay env-only. Gmail/Instagram/LinkedIn redirect URIs are
// pre-registered in each provider's developer console against this app's
// fixed default port (3000); exposing them here would let a user silently
// break OAuth logins by editing a field with no visible connection to that
// registration.
const FIELDS: FieldMeta[] = [
  { envVar: "ANTHROPIC_API_KEY", label: "Anthropic API key", group: "Anthropic" },
  { envVar: "SUPABASE_URL", label: "Supabase project URL", group: "Supabase Auth" },
  { envVar: "SUPABASE_ANON_KEY", label: "Supabase anon key", group: "Supabase Auth" },
  { envVar: "LINEAR_API_KEY", label: "Linear API key", group: "Linear" },
  { envVar: "LINEAR_TEAM_ID", label: "Linear team ID", group: "Linear" },
  { envVar: "GOOGLE_CLIENT_ID", label: "Google client ID", group: "Gmail" },
  { envVar: "GOOGLE_CLIENT_SECRET", label: "Google client secret", group: "Gmail" },
  { envVar: "SES_SMTP_HOST", label: "SES SMTP host", group: "AWS SES" },
  { envVar: "SES_SMTP_PORT", label: "SES SMTP port (default 587)", group: "AWS SES" },
  { envVar: "SES_SMTP_USER", label: "SES SMTP username", group: "AWS SES" },
  { envVar: "SES_SMTP_PASS", label: "SES SMTP password", group: "AWS SES" },
  { envVar: "SES_FROM_EMAIL", label: "SES from address", group: "AWS SES" },
  { envVar: "META_APP_ID", label: "Meta app ID", group: "Instagram" },
  { envVar: "META_APP_SECRET", label: "Meta app secret", group: "Instagram" },
  { envVar: "LINKEDIN_CLIENT_ID", label: "LinkedIn client ID", group: "LinkedIn" },
  { envVar: "LINKEDIN_CLIENT_SECRET", label: "LinkedIn client secret", group: "LinkedIn" },
  { envVar: "FACEBOOK_CLIENT_ID", label: "Facebook app ID", group: "Facebook" },
  { envVar: "FACEBOOK_CLIENT_SECRET", label: "Facebook app secret", group: "Facebook" },
  { envVar: "FACEBOOK_GROUP_IDS", label: "Allowed Facebook Group IDs (comma-separated, requires Meta App Review for publish_to_groups)", group: "Facebook" },
  { envVar: "ZERNIO_API_KEY", label: "Zernio API key", group: "Zernio" },
  { envVar: "POSTIZ_API_KEY", label: "Postiz API key", group: "Postiz" },
  { envVar: "POSTIZ_BASE_URL", label: "Postiz base URL (self-hosted only, blank = Postiz cloud)", group: "Postiz" },
  { envVar: "SCRAPEGRAPH_API_KEY", label: "ScrapeGraphAI API key", group: "ScrapeGraph" },
  { envVar: "HUNTER_API_KEY", label: "Hunter.io API key", group: "Hunter" },
  { envVar: "CANVA_CLIENT_ID", label: "Canva client ID", group: "Canva" },
  { envVar: "CANVA_CLIENT_SECRET", label: "Canva client secret", group: "Canva" },
  { envVar: "WHATSAPP_ACCESS_TOKEN", label: "WhatsApp access token", group: "WhatsApp" },
  { envVar: "WHATSAPP_PHONE_NUMBER_ID", label: "WhatsApp phone number ID", group: "WhatsApp" },
  { envVar: "WHATSAPP_BUSINESS_ACCOUNT_ID", label: "WhatsApp business account ID", group: "WhatsApp" },
  { envVar: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", label: "WhatsApp webhook verify token", group: "WhatsApp" },
  { envVar: "WHATSAPP_AGENT_OPENAI_MODEL", label: "WhatsApp agent OpenAI model", group: "WhatsApp AI" },
  { envVar: "WHATSAPP_AGENT_KNOWLEDGE_FILES", label: "WhatsApp agent knowledge files (; separated)", group: "WhatsApp AI" },
  { envVar: "WHATSAPP_HANDOFF_EMAIL", label: "WhatsApp handoff email", group: "WhatsApp AI" },
  { envVar: "WHATSAPP_HANDOFF_PHONE", label: "WhatsApp handoff phone", group: "WhatsApp AI" },
  { envVar: "CODEX_API_KEY", label: "Codex API key (optional — blank uses local `codex login` auth)", group: "Codex" },
  { envVar: "OPENAI_API_KEY", label: "OpenAI API key", group: "OpenAI" },
  { envVar: "DEEPSEEK_API_KEY", label: "DeepSeek API key", group: "DeepSeek" },
  { envVar: "CODEX_CEO_MODEL", label: "CEO fallback Codex model (blank = Codex CLI default)", group: "CEO Agent Fallback" },
  { envVar: "OPENAI_CEO_MODEL", label: "CEO fallback OpenAI model (default gpt-4o)", group: "CEO Agent Fallback" },
  { envVar: "DEEPSEEK_CEO_MODEL", label: "CEO fallback DeepSeek model (default deepseek-chat)", group: "CEO Agent Fallback" },
  { envVar: "OLLAMA_BASE_URL", label: "Ollama base URL (e.g. http://localhost:11434/v1) — last-resort free fallback, unset = disabled", group: "CEO Agent Fallback" },
  { envVar: "OLLAMA_MODEL", label: "Ollama model (default llama3.1) — must be a tool-calling-capable model you've pulled", group: "CEO Agent Fallback" },
  { envVar: "HUGGINGFACE_API_KEY", label: "Hugging Face API key", group: "Hugging Face" },
  { envVar: "REDDIT_CLIENT_ID", label: "Reddit client ID", group: "Reddit" },
  { envVar: "REDDIT_CLIENT_SECRET", label: "Reddit client secret", group: "Reddit" },
  { envVar: "REDDIT_USERNAME", label: "Reddit username", group: "Reddit" },
  { envVar: "REDDIT_PASSWORD", label: "Reddit password", group: "Reddit" },
  { envVar: "REDDIT_ALLOWED_SUBREDDITS", label: "Allowed subreddits (comma-separated, no r/ prefix)", group: "Reddit" },
  { envVar: "AUTOMATION_API_KEY", label: "Automation API key", group: "Automation" },
  { envVar: "WEBHOOK_URL", label: "Webhook URL", group: "Automation" },
  { envVar: "N8N_WORKFLOWS", label: "n8n workflows (JSON)", group: "Automation" },
];

type SettingsFile = Record<string, string>;

function readSettingsFile(): SettingsFile {
  const SETTINGS_FILE = settingsFile();
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettingsFile(data: SettingsFile) {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(data, null, 2));
}

/**
 * Populates process.env from the persisted settings file — called once at
 * server startup. Only fills in vars that aren't already set, so a dev
 * `.env` (loaded earlier via dotenv/config) always wins over settings.json,
 * and packaged installs (no .env) are driven entirely by settings.json.
 */
export function loadSettingsIntoEnv() {
  const saved = readSettingsFile();
  for (const { envVar } of FIELDS) {
    if (!process.env[envVar] && saved[envVar]) {
      process.env[envVar] = saved[envVar];
    }
  }
}

export function getEnvValue(envVar: string): string | undefined {
  const tenantValue = getTenantContext() ? readSettingsFile()[envVar] : undefined;
  return tenantValue || process.env[envVar];
}

function mask(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export interface MaskedField {
  envVar: string;
  label: string;
  group: string;
  isSet: boolean;
  masked: string | null;
}

export function getMaskedSettings(): MaskedField[] {
  return FIELDS.map(({ envVar, label, group }) => {
    const value = getEnvValue(envVar);
    return {
      envVar,
      label,
      group,
      isSet: Boolean(value),
      masked: value ? mask(value) : null,
    };
  });
}

/**
 * Applies any non-blank fields from `partial` to settings.json. In tenant
 * requests, values stay scoped to that organization; global process.env is
 * only changed for the legacy/no-tenant startup path. Blank/omitted fields
 * are left untouched — the frontend never re-sends a real secret value.
 */
export function updateSettings(partial: Record<string, unknown>): MaskedField[] {
  const known = new Set(FIELDS.map((f) => f.envVar));
  const saved = readSettingsFile();
  let changed = false;
  for (const [key, value] of Object.entries(partial)) {
    if (!known.has(key) || typeof value !== "string" || value.trim() === "") continue;
    saved[key] = value;
    if (!getTenantContext()) process.env[key] = value;
    changed = true;
  }
  if (changed) writeSettingsFile(saved);
  return getMaskedSettings();
}
