import { stat, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { PDFParse } from "pdf-parse";
import {
  addLeadActivity,
  createLead,
  listLeads,
  updateLead,
  type LeadRecord,
} from "../crm.js";
import { getDataDir } from "../paths.js";
import { getEnvValue } from "../server/settings.js";
import { sendGmailEmail } from "./gmail.js";
import { sendWhatsappText } from "./whatsapp.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_CLAUDE_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_HANDOFF_EMAIL = "career@yarrowtech.co.in";
const DEFAULT_HANDOFF_PHONE = "916293764220";
const CUSTOM_QUOTE_FALLBACK = "This needs a custom quote. Please share your exact requirement.";

function defaultKnowledgeFiles(): string[] {
  return [
    join(getDataDir(), "Projects", "yarrowtech", "Agent_response_details", "Agent_response_details.pdf"),
    join(getDataDir(), "Projects", "yarrowtech", "pricing", "service_pricing.pdf"),
  ];
}

const WEBHOOK_VERIFY_MSG =
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set - inbound webhook is disabled until configured.";

interface WhatsappReply {
  reply: string;
  needsHumanHandoff: boolean;
  handoffReason: string;
}

interface IncomingWhatsappOptions {
  profileName?: string;
  messageId?: string;
}

interface KnowledgeCache {
  signature: string;
  text: string;
}

let knowledgeCache: KnowledgeCache | undefined;

export function isWhatsappWebhookConfigured(): boolean {
  return !!getEnvValue("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
}

export function whatsappWebhookVerifyMissingMessage(): string {
  return WEBHOOK_VERIFY_MSG;
}

function getOpenAiApiKey(): string | undefined {
  return getEnvValue("OPENAI_API_KEY")?.trim() || undefined;
}

function getOpenAiModel(): string {
  return getEnvValue("WHATSAPP_AGENT_OPENAI_MODEL")?.trim() || DEFAULT_OPENAI_MODEL;
}

function getDeepseekApiKey(): string | undefined {
  return getEnvValue("DEEPSEEK_API_KEY")?.trim() || undefined;
}

function getDeepseekModel(): string {
  return getEnvValue("DEEPSEEK_CEO_MODEL")?.trim() || DEFAULT_DEEPSEEK_MODEL;
}

function getClaudeApiKey(): string | undefined {
  return getEnvValue("ANTHROPIC_API_KEY")?.trim() || undefined;
}

function getHandoffEmail(): string {
  return getEnvValue("WHATSAPP_HANDOFF_EMAIL")?.trim() || DEFAULT_HANDOFF_EMAIL;
}

function getHandoffPhone(): string {
  return (getEnvValue("WHATSAPP_HANDOFF_PHONE")?.trim() || DEFAULT_HANDOFF_PHONE).replace(/[^\d]/g, "");
}

function getKnowledgeFilePaths(): string[] {
  const configured = getEnvValue("WHATSAPP_AGENT_KNOWLEDGE_FILES");
  if (!configured) return defaultKnowledgeFiles();
  const paths = configured
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  return paths.length ? paths : defaultKnowledgeFiles();
}

async function readPdfText(path: string): Promise<string> {
  const data = await readFile(path);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

async function readKnowledgeFile(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === ".pdf") return readPdfText(path);
  return (await readFile(path, "utf-8")).trim();
}

async function loadKnowledge(): Promise<string> {
  const paths = getKnowledgeFilePaths();
  const existing: Array<{ path: string; signaturePart: string }> = [];

  for (const path of paths) {
    try {
      const s = await stat(path);
      existing.push({ path, signaturePart: `${path}:${s.mtimeMs}:${s.size}` });
    } catch {
      console.warn(`[whatsapp-autoreply] knowledge file not found: ${path}`);
    }
  }

  if (!existing.length) {
    throw new Error("No WhatsApp agent knowledge files were found.");
  }

  const signature = existing.map((f) => f.signaturePart).join("|");
  if (knowledgeCache?.signature === signature) return knowledgeCache.text;

  const chunks: string[] = [];
  for (const file of existing) {
    const text = await readKnowledgeFile(file.path);
    if (text) chunks.push(`Source: ${file.path}\n${text}`);
  }

  const combined = chunks.join("\n\n---\n\n").trim();
  knowledgeCache = { signature, text: combined };
  return combined;
}

function normalizePhone(phone: string | undefined): string {
  return (phone ?? "").replace(/[^\d]/g, "");
}

function findLeadByPhone(phone: string): LeadRecord | undefined {
  const normalized = normalizePhone(phone);
  return listLeads().find((lead) => normalizePhone(lead.phone) === normalized);
}

function upsertWhatsappLead(from: string, profileName: string | undefined): LeadRecord {
  const cleanName = profileName?.trim();
  const existing = findLeadByPhone(from);
  if (existing) {
    if (cleanName && (!existing.name || normalizePhone(existing.name) === normalizePhone(existing.phone))) {
      return updateLead(existing.id, { name: cleanName }) ?? existing;
    }
    return existing;
  }

  return createLead({
    name: cleanName || from,
    phone: from,
    source: "whatsapp",
    stage: "new",
    notes: "Created automatically from an inbound WhatsApp message.",
  });
}

function addActivity(lead: LeadRecord, note: string) {
  const updated = addLeadActivity(lead.id, note);
  if (!updated) console.error(`[whatsapp-autoreply] failed to add CRM activity for lead ${lead.id}`);
}

function buildSystemPrompt(knowledge: string): string {
  return [
    "You are Yarrowtech's WhatsApp sales assistant.",
    "Reply in English only, even if the lead writes in another language.",
    "Answer only what the lead asked. Keep the reply short, direct, and suitable for WhatsApp.",
    "Do not send generic waiting, acknowledgement, or template messages.",
    "Do not ask the lead to visit the website unless they specifically ask for the website.",
    "Use only the business knowledge below for factual answers. Never invent prices, addresses, inclusions, timelines, policies, links, or contact details.",
    `If the lead asks for an exact price that is not available in the knowledge, reply exactly: "${CUSTOM_QUOTE_FALLBACK}"`,
    "If the answer is not supported by the knowledge, mark needsHumanHandoff true and give the closest honest short reply.",
    "Mark needsHumanHandoff true for custom quote requests, unknown facts, negotiation, complaints, legal/payment exceptions, or anything that needs a team decision.",
    "Return only the requested JSON shape.",
    "",
    "Business knowledge:",
    knowledge,
  ].join("\n");
}

function responseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reply", "needsHumanHandoff", "handoffReason"],
    properties: {
      reply: {
        type: "string",
        description: "The exact WhatsApp reply to send to the lead.",
      },
      needsHumanHandoff: {
        type: "boolean",
        description: "True when a human should review or follow up.",
      },
      handoffReason: {
        type: "string",
        description: "Short internal reason. Empty string when no handoff is needed.",
      },
    },
  };
}

