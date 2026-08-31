import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getEnvValue, updateSettings } from "../server/settings.js";

// Deliberately an allowlist, not "post to whatever subreddit the model
// names" — same reasoning as tools/n8n.ts's workflow allowlist: this tool
// publishes immediately with no human approval step (by product decision),
// so the one guardrail against posting to the wrong place is restricting the
// destination to subreddits the CEO explicitly configured.
function allowedSubreddits(): string[] {
  const raw = getEnvValue("REDDIT_ALLOWED_SUBREDDITS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().replace(/^r\//i, ""))
    .filter(Boolean);
}

// Deliberately doesn't require allowedSubreddits().length > 0 — a fresh
// user with credentials but no pre-approved subreddits yet still needs
// search_subreddits available to build that list via discovery+approval
// (see add_approved_subreddit below). create_reddit_post still validates
// against the live allowlist on every call regardless.
export function isRedditConnected(): boolean {
  return Boolean(
    getEnvValue("REDDIT_CLIENT_ID") &&
      getEnvValue("REDDIT_CLIENT_SECRET") &&
      getEnvValue("REDDIT_USERNAME") &&
      getEnvValue("REDDIT_PASSWORD"),
  );
}

function userAgent(): string {
  const username = getEnvValue("REDDIT_USERNAME") ?? "ceo-agent-os";
  return `ceo-agent-os:v1.0 (by /u/${username})`;
}

// "Script" app password-grant token — no browser OAuth flow, just the app's
// client id/secret plus the posting account's own username/password (Reddit
// Developer Portal → create app → type "script"). Tokens last ~1h; cached
// here so a burst of posts doesn't re-authenticate every time. Accounts with
// 2FA enabled can't use this grant type at all — that's called out in the
// Settings hint in server/index.ts, not re-explained here.
const cachedTokens = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(): Promise<string> {
  const clientId = getEnvValue("REDDIT_CLIENT_ID") ?? "";
  const clientSecret = getEnvValue("REDDIT_CLIENT_SECRET") ?? "";
  const username = getEnvValue("REDDIT_USERNAME") ?? "";
  const password = getEnvValue("REDDIT_PASSWORD") ?? "";
  const cacheKey = `${clientId}:${username}`;
  const cachedToken = cachedTokens.get(cacheKey);
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent(),
    },
    body: new URLSearchParams({ grant_type: "password", username, password }),
  });
  const body: { access_token?: string; expires_in?: number; error?: string } = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Reddit auth failed: ${body.error ?? `HTTP ${res.status}`}`);
  }
  const token = { token: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
  cachedTokens.set(cacheKey, token);
  return token.token;
}

const listRedditSubreddits = tool(
  "list_reddit_subreddits",
  "List the subreddits this agent is allowed to post to. create_reddit_post only accepts a subreddit from this list — never an arbitrary one.",
  {},
  async () => {
    const subs = allowedSubreddits();
    if (!subs.length) {
      return {
        content: [{ type: "text" as const, text: "No subreddits configured — set REDDIT_ALLOWED_SUBREDDITS in Settings." }],
      };
    }
    return { content: [{ type: "text" as const, text: subs.map((s) => `- r/${s}`).join("\n") }] };
  },
);

const createRedditPost = tool(
  "create_reddit_post",
  "Publish a text (self) post to a subreddit — this goes live immediately and publicly, with no confirmation step, so only call it once the post is genuinely finished and ready. Only accepts a subreddit from list_reddit_subreddits.",
  {
    subreddit: z.string().describe("Subreddit name, no r/ prefix — must be from list_reddit_subreddits"),
    title: z.string().describe("Post title"),
    body: z.string().describe("Post body, in Markdown"),
  },
  async ({ subreddit, title, body }) => {
    const allowed = allowedSubreddits();
    const clean = subreddit.replace(/^r\//i, "");
    if (!allowed.includes(clean)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: r/${clean} is not in the allowed list. Allowed: ${allowed.map((s) => `r/${s}`).join(", ") || "(none configured)"}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const token = await getAccessToken();
      const res = await fetch("https://oauth.reddit.com/api/submit", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent(),
        },
        body: new URLSearchParams({ sr: clean, kind: "self", title, text: body, api_type: "json" }),
      });
      const data: { json?: { errors?: unknown[]; data?: { url?: string; id?: string; name?: string } } } = await res.json();
      const errors = data.json?.errors;
      if (!res.ok || (Array.isArray(errors) && errors.length > 0)) {
        const msg = Array.isArray(errors) && errors.length ? errors.map((e) => (Array.isArray(e) ? e.join(" ") : String(e))).join("; ") : `HTTP ${res.status}`;
        return { content: [{ type: "text" as const, text: `Error posting to r/${clean}: ${msg}` }], isError: true };
      }
      const url = data.json?.data?.url;
      const id = data.json?.data?.id ?? data.json?.data?.name;
      if (!url && !id) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Reddit returned no post id/url for r/${clean} — treat this as unconfirmed, don't report it as posted.`,
            },
          ],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: `Posted to r/${clean}: ${url ?? id}` }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error posting to r/${clean}: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

