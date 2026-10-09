import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

// What agents may touch on the host. An agent session's `cwd` (the per-org
// workspace) is only a *starting* directory — on its own it confines
// nothing: Bash can `cat ../../.env`, and Read/Write/Edit/Glob/Grep accept
// absolute paths and "..". On a multi-tenant server that's every other
// organization's data, OAuth tokens and the server's own secrets, reachable
// by any signed-in user or by a prompt injection in an email/web page an
// agent reads. So:
//
// - Shell access (the Developer agent's Bash, and the Codex provider, whose
//   CLI always has a shell and reads outside its workspace) is OFF unless
//   the operator sets ALLOW_AGENT_SHELL=true. That's meant for trusted
//   single-user installs only; it's read from the real environment, never
//   from a tenant's Settings, so a tenant can't switch it on for themselves.
// - File tools are confined to the workspace by a PreToolUse hook (below),
//   with symlinks resolved, and kept out of the documents store.

export function isAgentShellAllowed(): boolean {
  return process.env.ALLOW_AGENT_SHELL === "true";
}

/** Drops Bash from an agent's tool list unless shell access is enabled. */
export function withShellPolicy(tools: string[]): string[] {
  return isAgentShellAllowed() ? tools : tools.filter((t) => t !== "Bash");
}

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "NotebookEdit", "NotebookRead"]);
const PATH_FIELDS = ["file_path", "path", "notebook_path"];
// Pattern-ish fields can smuggle a path out too (`Glob {pattern: "/etc/*"}`).
const PATTERN_FIELDS = ["pattern", "glob"];
/** Workspace subfolders agents must never touch directly — written only by app tools. */
const PROTECTED_SUBDIRS = [".documents"];

/** realpath of `p`, or of its nearest existing ancestor (for files about to be created). */
function realpathLoose(p: string): string {
  let current = p;
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return p;
    rest.unshift(current.slice(parent.length).replace(/^[\\/]+/, ""));
    current = parent;
  }
  return resolve(realpathSync(current), ...rest);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Returns why `input` would escape `workspaceDir`, or null if it's fine. Exported for tests. */
export function fileToolViolation(toolName: string, input: Record<string, unknown>, workspaceDir: string): string | null {
  if (toolName === "Bash" && !isAgentShellAllowed()) return "Shell commands are disabled on this server.";
  if (!FILE_TOOLS.has(toolName)) return null;

  const root = realpathLoose(resolve(workspaceDir));
  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value !== "string" || value === "") continue;
    const target = realpathLoose(resolve(root, value));
    if (!isInside(root, target)) return `"${value}" is outside your workspace — only files inside it can be accessed.`;
    for (const sub of PROTECTED_SUBDIRS) {
      if (isInside(resolve(root, sub), target)) return `"${value}" is managed by the app and can't be accessed directly.`;
    }
  }
  for (const field of PATTERN_FIELDS) {
    // Grep's `pattern` is a regex over file contents, not a path — only its `glob` filter is path-like.
    if (toolName === "Grep" && field === "pattern") continue;
    const value = input[field];
    if (typeof value !== "string") continue;
    if (isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.split(/[\\/]/).includes("..")) {
      return `Pattern "${value}" must be relative to your workspace and can't contain "..".`;
    }
  }
  return null;
}

/** PreToolUse hook enforcing the policy above for one run's workspace (captured now, since hooks may fire outside the tenant's async context). */
export function workspaceGuardHook(workspaceDir: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = fileToolViolation(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, workspaceDir);
    if (!reason) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  };
}

// Environment for agent subprocesses that run their own shell (Codex). The
// server's process.env holds every operator secret (API keys, DATABASE_URL,
// OAuth client secrets) — a subprocess only needs enough to locate binaries,
// its own login state and temp space.
const SUBPROCESS_ENV_ALLOWLIST = [
  "PATH", "Path", "PATHEXT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "ComSpec",
  "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "CODEX_HOME", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE",
];

export function minimalSubprocessEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SUBPROCESS_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...extra };
}
