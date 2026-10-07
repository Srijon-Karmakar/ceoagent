import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { readDoc, writeDoc, docExists, deleteDoc } from "../storage.js";
import { join } from "node:path";
import { getDataDir } from "../paths.js";
import { getEnvValue } from "../server/settings.js";
import { defineTool } from "../providers/toolAdapter.js";
import { resolveVirtualPath } from "../server/files.js";
import { recordSentEmail } from "../sentEmails.js";
import {
  createEmailTemplate,
  listEmailTemplates,
  getEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  renderEmailTemplate,
} from "../emailTemplates.js";

function tokenFile(): string {
  return join(getDataDir(), "gmail-token.json");
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
];

function ensureDir() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getOAuthClient() {
  const clientId = getEnvValue("GOOGLE_CLIENT_ID");
  const clientSecret = getEnvValue("GOOGLE_CLIENT_SECRET");
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${process.env.PORT ?? 3000}/auth/gmail/callback`;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function isGmailConnected(): boolean {
  return docExists(tokenFile());
}

export function disconnectGmail() {
  const file = tokenFile();
  if (docExists(file)) deleteDoc(file);
}

export function getGmailAuthUrl(state?: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function handleGmailCallback(code: string): Promise<void> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  ensureDir();
  writeDoc(tokenFile(), tokens);
}

function getAuthedClient() {
  if (!isGmailConnected()) throw new Error("Gmail is not connected");
  const client = getOAuthClient();
  const file = tokenFile();
  const tokens = readDoc(file)!;
  client.setCredentials(tokens);
  client.on("tokens", (newTokens) => {
    // Persist refreshed access tokens so we don't re-prompt for consent.
    writeDoc(file, { ...tokens, ...newTokens });
  });
  return google.gmail({ version: "v1", auth: client });
}

function decodeBody(payload: unknown): string {
  const p = payload as {
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
  };
  if (p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf-8");
  const textPart = p.parts?.find((part) => part.mimeType === "text/plain");
  if (textPart?.body?.data) return Buffer.from(textPart.body.data, "base64url").toString("utf-8");
  const htmlPart = p.parts?.find((part) => part.mimeType === "text/html");
  if (htmlPart?.body?.data) return Buffer.from(htmlPart.body.data, "base64url").toString("utf-8");
  return "(no readable body)";
}

// isHtml=true sends `body` as raw HTML markup (Content-Type: text/html) —
// for a designed template with images, those images must already be hosted
// at public URLs (<img src="https://...">); Gmail doesn't accept locally
// attached image files as inline content this way.
function buildRawMessage(to: string, subject: string, body: string, isHtml = false): string {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: text/${isHtml ? "html" : "plain"}; charset=utf-8`,
    "",
    body,
  ].join("\n");
  return Buffer.from(message).toString("base64url");
}

export async function sendGmailEmail(to: string, subject: string, body: string, isHtml = false): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const result = await sendGmailEmailRaw(to, subject, body, isHtml);
  recordSentEmail({ channel: "gmail", to, subject, body, isHtml, result });
  return result;
}