function extractOpenAiText(json: unknown): string | undefined {
  const data = json as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof data.output_text === "string") return data.output_text;
  for (const output of data.output ?? []) {
    for (const content of output.content ?? []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) {
        return content.text;
      }
    }
  }
  return undefined;
}

function parseAgentReply(text: string): WhatsappReply {
  // DeepSeek/Claude aren't given OpenAI's strict-schema guarantee, so they
  // occasionally wrap the JSON in a ```json ... ``` fence despite the
  // "return only the requested JSON shape" instruction — strip it first.
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(unfenced) as Partial<WhatsappReply>;
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const handoffReason = typeof parsed.handoffReason === "string" ? parsed.handoffReason.trim() : "";
  return {
    reply: reply || CUSTOM_QUOTE_FALLBACK,
    needsHumanHandoff: parsed.needsHumanHandoff === true,
    handoffReason,
  };
}

async function generateReplyViaOpenAi(text: string, knowledge: string): Promise<WhatsappReply> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAiModel(),
      store: false,
      max_output_tokens: 350,
      instructions: buildSystemPrompt(knowledge),
      input: text,
      text: {
        format: {
          type: "json_schema",
          name: "whatsapp_agent_reply",
          strict: true,
          schema: responseSchema(),
        },
      },
    }),
  });

  const raw = await res.text();
  const json = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    const error = (json as { error?: { message?: string } }).error?.message ?? `${res.status} ${raw}`;
    throw new Error(`OpenAI response failed: ${error}`);
  }

  const output = extractOpenAiText(json);
  if (!output) throw new Error("OpenAI response had no output text.");
  return parseAgentReply(output);
}

