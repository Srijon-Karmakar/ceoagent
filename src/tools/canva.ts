import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, getTenantContext } from "../paths.js";
import { getEnvValue } from "../server/settings.js";
import { defineTool } from "../providers/toolAdapter.js";

function tokenFile(): string {
  return join(getDataDir(), "canva-token.json");
}

// Canva Connect API — OAuth 2.0 + PKCE (mandatory, unlike instagram.ts's/
// linkedin.ts's plain authorization-code flows). Confirmed against
// canva.dev/docs/connect (2026-08). Only the "type_and_asset" design-create
// path is wired here (works on any Canva plan); autofilling a Brand
// Template with data fields is a separate, richer capability that needs
// Canva Business/Enterprise Brand Templates already set up by the user —
// deliberately left out until that's actually needed.
const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const API_BASE = "https://api.canva.com/rest/v1";

interface CanvaConnection {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function ensureDir() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getConfig() {
  const clientId = getEnvValue("CANVA_CLIENT_ID");
  const clientSecret = getEnvValue("CANVA_CLIENT_SECRET");
  const redirectUri =
    process.env.CANVA_REDIRECT_URI ?? `http://127.0.0.1:${process.env.PORT ?? 3000}/auth/canva/callback`;
  if (!clientId || !clientSecret) {
    throw new Error("CANVA_CLIENT_ID / CANVA_CLIENT_SECRET are not set");
  }
  return { clientId, clientSecret, redirectUri };
}

export function isCanvaConnected(): boolean {
  return existsSync(tokenFile());
}

export function disconnectCanva() {
  const file = tokenFile();
  if (existsSync(file)) unlinkSync(file);
}

// The PKCE code_verifier only needs to survive the few seconds between
// redirecting to Canva and it calling back — a module-level variable is
// enough for this single-user desktop app (no multi-session server to
// worry about), same reasoning as reddit.ts's cachedToken.
const pendingCodeVerifiers = new Map<string, string>();

const SCOPES = ["design:content:write", "design:meta:read", "asset:write"].join(" ");

export function getCanvaAuthUrl(state?: string): string {
  const { clientId, redirectUri } = getConfig();
  const tenantKey = getTenantContext()?.organizationId ?? "global";
  const codeVerifier = randomBytes(96).toString("base64url");
  pendingCodeVerifiers.set(tenantKey, codeVerifier);
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (state) params.set("state", state);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function basicAuthHeader(clientId: string, clientSecret: string) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function exchangeToken(body: URLSearchParams): Promise<CanvaConnection> {
  const { clientId, clientSecret } = getConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(json.error_description ?? `Canva token request failed (${res.status})`);
  }
  const connection: CanvaConnection = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 14400) * 1000,
  };
  ensureDir();
  writeFileSync(tokenFile(), JSON.stringify(connection, null, 2));
  return connection;
}

export async function handleCanvaCallback(code: string): Promise<void> {
  const { redirectUri } = getConfig();
  const tenantKey = getTenantContext()?.organizationId ?? "global";
  const codeVerifier = pendingCodeVerifiers.get(tenantKey);
  if (!codeVerifier) {
    throw new Error("No pending Canva authorization — start from the Accounts page, not a stale/reused link.");
  }
  pendingCodeVerifiers.delete(tenantKey);
  await exchangeToken(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
  );
}

