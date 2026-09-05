import express from "express";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getGlobalDataDir, runWithTenant, type TenantContext } from "../paths.js";

const COOKIE_NAME = "ceo_agent_session";
const TENANTS_FILE = join(getGlobalDataDir(), "tenants.json");

// Gmail/Instagram/LinkedIn/Facebook/Canva "Connect" links must be opened in
// the user's real OS browser (see setWindowOpenHandler in electron/main.cjs)
// because these providers block sign-in from an embedded Electron webview.
// That real browser doesn't carry the Electron session's `ceo_agent_session`
// cookie, so it can't be used to identify which tenant's credentials to use
// for the OAuth round trip. Instead, the authenticated Electron session mints
// one of these short-lived signed tokens (identifying only the tenant, not a
// login) into the connect link; it round-trips through the provider via the
// standard OAuth `state` param and is verified — without needing any cookie
// — on both the initiating request and the callback. It's process-lifetime
// only (not persisted), which is fine since a connect flow completes in a
// couple of minutes, well inside OAUTH_STATE_TTL_MS.
const OAUTH_STATE_SECRET = randomBytes(32);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function signOAuthState(payload: string): string {
  return createHmac("sha256", OAUTH_STATE_SECRET).update(payload).digest("base64url");
}

export function createOAuthStateToken(tenant: TenantContext): string {
  const payload = Buffer.from(JSON.stringify({ o: tenant.organizationId, e: Date.now() + OAUTH_STATE_TTL_MS })).toString(
    "base64url",
  );
  return `${payload}.${signOAuthState(payload)}`;
}

export function verifyOAuthStateToken(token: string): TenantContext {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new Error("Malformed OAuth state token");
  const expected = signOAuthState(payload);
  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actual.length !== expectedBuf.length || !timingSafeEqual(actual, expectedBuf)) {
    throw new Error("Invalid OAuth state token");
  }
  const { o: organizationId, e: expiresAt } = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
    o: string;
    e: number;
  };
  if (Date.now() > expiresAt) throw new Error("OAuth state token expired — please click Connect again");
  const tenant = findTenantByOrganizationId(organizationId);
  if (!tenant) throw new Error("Unknown organization in OAuth state token");
  return tenant;
}

/**
 * Resolves which tenant an /auth/* OAuth request belongs to, without relying
 * on the session cookie (see the OAuth-state-token comment above). Falls
 * back to the cookie when there's no state token, so the flow still works if
 * hit from inside the Electron window itself (e.g. during dev). Returns
 * undefined for single-tenant/no-auth deployments, matching pre-multi-tenant
 * behavior.
 */
export async function resolveAuthFlowTenant(req: express.Request): Promise<TenantContext | undefined> {
  if (!isSupabaseAuthConfigured()) return undefined;
  const token = typeof req.query.state === "string" ? req.query.state : "";
  if (token) return verifyOAuthStateToken(token);
  return readRequestTenant(req);
}

interface SupabaseUser {
  id: string;
  email?: string;
  user_metadata?: {
    name?: string;
    full_name?: string;
    organization_name?: string;
  };
}

interface TenantRecord extends TenantContext {
  createdAt: string;
  updatedAt: string;
}

type TenantsFile = {
  users: Record<string, TenantRecord>;
};

function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL?.replace(/\/+$/, "");
}

function supabaseAnonKey(): string | undefined {
  return process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
}

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

export function getPublicAuthConfig() {
  return {
    enabled: isSupabaseAuthConfigured(),
    supabaseUrl: supabaseUrl() ?? null,
    supabaseAnonKey: supabaseAnonKey() ?? null,
  };
}

function readTenants(): TenantsFile {
  if (!existsSync(TENANTS_FILE)) return { users: {} };
  try {
    return JSON.parse(readFileSync(TENANTS_FILE, "utf-8"));
  } catch {
    return { users: {} };
  }
}

function writeTenants(data: TenantsFile) {
  const dir = getGlobalDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TENANTS_FILE, JSON.stringify(data, null, 2));
}

