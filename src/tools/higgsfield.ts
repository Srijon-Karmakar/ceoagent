import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { getCredentialSet, getEnvValue } from "../server/settings.js";
import { getDataDir, getTenantContext } from "../paths.js";
import { readDoc, writeDoc } from "../storage.js";
import { defineTool } from "../providers/toolAdapter.js";

// Higgsfield (https://docs.higgsfield.ai) — image and video generation.
// Every model works the same way: POST a JSON body to the model's path,
// get back a request_id + status_url, poll until a terminal status, then
// read the output URL (`images[].url` for images, `video.url` for video).
// Output URLs are kept by Higgsfield for at least 7 days.
//
// Credentials are a key ID + secret pair. An org can enter its own in
// Settings; otherwise the operator's server-wide key is used, capped per org
// per day (HIGGSFIELD_SHARED_DAILY_*_LIMIT) since that spends the
// operator's prepaid Higgsfield balance.

const API_BASE = "https://api.higgsfield.ai";
const KEY_VARS = ["HIGGSFIELD_API_KEY_ID", "HIGGSFIELD_API_KEY_SECRET"];

const DEFAULT_IMAGE_MODEL = "higgsfield-ai/soul/standard";
const DEFAULT_VIDEO_MODEL = "kling-video/v2.5-turbo/pro/text-to-video";
const DEFAULT_IMAGE_TO_VIDEO_MODEL = "kling-video/v2.5-turbo/pro/image-to-video";

const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

type Kind = "image" | "video";

interface Credentials {
  header: string;
  source: "org" | "server";
}

function credentials(): Credentials | undefined {
  const set = getCredentialSet(KEY_VARS);
  if (!set) return undefined;
  return {
    header: `Key ${set.values.HIGGSFIELD_API_KEY_ID}:${set.values.HIGGSFIELD_API_KEY_SECRET}`,
    source: set.source,
  };
}

export function isHiggsfieldConfigured(): boolean {
  return credentials() !== undefined;
}

function modelPath(envVar: string, fallback: string): string {
  return (getEnvValue(envVar)?.trim() || fallback).replace(/^\/+|\/+$/g, "");
}

// ---------- shared-key daily cap ----------

function sharedLimit(kind: Kind): number {
  const raw = process.env[kind === "image" ? "HIGGSFIELD_SHARED_DAILY_IMAGE_LIMIT" : "HIGGSFIELD_SHARED_DAILY_VIDEO_LIMIT"];
  const n = raw === undefined || raw.trim() === "" ? (kind === "image" ? 20 : 5) : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function usageFile(): string {
  return join(getDataDir(), "usage", `higgsfield-${new Date().toISOString().slice(0, 10)}.json`);
}

/**
 * Reserves one generation against the org's daily allowance on the shared
 * key; returns a function that gives the slot back (call it if the job was
 * never accepted). Orgs using their own key, and single-tenant installs,
 * aren't capped.
 */
function reserveSharedQuota(creds: Credentials, kind: Kind): () => void {
  const noop = () => {};
  if (creds.source !== "server" || !getTenantContext()) return noop;
  const limit = sharedLimit(kind);
  if (limit === 0) return noop;
  const file = usageFile();
  const usage = readDoc<Record<Kind, number>>(file) ?? { image: 0, video: 0 };
  if ((usage[kind] ?? 0) >= limit) {
    throw new Error(
      `Daily limit for ${kind}s on the shared Higgsfield key reached (${limit}). It resets at 00:00 UTC — or add your own Higgsfield key in Settings for unlimited use.`,
    );
  }
  usage[kind] = (usage[kind] ?? 0) + 1;
  writeDoc(file, usage);
  return () => {
    const current = readDoc<Record<Kind, number>>(file) ?? { image: 0, video: 0 };
    current[kind] = Math.max(0, (current[kind] ?? 0) - 1);
    writeDoc(file, current);
  };
}

/** Submits with a reserved quota slot, releasing it if Higgsfield never accepted the job. */
async function submitWithQuota(creds: Credentials, kind: Kind, path: string, body: Record<string, unknown>): Promise<RequestStatus> {
  const release = reserveSharedQuota(creds, kind);
  try {
    return await submit(creds, path, body);
  } catch (err) {
    release();
    throw err;
  }
}

// ---------- API calls ----------

interface MediaOutput {
  url: string;
}

interface RequestStatus {
  status: string;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;
  images?: MediaOutput[];
  video?: MediaOutput;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text) as { detail?: unknown };
    if (json.detail) return typeof json.detail === "string" ? json.detail : JSON.stringify(json.detail);
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || res.statusText;
}

/**
 * Submits a generation. The account's concurrency limit (shared by every org
 * on the server key) comes back as a 400 "Maximum number of concurrent
 * requests" — retried with backoff, as are 429/5xx. The same Idempotency-Key
 * is reused across retries so a retry can't start a second paid job.
 */
async function submit(creds: Credentials, path: string, body: Record<string, unknown>): Promise<RequestStatus> {
  const idempotencyKey = randomUUID();
  const delays = [4_000, 8_000, 16_000, 30_000];
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: { Authorization: creds.header, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as RequestStatus;
    const message = await readError(res);
    const busy = (res.status === 400 && /concurrent/i.test(message)) || res.status === 429 || res.status >= 500;
    if (busy && attempt < delays.length) {
      await sleep(delays[attempt] + Math.floor(Math.random() * 1_000));
      continue;
    }
    if (res.status === 401) throw new Error("Higgsfield rejected the API key (check the key ID and secret in Settings).");
    if (busy) throw new Error(`Higgsfield is busy (${message}). Try again in a minute.`);
    throw new Error(`Higgsfield error ${res.status} for ${path}: ${message}`);
  }
}