async function sendGmailEmailRaw(to: string, subject: string, body: string, isHtml = false): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const gmail = getAuthedClient();
    const raw = buildRawMessage(to, subject, body, isHtml);
    const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return { ok: true, id: sent.data.id ?? "unknown" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const listRecentEmailsDef = defineTool(
  "list_recent_emails",
  "List recent emails in the connected Gmail inbox. Use a Gmail search query to filter (e.g. 'is:unread', 'from:someone@example.com').",
  {
    query: z.string().optional().describe("Gmail search query, e.g. 'is:unread'. Omit for the most recent emails."),
    maxResults: z.number().int().min(1).max(25).default(10),
  },
  async ({ query, maxResults }) => {
    const gmail = getAuthedClient();
    const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
    const messages = list.data.messages ?? [];
    if (!messages.length) {
      return { content: [{ type: "text" as const, text: "No emails found." }] };
    }

    const lines: string[] = [];
    for (const m of messages) {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      });
      const headers = msg.data.payload?.headers ?? [];
      const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
      lines.push(`- [${m.id}] ${get("Date")} | From: ${get("From")} | Subject: ${get("Subject")}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

const readEmailDef = defineTool(
  "read_email",
  "Read the full content of a specific email by its message ID (from list_recent_emails).",
  { messageId: z.string() },
  async ({ messageId }) => {
    const gmail = getAuthedClient();
    const msg = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    const headers = msg.data.payload?.headers ?? [];
    const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
    const body = decodeBody(msg.data.payload);
    return {
      content: [
        {
          type: "text" as const,
          text: `From: ${get("From")}\nTo: ${get("To")}\nSubject: ${get("Subject")}\nDate: ${get("Date")}\n\n${body}`,
        },
      ],
    };
  },
);

const createEmailDraftDef = defineTool(
  "create_email_draft",
  "Create a draft email in Gmail (does NOT send it). Safe, reversible — use this by default when asked to write an email.",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string(),
    body: z.string().describe("Email body — plain text, or full HTML markup if isHtml is true"),
    isHtml: z.boolean().optional().default(false).describe("Set true if body is HTML markup (e.g. a designed template with <img> tags pointing at already-hosted image URLs) rather than plain text"),
  },
  async ({ to, subject, body, isHtml }) => {
    const gmail = getAuthedClient();
    const raw = buildRawMessage(to, subject, body, isHtml);
    const draft = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
    return {
      content: [{ type: "text" as const, text: `Draft created (id: ${draft.data.id}) to ${to}: "${subject}"` }],
    };
  },
);

const sendEmailDef = defineTool(
  "send_email",
  "Send an email immediately via Gmail. Irreversible — only use this when explicitly instructed to send (not just draft) an email.",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string(),
    body: z.string().describe("Email body — plain text, or full HTML markup if isHtml is true"),
    isHtml: z.boolean().optional().default(false).describe("Set true if body is HTML markup (e.g. a designed template with <img> tags pointing at already-hosted image URLs) rather than plain text"),
  },
  async ({ to, subject, body, isHtml }) => {
    const sent = await sendGmailEmail(to, subject, body, isHtml);
    if (!sent.ok) {
      return { content: [{ type: "text" as const, text: `Error sending email: ${sent.error}` }], isError: true };
    }
    return {
      content: [{ type: "text" as const, text: `Email sent (id: ${sent.id}) to ${to}: "${subject}"` }],
    };
  },
);

const createEmailTemplateDef = defineTool(
  "create_email_template",
  "Save a reusable email template (subject + body) for mail-merge style bulk sends. Use {{name}}, {{company}}, or any other {{placeholder}} in the subject/body — send_bulk_email fills these in per recipient. The body can be a full HTML template (set isHtml: true) — e.g. content pasted or attached from a .html template file — as long as any images inside it are <img> tags pointing at already publicly-hosted URLs; this tool cannot host image files itself. Returns the template's id for use with send_bulk_email.",
  {
    name: z.string().describe("Short label for this template, e.g. \"Q3 intro outreach\""),
    subject: z.string().describe("Subject line — may contain {{placeholders}}"),
    body: z.string().describe("Email body — plain text, or full HTML markup if isHtml is true — may contain {{placeholders}}"),
    isHtml: z.boolean().optional().default(false).describe("Set true when body is HTML markup rather than plain text"),
  },
  async ({ name, subject, body, isHtml }) => {
    const template = createEmailTemplate({ name, subject, body, isHtml });
    return {
      content: [{ type: "text" as const, text: `Template saved (id: ${template.id}): "${template.name}"${isHtml ? " [HTML]" : ""}` }],
    };
  },
);

// Reading a long HTML template through the model (attach file -> model sees
// the text -> model retypes it as this tool's `body` argument) is unreliable:
// generation drifts on documents this long, and the model tends to paraphrase
// later sections into plain prose instead of reproducing their markup. This
// tool reads the file's bytes directly off disk instead, so a saved template
// is always byte-identical to the source .html file — never routed through
// the model's own generation.
const importEmailTemplateFromFileDef = defineTool(
  "import_email_template_from_file",
  "Save an HTML email template by reading it verbatim from an uploaded file, instead of retyping its markup into create_email_template. Use this whenever the source is an attached .html file — the attachment note gives you the exact `path` to pass here (e.g. 'workspace/uploads/vendor_email_template.html'). Retyping a long HTML document through create_email_template is unreliable: the model's own generation drifts partway through and later sections silently collapse into plain text even though the send 'succeeds'. This tool copies the file's bytes directly, so the design survives intact. The body may contain {{placeholder}} tokens for send_bulk_email. Returns the template's id.",
  {
    path: z.string().describe("Workspace-relative file path exactly as given in the attachment note, e.g. 'workspace/uploads/vendor_email_template.html'"),
    name: z.string().describe("Short label for this template, e.g. \"Vendor outreach\""),
    subject: z.string().describe("Subject line — may contain {{placeholders}}"),
  },
  async ({ path, name, subject }) => {
    let resolved;
    try {
      resolved = resolveVirtualPath(path);
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: invalid path "${path}": ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
    if (resolved.root.key !== "workspace") {
      return { content: [{ type: "text" as const, text: `Error: path must be under workspace/ (from an attachment note), got "${path}".` }], isError: true };
    }
    let body: string;
    try {
      body = readFileSync(resolved.absPath, "utf-8");
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error reading ${path}: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
    const template = createEmailTemplate({ name, subject, body, isHtml: true });
    return {
      content: [{ type: "text" as const, text: `Template imported verbatim from ${path} (id: ${template.id}): "${template.name}" [HTML, ${body.length} chars]` }],
    };
  },
);

const listEmailTemplatesDef = defineTool(
  "list_email_templates",
  "List saved email templates (id, name, subject, body, and whether each is HTML or plain text).",
  {},
  async () => {
    const templates = listEmailTemplates();
    if (!templates.length) return { content: [{ type: "text" as const, text: "No email templates saved yet." }] };
    const lines = templates.map(
      (t) => `[${t.id}] ${t.name}${t.isHtml ? " [HTML]" : ""}\n  subject: ${t.subject}\n  body: ${t.body}`,
    );
    return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
  },
);

const updateEmailTemplateDef = defineTool(
  "update_email_template",
  "Overwrite a saved email template's subject/body/isHtml in place, keeping its id (so send_bulk_email calls already referencing it automatically pick up the change). create_email_template only stores a one-time copy — if the source content (e.g. a .html file) changes later, the saved template does NOT update itself. Always call this (not create_email_template again) when re-sending a template you've edited, or every future send_bulk_email call will keep using the stale copy.",
  {
    id: z.string().describe("Template id, from list_email_templates"),
    name: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional().describe("Full replacement body — not merged with the old one"),
    isHtml: z.boolean().optional(),
  },
  async ({ id, ...patch }) => {
    const template = updateEmailTemplate(id, patch);
    if (!template) return { content: [{ type: "text" as const, text: `Error: no template with id ${id}` }], isError: true };
    return {
      content: [{ type: "text" as const, text: `Updated template (id: ${template.id}): "${template.name}"${template.isHtml ? " [HTML]" : ""}` }],
    };
  },
);

const deleteEmailTemplateDef = defineTool(
  "delete_email_template",
  "Permanently delete a saved email template by id.",
  { id: z.string().describe("Template id, from list_email_templates") },
  async ({ id }) => {
    const ok = deleteEmailTemplate(id);
    if (!ok) return { content: [{ type: "text" as const, text: `Error: no template with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Deleted template ${id}.` }] };
  },
);

// Hard ceiling on a single bulk send — Gmail's own daily send quota (~500/day
// on a personal account) makes anything near this size unrealistic in one
// call anyway; this just fails fast with a clear reason instead of grinding
// through a huge list at 1 email/second.
const MAX_BULK_RECIPIENTS = 200;

const sendBulkEmailDef = defineTool(
  "send_bulk_email",
  "Send the same email (personalized per recipient) to many addresses via Gmail — e.g. \"email these 50 leads our intro template\". Irreversible and rate-limited by design: sends one at a time with a short delay between each to avoid Gmail flagging the account for spam-like bursts. Provide either templateId (from list_email_templates) or an inline subject+body; both accept {{name}}/{{company}}/etc. placeholders filled in per recipient. Only use when explicitly told to send (not just draft).",
  {
    recipients: z
      .array(
        z.object({
          email: z.string().describe("Recipient email address"),
          name: z.string().optional().describe("Fills {{name}} in the template for this recipient"),
          company: z.string().optional().describe("Fills {{company}} in the template for this recipient"),
          vars: z
            .record(z.string(), z.string())
            .optional()
            .describe("Any other {{placeholder}} -> value pairs specific to this recipient"),
        }),
      )
      .min(1)
      .max(MAX_BULK_RECIPIENTS)
      .describe(`1-${MAX_BULK_RECIPIENTS} recipients`),
    templateId: z.string().optional().describe("Id of a saved template (from list_email_templates) — its isHtml flag is used automatically. Omit if passing subject/body inline."),
    subject: z.string().optional().describe("Inline subject template, used when templateId is omitted"),
    body: z.string().optional().describe("Inline body template, used when templateId is omitted"),
    isHtml: z.boolean().optional().default(false).describe("When passing subject/body inline (no templateId), set true if body is HTML markup rather than plain text"),
    delayMs: z
      .number()
      .int()
      .min(300)
      .max(10000)
      .default(1200)
      .describe("Pause between sends, in milliseconds — keep the default unless told otherwise"),
  },
  async ({ recipients, templateId, subject, body, isHtml, delayMs }) => {
    let subjectSrc = subject;
    let bodySrc = body;
    let sendAsHtml = isHtml;
    if (templateId) {
      const template = getEmailTemplate(templateId);
      if (!template) {
        return { content: [{ type: "text" as const, text: `Error: no template with id ${templateId}` }], isError: true };
      }
      subjectSrc = template.subject;
      bodySrc = template.body;
      sendAsHtml = template.isHtml ?? false;
    }
    if (!subjectSrc || !bodySrc) {
      return {
        content: [{ type: "text" as const, text: "Error: provide either templateId, or both subject and body." }],
        isError: true,
      };
    }

    const results: { email: string; ok: boolean; detail: string }[] = [];
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const vars = { name: r.name ?? "", company: r.company ?? "", email: r.email, ...r.vars };
      const sent = await sendGmailEmail(
        r.email,
        renderEmailTemplate(subjectSrc, vars),
        renderEmailTemplate(bodySrc, vars),
        sendAsHtml,
      );
      results.push(sent.ok ? { email: r.email, ok: true, detail: sent.id } : { email: r.email, ok: false, detail: sent.error });
      if (i < recipients.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    const lines = [`Sent ${succeeded.length}/${results.length}.`];
    if (failed.length) {
      lines.push("Failed:");
      for (const f of failed) lines.push(`  - ${f.email}: ${f.detail}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }], isError: failed.length === results.length };
  },
);

