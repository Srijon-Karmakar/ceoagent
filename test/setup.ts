import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test file gets its own throwaway data root, so tests never touch the
// real data/ or orgs/ folders and never depend on each other's state.
process.env.CEO_AGENT_DATA_DIR = mkdtempSync(join(tmpdir(), "ceo-agent-test-"));
delete process.env.DATABASE_URL;
