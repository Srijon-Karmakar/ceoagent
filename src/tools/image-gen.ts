import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { uploadMediaToZernio } from "./zernio.js";
import { getPostImagesDir } from "./post-images.js";
import { getEnvValue } from "../server/settings.js";

type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

type ImageProviderName = "openai" | "huggingface" | "pollinations";

const PROVIDER_LABELS: Record<ImageProviderName, string> = {
  openai: "OpenAI (gpt-image-1)",
  huggingface: "Hugging Face (FLUX.1-schnell)",
  pollinations: "Pollinations (free, no API key)",
};

interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
}

function parseSize(size: ImageSize): { width: number; height: number } {
  const [width, height] = size.split("x").map(Number);
  return { width, height };
}

/** Whether a paid/higher-quality provider (OpenAI or Hugging Face) is
 * configured — used only for the Accounts/Tools "connected" display.
 * Generation itself always works regardless, via the Pollinations fallback
 * below, which needs no configuration at all. */
export function isImageGenConfigured(): boolean {
  return !!getEnvValue("OPENAI_API_KEY") || !!getEnvValue("HUGGINGFACE_API_KEY");
}

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";

async function generateViaOpenAI(prompt: string, size: ImageSize): Promise<GeneratedImage> {
  const key = getEnvValue("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const res = await fetch(OPENAI_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size, n: 1 }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI response had no image data.");
  return { buffer: Buffer.from(b64, "base64"), contentType: "image/png" };
}

const HF_MODEL = "black-forest-labs/FLUX.1-schnell";
const HF_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;