async function waitForResult(creds: Credentials, submitted: RequestStatus, timeoutMs: number, pollMs: number): Promise<RequestStatus> {
  const statusUrl = submitted.status_url ?? `${API_BASE}/requests/${submitted.request_id}/status`;
  const deadline = Date.now() + timeoutMs;
  let current = submitted;
  while (!TERMINAL.has(current.status)) {
    if (Date.now() > deadline) {
      // Only queued requests can be cancelled; best effort.
      if (submitted.cancel_url) await fetch(submitted.cancel_url, { method: "POST", headers: { Authorization: creds.header } }).catch(() => {});
      throw new Error(`Higgsfield request ${submitted.request_id} didn't finish within ${Math.round(timeoutMs / 60_000)} minutes.`);
    }
    await sleep(pollMs);
    const res = await fetch(statusUrl, { headers: { Authorization: creds.header } });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) continue;
      throw new Error(`Higgsfield status check failed (${res.status}): ${await readError(res)}`);
    }
    current = (await res.json()) as RequestStatus;
  }
  if (current.status === "nsfw") throw new Error("Higgsfield blocked this request as NSFW — rephrase the prompt.");
  if (current.status !== "completed") throw new Error(`Higgsfield generation ${current.status}${current.error ? `: ${current.error}` : ""}.`);
  return current;
}

// ---------- public helpers ----------

export type HiggsfieldAspect = "1:1" | "3:2" | "2:3" | "16:9" | "9:16" | "4:5";

/** Text-to-image. Downloads the result so callers can upload/save it like any other provider's image. */
export async function generateHiggsfieldImage(prompt: string, aspectRatio: HiggsfieldAspect): Promise<{ buffer: Buffer; contentType: string; url: string }> {
  const creds = credentials();
  if (!creds) throw new Error("Higgsfield API key is not set");
  const path = modelPath("HIGGSFIELD_IMAGE_MODEL", DEFAULT_IMAGE_MODEL);
  const submitted = await submitWithQuota(creds, "image", path, { prompt, aspect_ratio: aspectRatio, num_images: 1 });
  const result = await waitForResult(creds, submitted, 4 * 60_000, 3_000);
  const url = result.images?.[0]?.url;
  if (!url) throw new Error("Higgsfield finished but returned no image URL.");
  const file = await fetch(url);
  if (!file.ok) throw new Error(`Couldn't download the Higgsfield image (${file.status}).`);
  return { buffer: Buffer.from(await file.arrayBuffer()), contentType: file.headers.get("content-type") || "image/jpeg", url };
}

/** Text-to-video, or image-to-video when `imageUrl` is given. Returns Higgsfield's hosted URL (kept ≥ 7 days). */
export async function generateHiggsfieldVideo(opts: { prompt: string; imageUrl?: string; length: "short" | "long" }): Promise<{ url: string; model: string }> {
  const creds = credentials();
  if (!creds) throw new Error("Higgsfield API key is not set");
  const path = opts.imageUrl
    ? modelPath("HIGGSFIELD_IMAGE_TO_VIDEO_MODEL", DEFAULT_IMAGE_TO_VIDEO_MODEL)
    : modelPath("HIGGSFIELD_VIDEO_MODEL", DEFAULT_VIDEO_MODEL);
  // Allowed durations differ per model family (Kling: 5/10 s, MiniMax Hailuo: 6/10 s).
  const short = /minimax|hailuo/i.test(path) ? 6 : 5;
  const body: Record<string, unknown> = { prompt: opts.prompt, duration: opts.length === "long" ? 10 : short };
  if (opts.imageUrl) body.image_url = opts.imageUrl;
  const submitted = await submitWithQuota(creds, "video", path, body);
  const result = await waitForResult(creds, submitted, 12 * 60_000, 6_000);
  const url = result.video?.url;
  if (!url) throw new Error("Higgsfield finished but returned no video URL.");
  return { url, model: path };
}

// ---------- agent tool ----------

const generateVideoToolDef = defineTool(
  "generate_video",
  "Generate a short AI video (about 5-10 seconds) with Higgsfield, from a text prompt or by animating an existing image (pass image_url, e.g. a URL returned by generate_image). Takes one to several minutes. Returns a public video URL that stays available for at least 7 days. Show it to the user and get explicit approval before using it as a media entry in create_zernio_post ({url, type: \"video\"}) — this tool only generates, it never posts.",
  {
    prompt: z.string().describe("What should happen in the video: subject, motion, camera, style"),
    image_url: z.string().url().optional().describe("Public URL of an image to animate (image-to-video). Omit for text-to-video."),
    length: z.enum(["short", "long"]).default("short").describe("short ≈ 5-6 seconds, long ≈ 10 seconds (costs more)"),
  },
  async ({ prompt, image_url, length }) => {
    try {
      const video = await generateHiggsfieldVideo({ prompt, imageUrl: image_url, length });
      return {
        content: [
          {
            type: "text" as const,
            text: `Video generated with Higgsfield (${video.model}): ${video.url}\n\nThis link stays available for at least 7 days. Show it to the user and get approval before posting; once approved, use it in create_zernio_post as a media entry ({url, type: "video"}).`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
    }
  },
);

export const VIDEO_GEN_TOOL_DEFS = [generateVideoToolDef];

export const VIDEO_GEN_TOOLS = ["mcp__video_gen__generate_video"];

export const videoGenServer = createSdkMcpServer({
  name: "video_gen",
  version: "1.0.0",
  instructions: "generate_video creates short AI videos (text-to-video or image-to-video) via Higgsfield and returns a URL for the user to approve before posting.",
  tools: VIDEO_GEN_TOOL_DEFS.map((d) => tool(d.name, d.description, d.shape, d.handler)),
});
