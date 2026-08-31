import { isGmailConnected } from "../tools/gmail.js";
import { isInstagramConnected } from "../tools/instagram.js";
import { isLinkedinConnected } from "../tools/linkedin.js";
import { isFacebookConnected } from "../tools/facebook.js";
import { isZernioConnected } from "../tools/zernio.js";
import { isPostizConnected } from "../tools/postiz.js";
import { isScrapegraphConnected } from "../tools/scrapegraph.js";
import { isWhatsappConnected } from "../tools/whatsapp.js";
import { isImageGenConfigured } from "../tools/image-gen.js";
import { isRedditConnected } from "../tools/reddit.js";
import { isHunterConnected } from "../tools/hunter.js";
import { isCanvaConnected } from "../tools/canva.js";

export interface ToolCatalogEntry {
  key: string;
  label: string;
  connected: boolean;
  usedBy: string[];
  features: string[];
  examplePrompt: string;
}

// Mirrors /api/accounts' set of optional integrations — same "connected"
// concept, just described from a "what can I ask for" angle instead of a
// connect/disconnect one. Feature/prompt text is curated by hand (not
// reflected from each tool's MCP schema) to keep this page short and
// readable rather than dumping raw tool descriptions.
type CatalogSeed = Omit<ToolCatalogEntry, "connected">;

const CATALOG: CatalogSeed[] = [
  {
    key: "gmail",
    label: "Gmail",
    usedBy: ["Emails", "Sales", "CRM", "PR"],
    features: ["Read & search the inbox", "Draft replies", "Send email (only when told to)"],
    examplePrompt: "Check my inbox for unread emails and draft a reply to the most important one.",
  },
  {
    key: "instagram",
    label: "Instagram",
    usedBy: ["Sales", "CRM"],
    features: ["Read DM conversations (read-only)"],
    examplePrompt: "Summarize my recent Instagram DM conversations.",
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    usedBy: ["Sales", "PR", "CRM"],
    features: ["Post to the Company Page feed", "List recent Company Page posts"],
    examplePrompt: "Draft a LinkedIn post announcing our new feature, then publish it.",
  },
  {
    key: "facebook",
    label: "Facebook Groups",
    usedBy: ["Sales", "PR"],
    features: ["Post to a Facebook Group you administer (requires Meta App Review approval to actually publish)"],
    examplePrompt: "Post this announcement to our Facebook Group.",
  },
  {
    key: "zernio",
    label: "Zernio",
    usedBy: ["Sales", "PR"],
    features: [
      "Post/DM across X, Instagram, Facebook, TikTok, YouTube & more",
      "Read inbox conversations across platforms",
      "Post AI-generated or your own images",
    ],
    examplePrompt: "Post this announcement to LinkedIn and X via Zernio, with the image I generated.",
  },
  {
    key: "postiz",
    label: "Postiz",
    usedBy: ["Sales", "PR"],
    features: ["Publish or schedule posts across connected platforms", "List connected channels"],
    examplePrompt: "List my connected Postiz channels, then draft a launch post for X and LinkedIn.",
  },
  {
    key: "scrapegraph",
    label: "ScrapeGraphAI",
    usedBy: ["Analysis", "SEO", "AEO", "CRM"],
    features: ["Extract structured JSON from any URL", "AI search that returns real page content"],
    examplePrompt: "Use scrapegraph to extract the pricing plans from thebetterpass.com.",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    usedBy: ["Sales", "CRM"],
    features: ["Send freeform messages (within the 24h window)", "Start new conversations via approved templates"],
    examplePrompt: "Send a WhatsApp follow-up to +1234567890 using our approved intro template.",
  },
  {
    key: "image_gen",
    label: "AI image generation",
    usedBy: ["Sales", "PR"],
    features: [
      "Generate an AI image from a text prompt for a social post",
      "Automatically falls back OpenAI -> Hugging Face -> a free no-key provider, so it always works even with no paid key configured",
    ],
    examplePrompt: "Generate an image of a modern SaaS dashboard for our next LinkedIn post.",
  },
  {
    key: "reddit",
    label: "Reddit",
    usedBy: ["SEO", "AEO"],
    features: [
      "Publish text posts to pre-approved subreddits",
      "Search for relevant subreddits when none of the pre-approved ones fit (needs your approval before posting there)",
    ],
    examplePrompt: "Turn this week's SEO report into a Reddit post.",
  },
  {
    key: "hunter",
    label: "Hunter.io",
    usedBy: ["CRM"],
    features: ["Find all known emails at a company domain", "Find one person's likely email by name + domain"],
    examplePrompt: "Find a contact email at acme.com using Hunter, then add them as a lead.",
  },
  {
    key: "canva",
    label: "Canva",
    usedBy: ["Sales", "PR"],
    features: ["Create a design (optionally from an image) with an edit link", "Export a finished design to PNG/JPG/PDF"],
    examplePrompt: "Create a Canva design for our product launch announcement and give me the edit link.",
  },
];

export function getToolsCatalog(): ToolCatalogEntry[] {
  const connected: Record<string, boolean> = {
    gmail: isGmailConnected(),
    instagram: isInstagramConnected(),
    linkedin: isLinkedinConnected(),
    facebook: isFacebookConnected(),
    zernio: isZernioConnected(),
    postiz: isPostizConnected(),
    scrapegraph: isScrapegraphConnected(),
    whatsapp: isWhatsappConnected(),
    image_gen: isImageGenConfigured(),
    reddit: isRedditConnected(),
    hunter: isHunterConnected(),
    canva: isCanvaConnected(),
  };
  return CATALOG.map((entry) => ({ ...entry, connected: connected[entry.key] ?? false }));
}