// Canva access tokens are short-lived (~4h) but refresh tokens work and
// rotate on each use — unlike instagram.ts's/linkedin.ts's "throw and tell
// the user to reconnect" approach, refreshing transparently here matters:
// at a 4h TTL, a scheduled/background agent run would otherwise fail
// constantly on a stale token.
async function getAccessToken(): Promise<string> {
  if (!isCanvaConnected()) throw new Error("Canva is not connected");
  const connection: CanvaConnection = JSON.parse(readFileSync(tokenFile(), "utf-8"));
  if (Date.now() < connection.expiresAt - 30_000) return connection.accessToken;
  try {
    const refreshed = await exchangeToken(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.refreshToken }),
    );
    return refreshed.accessToken;
  } catch (err) {
    throw new Error(
      `Canva token refresh failed — reconnect from the Accounts page. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function canvaHeaders(accessToken: string, extra?: Record<string, string>) {
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

interface CanvaJob {
  id: string;
  status: "in_progress" | "success" | "failed";
  urls?: string[];
  asset?: { id: string };
  error?: { message?: string };
}

async function pollCanvaJob(url: string, accessToken: string, timeoutMs = 60_000): Promise<CanvaJob> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(url, { headers: canvaHeaders(accessToken) });
    const body = (await res.json()) as { job?: CanvaJob; error?: { message?: string } };
    if (!res.ok || !body.job) throw new Error(body.error?.message ?? `Canva job poll failed (${res.status})`);
    if (body.job.status === "success") return body.job;
    if (body.job.status === "failed") throw new Error(body.job.error?.message ?? "Canva job failed");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for Canva job to complete");
}

// Canva's upload endpoint takes raw bytes, not a source URL (unlike
// postiz.ts's upload-from-url) — so we fetch the image ourselves first.
async function uploadAssetFromUrl(imageUrl: string, accessToken: string): Promise<string> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch imageUrl (${imgRes.status})`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const name = imageUrl.split("/").pop()?.split("?")[0] || `image-${Date.now()}.png`;

  const res = await fetch(`${API_BASE}/asset-uploads`, {
    method: "POST",
    headers: canvaHeaders(accessToken, {
      "Content-Type": "application/octet-stream",
      "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(name).toString("base64") }),
    }),
    body: new Uint8Array(buffer),
  });
  const body = (await res.json()) as { job?: CanvaJob; error?: { message?: string } };
  if (!res.ok || !body.job) throw new Error(body.error?.message ?? `Canva asset upload failed (${res.status})`);

  const job = await pollCanvaJob(`${API_BASE}/asset-uploads/${body.job.id}`, accessToken);
  if (!job.asset?.id) throw new Error("Canva asset upload succeeded but returned no asset id");
  return job.asset.id;
}

const createDesignDef = defineTool(
  "create_canva_design",
  "Create a new Canva design, optionally starting from an image (e.g. generate_image's output, or any public image URL). Returns an edit link for a human to open and finish the design in Canva, plus a design id for export_canva_design — this does not publish or post anything by itself.",
  {
    designType: z
      .string()
      .default("presentation")
      .describe('Canva preset design type — e.g. "presentation", "doc", "whiteboard". Check Canva\'s docs for the full list if unsure.'),
    title: z.string().describe("Design title, shown in the user's Canva account"),
    imageUrl: z.string().url().optional().describe("Public image URL to insert into the new design"),
  },
  async ({ designType, title, imageUrl }) => {
    try {
      const accessToken = await getAccessToken();
      const assetId = imageUrl ? await uploadAssetFromUrl(imageUrl, accessToken) : undefined;

      const res = await fetch(`${API_BASE}/designs`, {
        method: "POST",
        headers: canvaHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          design_type: { type: "preset", name: designType },
          title,
          ...(assetId ? { asset_id: assetId } : {}),
        }),
      });
      const body = (await res.json()) as {
        design?: { id: string; urls?: { edit_url?: string; view_url?: string } };
        error?: { message?: string };
      };
      if (!res.ok || !body.design) {
        return { content: [{ type: "text" as const, text: `Error creating Canva design: ${body.error?.message ?? res.status}` }], isError: true };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Created "${title}" (id: ${body.design.id}).\nEdit: ${body.design.urls?.edit_url ?? "(no edit url returned)"}\nView: ${body.design.urls?.view_url ?? "(no view url returned)"}`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error creating Canva design: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

const exportDesignDef = defineTool(
  "export_canva_design",
  "Export a Canva design (by id, from create_canva_design) to a downloadable file and wait for it to finish. The returned URL expires after 24 hours — download or repost it promptly if it needs to go further (e.g. as another tool's imageUrl).",
  {
    designId: z.string().describe("Design id from create_canva_design"),
    format: z.enum(["png", "jpg", "pdf"]).default("png"),
  },
  async ({ designId, format }) => {
    try {
      const accessToken = await getAccessToken();
      const res = await fetch(`${API_BASE}/exports`, {
        method: "POST",
        headers: canvaHeaders(accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ design_id: designId, format: { type: format } }),
      });
      const body = (await res.json()) as { job?: CanvaJob; error?: { message?: string } };
      if (!res.ok || !body.job) {
        return { content: [{ type: "text" as const, text: `Error starting Canva export: ${body.error?.message ?? res.status}` }], isError: true };
      }
      const job = await pollCanvaJob(`${API_BASE}/exports/${body.job.id}`, accessToken);
      if (!job.urls?.length) {
        return { content: [{ type: "text" as const, text: "Canva export finished with no file URL — treat as unconfirmed." }], isError: true };
      }
      return { content: [{ type: "text" as const, text: `Exported: ${job.urls.join(", ")} (link expires in 24h)` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error exporting Canva design: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

export const CANVA_TOOLS = ["mcp__canva__create_canva_design", "mcp__canva__export_canva_design"];

export const CANVA_TOOL_DEFS = [createDesignDef, exportDesignDef];

export const canvaServer = createSdkMcpServer({
  name: "canva",
  version: "1.0.0",
  instructions:
    "Tools for creating and exporting Canva designs. create_canva_design just creates a draft (with an edit link for a human to finish it) — it never publishes anything. Describe the design back to the user before calling export_canva_design.",
  tools: CANVA_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