async function generateViaHuggingFace(prompt: string, size: ImageSize): Promise<GeneratedImage> {
  const key = getEnvValue("HUGGINGFACE_API_KEY");
  if (!key) throw new Error("HUGGINGFACE_API_KEY is not set");
  const { width, height } = parseSize(size);
  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt, parameters: { width, height } }),
  });
  if (!res.ok) {
    throw new Error(`Hugging Face error: ${res.status} ${await res.text()}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    // The free inference API returns a JSON error body (not an image) when
    // the model is cold-starting or the request was malformed, even on a
    // 200 in some cases — a non-image content-type is the reliable signal.
    const text = await res.text().catch(() => "");
    throw new Error(`Hugging Face did not return an image: ${text.slice(0, 200)}`);
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

const POLLINATIONS_URL = "https://image.pollinations.ai/prompt";

async function generateViaPollinations(prompt: string, size: ImageSize): Promise<GeneratedImage> {
  const { width, height } = parseSize(size);
  // Random seed so repeated identical prompts don't just hit a cached image.
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const url = `${POLLINATIONS_URL}/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pollinations error: ${res.status}`);
  const contentType = res.headers.get("content-type") || "image/jpeg";
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

const PROVIDERS: {
  name: ImageProviderName;
  configured: () => boolean;
  generate: (prompt: string, size: ImageSize) => Promise<GeneratedImage>;
}[] = [
  { name: "openai", configured: () => !!getEnvValue("OPENAI_API_KEY"), generate: generateViaOpenAI },
  { name: "huggingface", configured: () => !!getEnvValue("HUGGINGFACE_API_KEY"), generate: generateViaHuggingFace },
  { name: "pollinations", configured: () => true, generate: generateViaPollinations },
];

/**
 * Tries each configured provider in order — OpenAI, then Hugging Face, then
 * Pollinations — falling through on ANY failure from one provider to the
 * next: no key set, out of credit/quota, rate-limited, a cold-starting free
 * model, whatever. Pollinations needs no key at all, so this only fails if
 * every provider is unreachable. Returns which provider actually produced
 * the image so callers can be honest about provenance/quality instead of
 * always claiming "OpenAI".
 */
async function generateImage(prompt: string, size: ImageSize): Promise<GeneratedImage & { provider: ImageProviderName }> {
  const errors: string[] = [];
  for (const p of PROVIDERS) {
    if (!p.configured()) continue;
    try {
      const result = await p.generate(prompt, size);
      return { ...result, provider: p.name };
    } catch (err) {
      errors.push(`${PROVIDER_LABELS[p.name]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`All image providers failed:\n${errors.join("\n")}`);
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  return ".png";
}

// Filenames are user/agent supplied (e.g. "promo-1.png") and only ever joined
// under getPostImagesDir() — strip any path separators so this can't escape
// that directory (e.g. "../../etc/passwd"). Keeps an explicit extension if
// one was given; otherwise picks one matching what the provider actually
// returned, since Hugging Face/Pollinations don't always return PNG.
function sanitizeFilename(name: string, contentType: string): string {
  const base = name.replace(/[\\/]/g, "_").trim() || `generated-${randomUUID()}`;
  const ext = extname(base).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return base;
  return `${base}${extensionForContentType(contentType)}`;
}

const generateImageTool = tool(
  "generate_image",
  "Generate an image from a text prompt and upload it for preview. Automatically tries OpenAI first if configured, then Hugging Face, then falls back to a free no-key provider (Pollinations) — so this always works even with no API key configured or when a paid provider is out of credit/quota. Returns a public URL — show it to the user and get explicit approval before passing it to create_zernio_post as a media entry ({url, type: \"image\"}) or to create_postiz_post as an imageUrls entry; this tool only generates, it never posts.",
  {
    prompt: z.string().describe("Description of the image to generate"),
    size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024").describe("1024x1024 square, 1536x1024 landscape, 1024x1536 portrait"),
  },
  async ({ prompt, size }) => {
    let image: GeneratedImage & { provider: ImageProviderName };
    try {
      image = await generateImage(prompt, size);
    } catch (err) {
      return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
    }

    try {
      const filename = sanitizeFilename(`generated-${randomUUID()}`, image.contentType);
      const publicUrl = await uploadMediaToZernio(image.buffer, filename, image.contentType);
      return {
        content: [
          {
            type: "text" as const,
            text: `Generated via ${PROVIDER_LABELS[image.provider]}, uploaded for review: ${publicUrl}\n\nShow this link to the user before posting. Once approved, call create_zernio_post with this URL as a media entry ({url, type: "image"}), or create_postiz_post with it in imageUrls.`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Image generated (via ${PROVIDER_LABELS[image.provider]}) but upload for preview failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

const generatePostImage = tool(
  "generate_post_image",
  "Generate an image from a text prompt and save it directly into the local post-images drop folder — for bulk-generating images ahead of scheduled/automated posting, skipping the preview-URL approval step generate_image uses. Automatically tries OpenAI first if configured, then Hugging Face, then falls back to a free no-key provider (Pollinations). Call once per image (e.g. 4 times for 4 images, with distinct filenames). After generating, use list_post_images to confirm and post_folder_image (immediately, or via a scheduled automation) to actually publish each one.",
  {
    prompt: z.string().describe("Description of the image to generate"),
    size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).default("1024x1024").describe("1024x1024 square, 1536x1024 landscape, 1024x1536 portrait"),
    filename: z
      .string()
      .optional()
      .describe('Filename to save as, e.g. "promo-1.png" (extension added automatically if omitted). Defaults to a random name — always pass an explicit, distinct filename when generating a batch.'),
  },
  async ({ prompt, size, filename }) => {
    let image: GeneratedImage & { provider: ImageProviderName };
    try {
      image = await generateImage(prompt, size);
    } catch (err) {
      return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
    }

    try {
      const safeName = sanitizeFilename(filename ?? `generated-${randomUUID()}`, image.contentType);
      const filePath = join(getPostImagesDir(), safeName);
      await writeFile(filePath, image.buffer);
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved "${safeName}" (via ${PROVIDER_LABELS[image.provider]}) to the post-images folder. Use list_post_images to confirm, then post_folder_image (directly or via a scheduled automation) to publish it.`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Image generated (via ${PROVIDER_LABELS[image.provider]}) but saving to the post-images folder failed: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  },
);

export const IMAGE_GEN_TOOLS = ["mcp__image_gen__generate_image", "mcp__image_gen__generate_post_image"];

export const imageGenServer = createSdkMcpServer({
  name: "image_gen",
  version: "1.0.0",
  instructions:
    "Tools for generating AI images: generate_image for a single preview-and-approve flow, generate_post_image to save straight into the post-images folder for bulk/scheduled posting. Both automatically fall back across OpenAI -> Hugging Face -> Pollinations depending on what's configured and working, always succeeding via the free Pollinations tier at worst.",
  tools: [generateImageTool, generatePostImage],
});