function readCookie(req: express.Request, name: string): string | undefined {
  const header = req.header("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

function cookieOptions(maxAge = 60 * 60): string {
  const parts = [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function setSessionCookie(res: express.Response, accessToken: string) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(accessToken)}; ${cookieOptions()}`);
}

export function clearSessionCookie(res: express.Response) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}

async function verifyAccessToken(accessToken: string): Promise<SupabaseUser> {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) throw new Error("Supabase auth is not configured");

  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) throw new Error("Invalid Supabase session");
  const user = (await res.json()) as SupabaseUser;
  if (!user.id) throw new Error("Supabase user response had no id");
  return user;
}

function tenantForUser(user: SupabaseUser): TenantContext {
  const data = readTenants();
  const existing = data.users[user.id];
  if (existing) {
    const email = user.email ?? existing.email;
    if (email !== existing.email) {
      existing.email = email;
      existing.updatedAt = new Date().toISOString();
      writeTenants(data);
    }
    return existing;
  }

  const now = new Date().toISOString();
  const name = user.user_metadata?.name ?? user.user_metadata?.full_name ?? "";
  const organizationName = user.user_metadata?.organization_name ?? "My Organization";
  const record: TenantRecord = {
    userId: user.id,
    email: user.email ?? "",
    name,
    organizationId: randomUUID(),
    organizationName,
    createdAt: now,
    updatedAt: now,
  };
  data.users[user.id] = record;
  writeTenants(data);
  return record;
}

export function listTenantContexts(): TenantContext[] {
  return Object.values(readTenants().users);
}

export function findTenantByOrganizationId(organizationId: string): TenantContext | undefined {
  return listTenantContexts().find((tenant) => tenant.organizationId === organizationId);
}

export async function readRequestTenant(req: express.Request): Promise<TenantContext> {
  const token = readCookie(req, COOKIE_NAME) ?? req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing session");
  return tenantForUser(await verifyAccessToken(token));
}

declare global {
  namespace Express {
    interface Request {
      // Stashed by requireAuth alongside the AsyncLocalStorage context (see
      // restoreTenant below) since multer's multipart parsing runs the rest
      // of the middleware chain outside that context — it isn't a plain
      // Promise continuation, so Node's async-context propagation doesn't
      // carry it through busboy's stream handling.
      tenant?: TenantContext;
    }
  }
}

export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.originalUrl.startsWith("/api/automation/")) {
    next();
    return;
  }
  readRequestTenant(req)
    .then((tenant) => {
      req.tenant = tenant;
      runWithTenant(tenant, next);
    })
    .catch(() => {
      if (req.path.startsWith("/api/")) {
        res.status(401).json({ error: "authentication required" });
        return;
      }
      res.redirect("/");
    });
}

// Re-establishes the tenant AsyncLocalStorage context after a multer upload
// middleware, which loses it (see the Request.tenant comment above). Mount
// this right after `upload.single(...)`/`upload.array(...)` on any route
// whose handler resolves tenant-scoped storage (getDataDir/getWorkspaceDir/
// etc.) — otherwise those calls silently fall back to the untenanted base
// dir instead of throwing, so the bug shows up as "not found" errors on
// paths that plainly exist.
export function restoreTenant(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.tenant) {
    runWithTenant(req.tenant, next);
  } else {
    next();
  }
}

export function requireAutomationTenant(req: express.Request, res: express.Response, next: express.NextFunction) {
  const configuredKey = process.env.AUTOMATION_API_KEY;
  if (!configuredKey) {
    res.status(503).json({ error: "AUTOMATION_API_KEY is not configured on this server" });
    return;
  }
  if (req.header("X-API-Key") !== configuredKey) {
    res.status(401).json({ error: "invalid or missing X-API-Key header" });
    return;
  }
  const organizationId = req.header("X-Organization-Id");
  if (!organizationId) {
    res.status(400).json({ error: "X-Organization-Id header is required" });
    return;
  }
  const tenant = findTenantByOrganizationId(organizationId);
  if (!tenant) {
    res.status(404).json({ error: "unknown organization" });
    return;
  }
  runWithTenant(tenant, next);
}