interface RedditSearchHit {
  display_name: string;
  title?: string;
  public_description?: string;
  subscribers?: number;
  over_18?: boolean;
}

const searchSubreddits = tool(
  "search_subreddits",
  "Search Reddit for subreddits matching a topic — for finding a relevant community that isn't already on the allowed list. This only searches, it can't post; a subreddit found here still needs the user's explicit approval (then add_approved_subreddit) before create_reddit_post will accept it.",
  {
    query: z.string().describe("Topic/keywords to search for, e.g. \"indie hacking\" or \"web hosting\""),
    limit: z.number().optional().describe("Max results, defaults to 10"),
  },
  async ({ query, limit }) => {
    try {
      const token = await getAccessToken();
      const res = await fetch(
        `https://oauth.reddit.com/subreddits/search?q=${encodeURIComponent(query)}&limit=${limit ?? 10}`,
        { headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent() } },
      );
      const data: { data?: { children?: { data: RedditSearchHit }[] } } = await res.json();
      if (!res.ok) return { content: [{ type: "text" as const, text: `Error searching subreddits: HTTP ${res.status}` }], isError: true };
      const hits = (data.data?.children ?? []).map((c) => c.data).filter((s) => !s.over_18);
      if (!hits.length) return { content: [{ type: "text" as const, text: `No subreddits found for "${query}".` }] };
      const lines = hits.map(
        (s) =>
          `- r/${s.display_name} (${(s.subscribers ?? 0).toLocaleString()} subscribers)${s.title ? ` — ${s.title}` : ""}${s.public_description ? `\n  ${s.public_description.split("\n")[0]}` : ""}`,
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error searching subreddits: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

const addApprovedSubreddit = tool(
  "add_approved_subreddit",
  "Permanently add a subreddit to the allowed list so create_reddit_post can use it. Only call this after the user has explicitly approved that specific subreddit in their reply to you — never based on your own judgment alone, since this changes what the account is allowed to post to going forward.",
  { subreddit: z.string().describe("Subreddit name, no r/ prefix") },
  async ({ subreddit }) => {
    const clean = subreddit.trim().replace(/^r\//i, "");
    const current = allowedSubreddits();
    if (current.includes(clean)) {
      return { content: [{ type: "text" as const, text: `r/${clean} is already on the allowed list.` }] };
    }
    updateSettings({ REDDIT_ALLOWED_SUBREDDITS: [...current, clean].join(",") });
    return { content: [{ type: "text" as const, text: `Added r/${clean} to the allowed list — create_reddit_post can use it now.` }] };
  },
);

export const REDDIT_TOOLS = [
  "mcp__reddit__list_reddit_subreddits",
  "mcp__reddit__create_reddit_post",
  "mcp__reddit__search_subreddits",
  "mcp__reddit__add_approved_subreddit",
];

export const redditServer = createSdkMcpServer({
  name: "reddit",
  version: "1.0.0",
  instructions:
    "Tools for publishing text posts to pre-approved subreddits. list_reddit_subreddits first — create_reddit_post only accepts a subreddit from that list, and publishes immediately with no confirmation step. If nothing on that list fits, search_subreddits can find candidates, but a new one needs the user's explicit approval (then add_approved_subreddit) before it can be posted to.",
  tools: [listRedditSubreddits, createRedditPost, searchSubreddits, addApprovedSubreddit],
});