export const GMAIL_TOOLS = [
  "mcp__gmail__list_recent_emails",
  "mcp__gmail__read_email",
  "mcp__gmail__create_email_draft",
  "mcp__gmail__send_email",
  "mcp__gmail__create_email_template",
  "mcp__gmail__import_email_template_from_file",
  "mcp__gmail__list_email_templates",
  "mcp__gmail__update_email_template",
  "mcp__gmail__delete_email_template",
  "mcp__gmail__send_bulk_email",
];

export const GMAIL_TOOL_DEFS = [
  listRecentEmailsDef,
  readEmailDef,
  createEmailDraftDef,
  sendEmailDef,
  createEmailTemplateDef,
  importEmailTemplateFromFileDef,
  listEmailTemplatesDef,
  updateEmailTemplateDef,
  deleteEmailTemplateDef,
  sendBulkEmailDef,
];

export const gmailServer = createSdkMcpServer({
  name: "gmail",
  version: "1.0.0",
  instructions:
    "Tools for reading and drafting/sending email via the connected Gmail account. Default to creating drafts; only send directly when explicitly told to. For \"email this list of people\" requests, save a template with create_email_template (or pass subject/body inline) and use send_bulk_email — never loop send_email yourself, it skips the rate-limiting send_bulk_email applies. If the source is an attached .html template file, use import_email_template_from_file with the path given in the attachment note instead of create_email_template — retyping a long HTML document through create_email_template silently corrupts it (later sections drift into plain prose) whereas import_email_template_from_file copies the file's bytes untouched.",
  tools: GMAIL_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
