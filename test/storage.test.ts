import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteDoc, docExists, readDoc, writeDoc, isDatabaseStorage } from "../src/storage.js";

const root = process.env.CEO_AGENT_DATA_DIR!;

describe("storage (file mode)", () => {
  it("is in file mode without DATABASE_URL", () => {
    expect(isDatabaseStorage()).toBe(false);
  });

  it("round-trips a document and creates missing directories", () => {
    const file = join(root, "orgs", "acme", "data", "things.json");
    expect(readDoc(file)).toBeUndefined();
    writeDoc(file, [{ id: 1, name: "a" }]);
    expect(docExists(file)).toBe(true);
    expect(readDoc(file)).toEqual([{ id: 1, name: "a" }]);
    // Written as pretty JSON, compatible with the previous on-disk format.
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual([{ id: 1, name: "a" }]);
  });

  it("leaves no temp files behind after an atomic write", () => {
    const dir = join(root, "atomic");
    writeDoc(join(dir, "a.json"), { v: 1 });
    writeDoc(join(dir, "a.json"), { v: 2 });
    expect(readdirSync(dir)).toEqual(["a.json"]);
    expect(readDoc(join(dir, "a.json"))).toEqual({ v: 2 });
  });

  it("reads files written by older versions of the app", () => {
    const dir = join(root, "legacy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "old.json"), JSON.stringify({ hello: "world" }, null, 2));
    expect(readDoc(join(dir, "old.json"))).toEqual({ hello: "world" });
  });

  it("deletes documents", () => {
    const file = join(root, "del.json");
    writeDoc(file, {});
    deleteDoc(file);
    expect(existsSync(file)).toBe(false);
    expect(docExists(file)).toBe(false);
    deleteDoc(file); // deleting twice is a no-op
  });
});
