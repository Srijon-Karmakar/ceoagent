import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeStorage, deleteDoc, flushStorage, initStorage, isDatabaseStorage, readDoc, writeDoc } from "../src/storage.js";

// Runs only when a throwaway Postgres is available (CI provides one):
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres DATABASE_SSL=false npm test
const url = process.env.TEST_DATABASE_URL;
const root = process.env.CEO_AGENT_DATA_DIR!;

describe.skipIf(!url)("storage (Postgres mode)", () => {
  beforeAll(async () => {
    const client = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === "false" ? false : undefined });
    await client.connect();
    await client.query("DROP TABLE IF EXISTS app_documents");
    await client.end();
    process.env.DATABASE_URL = url;
    await initStorage();
  });

  afterAll(async () => {
    await closeStorage();
    delete process.env.DATABASE_URL;
  });

  it("persists documents across restarts", async () => {
    expect(isDatabaseStorage()).toBe(true);
    const file = join(root, "orgs", "acme", "data", "leads.json");
    writeDoc(file, [{ id: "l1" }]);
    expect(readDoc(file)).toEqual([{ id: "l1" }]); // served from cache immediately
    await closeStorage();
    await initStorage();
    expect(readDoc(file)).toEqual([{ id: "l1" }]);
  });

  it("imports a pre-existing JSON file on first read", async () => {
    const dir = join(root, "orgs", "legacy", "data");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "runs.json"), JSON.stringify([{ id: "r1" }]));
    expect(readDoc(join(dir, "runs.json"))).toEqual([{ id: "r1" }]);
    await flushStorage();
    const client = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === "false" ? false : undefined });
    await client.connect();
    const { rows } = await client.query("SELECT org_id, data FROM app_documents WHERE key = 'orgs/legacy/data/runs.json'");
    await client.end();
    expect(rows[0]).toEqual({ org_id: "legacy", data: [{ id: "r1" }] });
  });

  it("deletes documents", async () => {
    const file = join(root, "orgs", "acme", "data", "token.json");
    writeDoc(file, { t: 1 });
    deleteDoc(file);
    await closeStorage();
    await initStorage();
    expect(readDoc(file)).toBeUndefined();
  });
});
