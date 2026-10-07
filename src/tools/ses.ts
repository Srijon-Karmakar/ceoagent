import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnvValue } from "../server/settings.js";
import { defineTool } from "../providers/toolAdapter.js";
import { recordSentEmail } from "../sentEmails.js";
import {
  createEmailTemplate,
  listEmailTemplates,
  getEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  renderEmailTemplate,
} from "../emailTemplates.js";

export function isSesConnected(): boolean {
  return Boolean(
    getEnvValue("SES_SMTP_HOST") &&
      getEnvValue("SES_SMTP_USER") &&
      getEnvValue("SES_SMTP_PASS") &&
      getEnvValue("SES_FROM_EMAIL"),
  );
}

let cachedTransporter: Transporter | undefined;
let cachedKey: string | undefined;

function getTransporter(): Transporter {
  const host = getEnvValue("SES_SMTP_HOST");
  const port = Number(getEnvValue("SES_SMTP_PORT") ?? "587");
  const user = getEnvValue("SES_SMTP_USER");
  const pass = getEnvValue("SES_SMTP_PASS");
  if (!host || !user || !pass) {
    throw new Error("SES_SMTP_HOST / SES_SMTP_USER / SES_SMTP_PASS are not set");
  }
  const key = `${host}:${port}:${user}`;
  if (cachedTransporter && cachedKey === key) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  cachedKey = key;
  return cachedTransporter;
}

function getFromAddress(): string {
  const from = getEnvValue("SES_FROM_EMAIL");
  if (!from) throw new Error("SES_FROM_EMAIL is not set");
  return from;
}

export async function sendSesEmail(to: string, subject: string, body: string, isHtml = false): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const result = await sendSesEmailRaw(to, subject, body, isHtml);
  recordSentEmail({ channel: "ses", to, subject, body, isHtml, result });
  return result;
}

async function sendSesEmailRaw(to: string, subject: string, body: string, isHtml = false): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: getFromAddress(),
      to,
      subject,
      ...(isHtml ? { html: body } : { text: body }),
    });
    return { ok: true, id: info.messageId ?? "unknown" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const sendSesEmailDef = defineTool(
  "send_ses_email",
  "Send an email immediately via the connected AWS SES SMTP account (no-reply@yarrowtech.co.in). Irreversible — send-only, no drafts, no inbox reading (SES is not an inbox). Only use when explicitly instructed to send.",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string(),
    body: z.string().describe("Email body — plain text, or full HTML markup if isHtml is true"),
    isHtml: z.boolean().optional().default(false).describe("Set true if body is HTML markup rather than plain text"),
  },
  async ({ to, subject, body, isHtml }) => {
    const sent = await sendSesEmail(to, subject, body, isHtml);
    if (!sent.ok) {
      return { content: [{ type: "text" as const, text: `Error sending email via SES: ${sent.error}` }], isError: true };
    }
    return {
      content: [{ type: "text" as const, text: `Email sent via SES (id: ${sent.id}) to ${to}: "${subject}"` }],
    };
  },
);

const createSesEmailTemplateDef = defineTool(
  "create_ses_email_template",
  "Save a reusable email template (subject + body) for SES mail-merge style bulk sends. Use {{name}}, {{company}}, or any other {{placeholder}} — send_bulk_ses_email fills these in per recipient. Shares the same template store as the Gmail templates tool, so a template created here also shows up via list_email_templates. Returns the template's id for use with send_bulk_ses_email.",
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

const listSesEmailTemplatesDef = defineTool(
  "list_ses_email_templates",
  "List saved email templates (id, name, subject, body, and whether each is HTML or plain text) — the same store used by send_bulk_ses_email and the Gmail template tools.",
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

const updateSesEmailTemplateDef = defineTool(
  "update_ses_email_template",
  "Overwrite a saved email template's subject/body/isHtml in place, keeping its id.",
  {
    id: z.string().describe("Template id, from list_ses_email_templates"),
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

const deleteSesEmailTemplateDef = defineTool(
  "delete_ses_email_template",
  "Permanently delete a saved email template by id.",
  { id: z.string().describe("Template id, from list_ses_email_templates") },
  async ({ id }) => {
    const ok = deleteEmailTemplate(id);
    if (!ok) return { content: [{ type: "text" as const, text: `Error: no template with id ${id}` }], isError: true };
    return { content: [{ type: "text" as const, text: `Deleted template ${id}.` }] };
  },
);

// Mirrors the Gmail bulk-send ceiling — SES has a much higher daily quota,
// but this stays a deliberate hard cap so a single call can't accidentally
// blast an unbounded list; rate-limited by design like the Gmail path.
const MAX_BULK_RECIPIENTS = 200;

const sendBulkSesEmailDef = defineTool(
  "send_bulk_ses_email",
  "Send the same email (personalized per recipient) to many addresses via AWS SES — e.g. \"email these 50 leads our intro template\". Irreversible and rate-limited by design: sends one at a time with a short delay between each. Provide either templateId (from list_ses_email_templates) or an inline subject+body; both accept {{name}}/{{company}}/etc. placeholders filled in per recipient. Only use when explicitly told to send (not just draft).",
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
    templateId: z.string().optional().describe("Id of a saved template (from list_ses_email_templates) — its isHtml flag is used automatically. Omit if passing subject/body inline."),
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
      const sent = await sendSesEmail(
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

export const SES_TOOLS = [
  "mcp__ses__send_ses_email",
  "mcp__ses__create_ses_email_template",
  "mcp__ses__list_ses_email_templates",
  "mcp__ses__update_ses_email_template",
  "mcp__ses__delete_ses_email_template",
  "mcp__ses__send_bulk_ses_email",
];

export const SES_TOOL_DEFS = [
  sendSesEmailDef,
  createSesEmailTemplateDef,
  listSesEmailTemplatesDef,
  updateSesEmailTemplateDef,
  deleteSesEmailTemplateDef,
  sendBulkSesEmailDef,
];

export const sesServer = createSdkMcpServer({
  name: "ses",
  version: "1.0.0",
  instructions:
    "Tools for sending email via the connected AWS SES SMTP account (no-reply@yarrowtech.co.in) — a second, independent email-sending channel alongside Gmail. Send-only: no inbox reading, no drafts (SES has no draft concept). For \"email this list of people\" requests, save a template with create_ses_email_template (or pass subject/body inline) and use send_bulk_ses_email — never loop send_ses_email yourself, it skips the rate-limiting send_bulk_ses_email applies.",
  tools: SES_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
