import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { readDoc, writeDoc, docExists, deleteDoc } from "../storage.js";
import { join } from "node:path";
import { getDataDir } from "../paths.js";
import { getEnvValue } from "../server/settings.js";
import { defineTool } from "../providers/toolAdapter.js";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function tokenFile(): string {
  return join(getDataDir(), "facebook-token.json");
}

interface FacebookConnection {
  accessToken: string;
  expiresAt: number;
}

function ensureDir() {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function getConfig() {
  const clientId = getEnvValue("FACEBOOK_CLIENT_ID");
  const clientSecret = getEnvValue("FACEBOOK_CLIENT_SECRET");
  const redirectUri =
    process.env.FACEBOOK_REDIRECT_URI ?? `http://localhost:${process.env.PORT ?? 3000}/auth/facebook/callback`;
  if (!clientId || !clientSecret) {
    throw new Error("FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET are not set");
  }
  return { clientId, clientSecret, redirectUri };
}

// Group IDs are manually registered, not discovered — Meta's API only
// returns groups where the app is installed/approved, and posting itself
// only works for groups the user administers *and* that Meta has granted
// this app the publish_to_groups permission for (App Review, done outside
// this app). Same allowlist pattern as tools/reddit.ts's
// REDDIT_ALLOWED_SUBREDDITS.
function allowedGroupIds(): string[] {
  const raw = getEnvValue("FACEBOOK_GROUP_IDS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isFacebookConnected(): boolean {
  return docExists(tokenFile());
}

export function disconnectFacebook() {
  const file = tokenFile();
  if (docExists(file)) deleteDoc(file);
}

export function getFacebookAuthUrl(state?: string): string {
  const { clientId, redirectUri } = getConfig();
  // publish_to_groups + groups_access_member_info are both "Advanced Access"
  // permissions Meta must approve via App Review before they work for any
  // user other than the app's own registered testers/admins — see the
  // FACEBOOK_GROUP_IDS setting hint in server/index.ts, not re-explained here.
  const scope = ["publish_to_groups", "groups_access_member_info"].join(",");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
  });
  if (state) params.set("state", state);
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

/**
 * Exchanges the auth code for a short-lived token, then immediately
 * exchanges that for a long-lived one (~60 days) — Facebook's default
 * token from the code exchange is only good for a couple hours, which
 * would make this connection impractically short-lived otherwise. No
 * refresh-token flow beyond that: once it expires, reconnect from the
 * Accounts page, same as the LinkedIn connection.
 */
export async function handleFacebookCallback(code: string): Promise<void> {
  const { clientId, clientSecret, redirectUri } = getConfig();

  const shortRes = await fetch(
    `${GRAPH_BASE}/oauth/access_token?${new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }).toString()}`,
  );
  const shortJson = (await shortRes.json()) as {
    access_token?: string;
    error?: { message?: string };
  };
  if (!shortJson.access_token) {
    throw new Error(shortJson.error?.message ?? "Failed to exchange code for token");
  }

  const longRes = await fetch(
    `${GRAPH_BASE}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortJson.access_token,
    }).toString()}`,
  );
  const longJson = (await longRes.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!longJson.access_token) {
    throw new Error(longJson.error?.message ?? "Failed to exchange for a long-lived token");
  }

  const connection: FacebookConnection = {
    accessToken: longJson.access_token,
    expiresAt: Date.now() + (longJson.expires_in ?? 60 * 24 * 3600) * 1000,
  };
  ensureDir();
  writeDoc(tokenFile(), connection);
}

function getConnection(): FacebookConnection {
  if (!isFacebookConnected()) throw new Error("Facebook is not connected");
  const connection: FacebookConnection = readDoc(tokenFile())!;
  if (Date.now() > connection.expiresAt) {
    throw new Error("Facebook connection expired — reconnect it from the Accounts page.");
  }
  return connection;
}

const listFacebookGroupsDef = defineTool(
  "list_facebook_groups",
  "List the Facebook Groups this agent is allowed to post to. create_facebook_group_post only accepts a group id from this list — never an arbitrary one.",
  {},
  async () => {
    const ids = allowedGroupIds();
    if (!ids.length) {
      return {
        content: [{ type: "text" as const, text: "No Facebook Groups configured — set FACEBOOK_GROUP_IDS in Settings." }],
      };
    }
    return { content: [{ type: "text" as const, text: ids.map((id) => `- ${id}`).join("\n") }] };
  },
);

const createFacebookGroupPostDef = defineTool(
  "create_facebook_group_post",
  "Publish a text post to a Facebook Group's feed — this goes live immediately with no confirmation step, so only call it once the post is genuinely finished and the user has been told what it says. Only accepts a group id from list_facebook_groups. Requires the group to have granted this app the publish_to_groups permission (Meta App Review) — if that hasn't happened, this will fail with a permissions error.",
  {
    groupId: z.string().describe("Facebook Group id — must be from list_facebook_groups"),
    message: z.string().describe("Post text"),
    link: z.string().optional().describe("URL to attach, if any"),
  },
  async ({ groupId, message, link }) => {
    const allowed = allowedGroupIds();
    if (!allowed.includes(groupId)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: group ${groupId} is not in the allowed list. Allowed: ${allowed.join(", ") || "(none configured)"}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const { accessToken } = getConnection();
      const body = new URLSearchParams({ message, access_token: accessToken });
      if (link) body.set("link", link);
      const res = await fetch(`${GRAPH_BASE}/${groupId}/feed`, { method: "POST", body });
      const data: { id?: string; error?: { message?: string } } = await res.json();
      if (!res.ok || data.error) {
        return {
          content: [{ type: "text" as const, text: `Error posting to group ${groupId}: ${data.error?.message ?? `HTTP ${res.status}`}` }],
          isError: true,
        };
      }
      if (!data.id) {
        return {
          content: [{ type: "text" as const, text: `Facebook returned no post id for group ${groupId} — treat this as unconfirmed, don't report it as posted.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: `Posted to Facebook group ${groupId}: ${data.id}` }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error posting to group ${groupId}: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

export const FACEBOOK_TOOLS = ["mcp__facebook__list_facebook_groups", "mcp__facebook__create_facebook_group_post"];

export const FACEBOOK_TOOL_DEFS = [listFacebookGroupsDef, createFacebookGroupPostDef];

export const facebookServer = createSdkMcpServer({
  name: "facebook",
  version: "1.0.0",
  instructions:
    "Tools for publishing text posts to pre-approved Facebook Groups. list_facebook_groups first — create_facebook_group_post only accepts a group id from that list, and publishes immediately with no confirmation step. Requires Meta App Review approval for publish_to_groups to actually succeed.",
  tools: FACEBOOK_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
