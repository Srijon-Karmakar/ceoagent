import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import pg from "pg";
import { getRootDir } from "./paths.js";

// One persistence layer for every JSON "document" the app keeps (runs.json,
// leads.json, settings.json, OAuth token files, ...). Callers keep their
// existing synchronous read/modify/write style and keep addressing documents
// by the same file path they always used; this module decides where the
// bytes actually go:
//
// - DATABASE_URL set (VPS / production): documents live in a Postgres table
//   (e.g. Supabase). All rows are loaded into memory once at startup by
//   initStorage(), reads are served from that cache, and writes update the
//   cache immediately and are flushed to Postgres in the background (latest
//   value per document wins, retried on failure). A document that's missing
//   from the table but still exists on disk is imported from the file on
//   first read, so switching an existing install over needs no manual step.
//   Because of the in-process cache, run ONE server instance per database.
//
// - DATABASE_URL unset (desktop app, local dev): documents stay as JSON
//   files, but are written atomically (temp file + rename) so a crash
//   mid-write can no longer leave a truncated, unparseable file behind.

const TABLE = "app_documents";
const RETRY_MS = 5_000;

let pool: pg.Pool | undefined;
/** null = known deleted. Only used in database mode. */
const cache = new Map<string, unknown | null>();
const pending = new Map<string, unknown | null>();
let flushing: Promise<void> | undefined;
let retryTimer: NodeJS.Timeout | undefined;

export function isDatabaseStorage(): boolean {
  return pool !== undefined;
}

/** Document key: the path relative to the data root, always with forward slashes. */
function keyFor(filePath: string): string {
  return relative(getRootDir(), filePath).split(sep).join("/");
}

/** First path segment pair "orgs/<id>" → org id, for querying/cleanup per tenant. */
function orgIdFor(key: string): string | null {
  const m = /^orgs\/([^/]+)\//.exec(key);
  return m ? m[1] : null;
}

export async function initStorage(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || pool) return;
  const p = new pg.Pool({
    connectionString: url,
    max: 5,
    // Supabase and most hosted Postgres require TLS; allow opting out for a local DB.
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await p.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      key        text PRIMARY KEY,
      org_id     text,
      data       jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await p.query(`CREATE INDEX IF NOT EXISTS ${TABLE}_org_idx ON ${TABLE} (org_id)`);
  const { rows } = await p.query<{ key: string; data: unknown }>(`SELECT key, data FROM ${TABLE}`);
  for (const row of rows) cache.set(row.key, row.data);
  pool = p;
  console.log(`[storage] Postgres storage enabled (${rows.length} documents loaded)`);
}

function readFromDisk<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

/** Returns the document's parsed JSON, or undefined if it doesn't exist. Throws on a corrupt file, like JSON.parse did before. */
export function readDoc<T>(filePath: string): T | undefined {
  if (!pool) return readFromDisk<T>(filePath);
  const key = keyFor(filePath);
  if (cache.has(key)) {
    const v = cache.get(key);
    return v === null ? undefined : (v as T);
  }
  // Not in the database yet — import a pre-existing file once.
  const fromDisk = readFromDisk<T>(filePath);
  cache.set(key, fromDisk ?? null);
  if (fromDisk !== undefined) schedule(key, fromDisk);
  return fromDisk;
}

export function docExists(filePath: string): boolean {
  return readDoc(filePath) !== undefined;
}

export function writeDoc(filePath: string, data: unknown): void {
  if (!pool) {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, filePath);
    return;
  }
  // Snapshot so later in-place mutation by the caller can't change what gets flushed.
  const snapshot = JSON.parse(JSON.stringify(data));
  const key = keyFor(filePath);
  cache.set(key, snapshot);
  schedule(key, snapshot);
}

export function deleteDoc(filePath: string): void {
  if (!pool) {
    if (existsSync(filePath)) unlinkSync(filePath);
    return;
  }
  const key = keyFor(filePath);
  cache.set(key, null);
  schedule(key, null);
}

function schedule(key: string, data: unknown | null) {
  pending.set(key, data);
  if (!flushing) flushing = flushLoop().finally(() => (flushing = undefined));
}

async function flushLoop(): Promise<void> {
  while (pool && pending.size > 0) {
    const [key, data] = pending.entries().next().value as [string, unknown | null];
    pending.delete(key);
    try {
      if (data === null) {
        await pool.query(`DELETE FROM ${TABLE} WHERE key = $1`, [key]);
      } else {
        await pool.query(
          `INSERT INTO ${TABLE} (key, org_id, data, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [key, orgIdFor(key), JSON.stringify(data)],
        );
      }
    } catch (err) {
      console.error(`[storage] failed to persist ${key}, will retry:`, err instanceof Error ? err.message : err);
      // Keep a newer value if one was queued meanwhile; otherwise re-queue this one.
      if (!pending.has(key)) pending.set(key, data);
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (!flushing && pending.size > 0) flushing = flushLoop().finally(() => (flushing = undefined));
        }, RETRY_MS);
      }
      return;
    }
  }
}

/** Waits for all queued writes to reach the database. Call before shutdown. */
export async function flushStorage(): Promise<void> {
  while (flushing) await flushing;
}

export async function closeStorage(): Promise<void> {
  await flushStorage();
  clearTimeout(retryTimer);
  await pool?.end();
  pool = undefined;
  cache.clear();
}

/** Test hook: whether writes are still queued (database mode). */
export function pendingWrites(): number {
  return pending.size;
}