/**
 * DeepSeek's chat-completions endpoint is OpenAI-compatible but only
 * supports a loose `json_object` response format (no strict schema
 * enforcement like OpenAI's Responses API above), so the exact shape is
 * spelled out in the prompt text and parseAgentReply() does the validation.
 */
async function generateReplyViaDeepseek(text: string, knowledge: string): Promise<WhatsappReply> {
  const apiKey = getDeepseekApiKey();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");

  const systemPrompt = `${buildSystemPrompt(knowledge)}\n\nRespond with ONLY a JSON object matching this shape, no markdown fences: {"reply": string, "needsHumanHandoff": boolean, "handoffReason": string}`;

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getDeepseekModel(),
      max_tokens: 350,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    }),
  });

  const raw = await res.text();
  const json = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    const error = (json as { error?: { message?: string } }).error?.message ?? `${res.status} ${raw}`;
    throw new Error(`DeepSeek response failed: ${error}`);
  }

  const output = (json as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  if (!output) throw new Error("DeepSeek response had no output text.");
  return parseAgentReply(output);
}

/**
 * Last link in the chain — plain Anthropic Messages API call (not the
 * Claude Agent SDK, which is a full tool-calling engine unsuited to a
 * single-shot text reply). No strict-schema support either; same
 * prompt-spelled-out-shape approach as DeepSeek above.
 */
async function generateReplyViaClaude(text: string, knowledge: string): Promise<WhatsappReply> {
  const apiKey = getClaudeApiKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const systemPrompt = `${buildSystemPrompt(knowledge)}\n\nRespond with ONLY a JSON object matching this shape, no markdown fences: {"reply": string, "needsHumanHandoff": boolean, "handoffReason": string}`;

  const res = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_CLAUDE_MODEL,
      max_tokens: 350,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    }),
  });

  const raw = await res.text();
  const json = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    const error = (json as { error?: { message?: string } }).error?.message ?? `${res.status} ${raw}`;
    throw new Error(`Claude response failed: ${error}`);
  }

  const output = (json as { content?: Array<{ type?: string; text?: string }> }).content?.find(
    (block) => block.type === "text",
  )?.text;
  if (!output) throw new Error("Claude response had no output text.");
  return parseAgentReply(output);
}

const REPLY_PROVIDERS: { name: string; configured: () => boolean; generate: (text: string, knowledge: string) => Promise<WhatsappReply> }[] = [
  { name: "OpenAI", configured: () => !!getOpenAiApiKey(), generate: generateReplyViaOpenAi },
  { name: "DeepSeek", configured: () => !!getDeepseekApiKey(), generate: generateReplyViaDeepseek },
  { name: "Claude", configured: () => !!getClaudeApiKey(), generate: generateReplyViaClaude },
];

/**
 * Tries each configured provider in order — OpenAI, then DeepSeek, then
 * Claude — falling through on ANY failure from one to the next (no key set,
 * out of credit, rate-limited, whatever), same pattern as the
 * image-generation fallback chain in image-gen.ts.
 */
