import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getEnvValue } from "../server/settings.js";

// Postiz is a unified scheduling/posting API — like zernio.ts, one API key
// stands in for OAuth apps we'd otherwise build per platform, and accounts
// are linked through Postiz's own dashboard (Settings → Developers → Apps),
// not a callback route on this server. Confirmed against docs.postiz.com
// (2026-08): POSTIZ_BASE_URL defaults to Postiz's cloud API but can be
// pointed at a self-hosted instance (`https://{your-domain}/api/public/v1`).
function apiBase(): string {
  return getEnvValue("POSTIZ_BASE_URL")?.replace(/\/$/, "") || "https://api.postiz.com/public/v1";
}

function getApiKey(): string {
  const key = getEnvValue("POSTIZ_API_KEY");
  if (!key) throw new Error("POSTIZ_API_KEY is not set");
  return key;
}

export function isPostizConnected(): boolean {
  return !!getEnvValue("POSTIZ_API_KEY");
}

// Postiz's Authorization header is the raw key/OAuth token, no "Bearer"
// prefix (confirmed against docs.postiz.com/public-api/introduction).
function postizHeaders(extra?: Record<string, string>) {
  return { Authorization: getApiKey(), ...extra };
}

interface PostizIntegration {
  id: string;
  name: string;
  identifier: string; // platform, e.g. "x", "linkedin", "facebook", "instagram"
  profile?: string;
  disabled?: boolean;
}

async function fetchIntegrations(): Promise<PostizIntegration[]> {
  const res = await fetch(`${apiBase()}/integrations`, { headers: postizHeaders() });
  if (!res.ok) throw new Error(`Postiz error listing integrations: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as PostizIntegration[];
  return Array.isArray(json) ? json : [];
}

const listPostizIntegrations = tool(
  "list_postiz_integrations",
  "List the social accounts (channels) connected through Postiz, with their integration ID and platform. Use this first to find the integrationIds create_postiz_post needs — accounts themselves are linked via Postiz's own dashboard, not from here.",
  {},
  async () => {
    try {
      const integrations = await fetchIntegrations();
      if (!integrations.length) {
        return { content: [{ type: "text" as const, text: "No accounts connected in Postiz yet — link some from the Postiz dashboard first." }] };
      }
      const lines = integrations.map(
        (i) => `- ${i.identifier}: ${i.id} (${i.name}${i.profile ? ` @${i.profile}` : ""})${i.disabled ? " [disabled]" : ""}`,
      );
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error listing Postiz integrations: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

// Every uploaded media file (whatever its source) has to be handed to Postiz
// first so a post can reference it by id — there's no way to attach a raw
// external URL directly to a post. Works identically for images and video
// (Postiz has no separate video field/endpoint — confirmed against
// docs.postiz.com, 2026-08: a post's "image" array takes {id, path} items
// for both, and multiple items there is what renders as a carousel).
async function uploadMediaFromUrl(url: string): Promise<string> {
  const res = await fetch(`${apiBase()}/upload-from-url`, {
    method: "POST",
    headers: postizHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Postiz media upload failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Postiz upload-from-url response was missing an id");
  return json.id;
}

interface PostizPostResult {
  postId?: string;
  integration?: string;
}

const createPostizPost = tool(
  "create_postiz_post",
  "Publish (or schedule) a post to one or more connected platforms via Postiz, optionally with media. Irreversible and immediately public once sent — describe the draft (and, if there's media, the URL(s) to review) back to the user and only call this when explicitly told to post (not just draft). Look up integrationIds with list_postiz_integrations first. imageUrls accepts image OR video file URLs — Postiz treats them identically; multiple URLs renders as a carousel. Note: some platforms (Reddit, YouTube, TikTok) and Reel-specific rendering require extra per-platform settings this tool doesn't send — expect those to fail with a validation error from Postiz, or post as a normal item instead of a Reel, rather than silently posting wrong.",
  {
    integrationIds: z.array(z.string()).min(1).describe("Postiz integration IDs to post to, from list_postiz_integrations"),
    content: z.string().describe("Post body text"),
    imageUrls: z
      .array(z.string().url())
      .min(1)
      .optional()
      .describe("Public image or video URL(s) to attach, e.g. from generate_image's preview output. Multiple URLs = carousel."),
    publishAt: z.string().optional().describe("ISO 8601 UTC datetime to schedule for; omit to publish immediately"),
  },
  async ({ integrationIds, content, imageUrls, publishAt }) => {
    try {
      const integrations = await fetchIntegrations();
      const byId = new Map(integrations.map((i) => [i.id, i]));
      const unknown = integrationIds.filter((id) => !byId.has(id));
      if (unknown.length) {
        return {
          content: [{ type: "text" as const, text: `Error: unknown Postiz integration id(s): ${unknown.join(", ")} — check list_postiz_integrations.` }],
          isError: true,
        };
      }

      const mediaIds = imageUrls?.length ? await Promise.all(imageUrls.map((url) => uploadMediaFromUrl(url))) : [];

      const res = await fetch(`${apiBase()}/posts`, {
        method: "POST",
        headers: postizHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: publishAt ? "schedule" : "now",
          date: publishAt ?? new Date().toISOString(),
          shortLink: false,
          tags: [],
          posts: integrationIds.map((id) => ({
            integration: { id },
            value: [{ content, image: mediaIds.map((mediaId) => ({ id: mediaId })) }],
            settings: { __type: byId.get(id)!.identifier },
          })),
        }),
      });
      if (!res.ok) {
        return { content: [{ type: "text" as const, text: `Error posting via Postiz: ${res.status} ${await res.text()}` }], isError: true };
      }
      const results = (await res.json()) as PostizPostResult[];
      if (!Array.isArray(results) || !results.length) {
        return { content: [{ type: "text" as const, text: "Postiz returned no post results — treat this as unconfirmed, don't report it as posted." }], isError: true };
      }
      const platforms = integrationIds.map((id) => byId.get(id)!.identifier).join(", ");
      const ids = results.map((r) => r.postId ?? "unknown").join(", ");
      return {
        content: [
          {
            type: "text" as const,
            text: `${publishAt ? "Scheduled" : "Posted"} via Postiz to ${platforms}${mediaIds.length ? ` with ${mediaIds.length} media item(s)` : ""} (post id(s): ${ids}).`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error posting via Postiz: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

export const POSTIZ_TOOLS = ["mcp__postiz__list_postiz_integrations", "mcp__postiz__create_postiz_post"];

export const postizServer = createSdkMcpServer({
  name: "postiz",
  version: "1.0.0",
  instructions:
    "Tools for posting to connected social platforms via Postiz. Default to describing the draft back to the user before posting; only post directly when explicitly told to.",
  tools: [listPostizIntegrations, createPostizPost],
});
