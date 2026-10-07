import { dirname, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The packaged Electron app sets CEO_AGENT_DATA_DIR to a per-user writable
// folder (app.getPath('userData')) before starting the server, since the
// install directory itself (e.g. under Program Files) isn't writable by a
// normal user at runtime. In dev (tsx against source), this is unset and
// everything falls back to the project-root data/workspace dirs, unchanged
// from before this helper existed.
const BASE_DIR = process.env.CEO_AGENT_DATA_DIR ?? join(__dirname, "..");

export interface TenantContext {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function runWithTenant<T>(tenant: TenantContext, fn: () => T): T {
  return tenantStorage.run(tenant, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function getBaseDir(): string {
  const tenant = getTenantContext();
  return tenant ? join(BASE_DIR, "orgs", safeSegment(tenant.organizationId)) : BASE_DIR;
}

/** The tenant-independent root everything else lives under — storage.ts keys documents relative to it. */
export function getRootDir(): string {
  return BASE_DIR;
}

export function getGlobalDataDir(): string {
  return join(BASE_DIR, "data");
}

export function getDataDir(): string {
  return join(getBaseDir(), "data");
}

export function getWorkspaceDir(): string {
  return join(getBaseDir(), "workspace");
}

export function getDeliverablesDir(): string {
  return join(getBaseDir(), "deliverables");
}