async function generateAgentReply(text: string, knowledge: string): Promise<WhatsappReply> {
  const errors: string[] = [];
  for (const provider of REPLY_PROVIDERS) {
    if (!provider.configured()) continue;
    try {
      return await provider.generate(text, knowledge);
    } catch (err) {
      errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`All WhatsApp reply providers failed:\n${errors.join("\n")}`);
}

function buildHandoffNotification(input: {
  lead: LeadRecord;
  from: string;
  profileName?: string;
  message: string;
  reply: string;
  reason: string;
}): string {
  return [
    "WhatsApp handoff needed",
    `Lead: ${input.profileName || input.lead.name}`,
    `Phone: ${input.from}`,
    `Lead ID: ${input.lead.id}`,
    `Reason: ${input.reason || "Human review requested"}`,
    "",
    `Message: ${input.message}`,
    `AI reply: ${input.reply}`,
  ].join("\n");
}

async function notifyHuman(input: {
  lead: LeadRecord;
  from: string;
  profileName?: string;
  message: string;
  reply: string;
  reason: string;
}) {
  const note = buildHandoffNotification(input);
  addActivity(input.lead, `CRM notification: ${note}`);

  const email = getHandoffEmail();
  if (email) {
    const result = await sendGmailEmail(email, `WhatsApp handoff: ${input.from}`, note);
    if (!result.ok) {
      console.error(`[whatsapp-autoreply] email handoff failed: ${result.error}`);
      addActivity(input.lead, `Email handoff failed: ${result.error}`);
    }
  }

  const handoffPhone = getHandoffPhone();
  if (handoffPhone && normalizePhone(handoffPhone) !== normalizePhone(input.from)) {
    const result = await sendWhatsappText(handoffPhone, note.slice(0, 3900));
    if (!result.ok) {
      console.error(`[whatsapp-autoreply] WhatsApp handoff failed: ${result.error}`);
      addActivity(input.lead, `WhatsApp handoff failed: ${result.error}`);
    }
  }
}

/** Simple in-memory dedup so a Meta webhook retry never sends a reply twice. */
const seenMessageIds = new Set<string>();
const MAX_SEEN = 1000;

export function markMessageSeen(id: string): boolean {
  if (seenMessageIds.has(id)) return false;
  seenMessageIds.add(id);
  if (seenMessageIds.size > MAX_SEEN) {
    const oldest = seenMessageIds.values().next().value;
    if (oldest !== undefined) seenMessageIds.delete(oldest);
  }
  return true;
}

/**
 * Handles one inbound WhatsApp text message. It records the lead first, asks
 * the reply-provider chain (OpenAI -> DeepSeek -> Claude) for an answer
 * grounded in the Yarrowtech knowledge files, then alerts a human when the
 * model marks the reply as needing review.
 */
export async function handleIncomingWhatsappMessage(
  from: string,
  text: string,
  options: IncomingWhatsappOptions = {},
): Promise<void> {
  const lead = upsertWhatsappLead(from, options.profileName);
  const prefix = options.messageId ? `Inbound WhatsApp (${options.messageId})` : "Inbound WhatsApp";
  addActivity(lead, `${prefix}: ${text}`);

  try {
    const knowledge = await loadKnowledge();
    const agentReply = await generateAgentReply(text, knowledge);
    const result = await sendWhatsappText(from, agentReply.reply);
    if (!result.ok) {
      console.error(`[whatsapp-autoreply] failed to reply to ${from}: ${result.error}`);
      addActivity(lead, `WhatsApp reply failed: ${result.error}`);
      await notifyHuman({
        lead,
        from,
        profileName: options.profileName,
        message: text,
        reply: agentReply.reply,
        reason: `AI reply could not be sent: ${result.error}`,
      });
      return;
    }

    addActivity(lead, `AI WhatsApp reply: ${agentReply.reply}`);
    if (agentReply.needsHumanHandoff) {
      await notifyHuman({
        lead,
        from,
        profileName: options.profileName,
        message: text,
        reply: agentReply.reply,
        reason: agentReply.handoffReason,
      });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp-autoreply] failed to handle ${from}: ${reason}`);
    addActivity(lead, `WhatsApp AI handling failed: ${reason}`);
    await notifyHuman({
      lead,
      from,
      profileName: options.profileName,
      message: text,
      reply: "",
      reason,
    });
  }
}
