import express from "express";
import multer from "multer";
import {
  FilesApiError,
  UPLOAD_LIMITS,
  createFolder,
  deleteEntry,
  listDirectory,
  resolveVirtualPath,
  saveUpload,
  statPath,
} from "./files.js";
import { restoreTenant } from "./auth.js";

const upload = multer({ storage: multer.memoryStorage(), limits: UPLOAD_LIMITS });

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeFor(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function handleFilesError(err: unknown, res: express.Response) {
  if (err instanceof FilesApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

export const filesRouter = express.Router();

// --- Browse: lazily lists one folder at a time (VS Code-style expand on
// click), rather than shipping the whole tree up front — some of these
// folders (data/Projects/...) hold a lot of spreadsheets.

filesRouter.get("/list", async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : "";
  try {
    const entries = await listDirectory(path);
    res.json({ path, entries });
  } catch (err) {
    handleFilesError(err, res);
  }
});

// --- Raw: serves a file's bytes, either inline (image/pdf/text preview) or
// as a forced download (?download=1). One endpoint for both since the only
// difference is Content-Disposition.

filesRouter.get("/raw", async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : "";
  try {
    const { resolved, stat } = await statPath(path);
    if (!stat.isFile()) {
      res.status(400).json({ error: "not a file" });
      return;
    }
    const name = resolved.absPath.split(/[\\/]/).pop() ?? "file";
    res.setHeader("Content-Type", mimeFor(name));
    if (req.query.download === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
    }
    res.sendFile(resolved.absPath);
  } catch (err) {
    handleFilesError(err, res);
  }
});

// --- Upload: drops one or more files into an existing folder. Never
// overwrites (saveUpload auto-suffixes on a name clash) and never lets the
// client address anything outside the three known roots (resolveVirtualPath,
// called inside saveUpload, enforces that).

filesRouter.post("/upload", upload.array("files", UPLOAD_LIMITS.files), restoreTenant, async (req, res) => {
  const targetPath = typeof req.body?.path === "string" ? req.body.path : "";
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) {
    res.status(400).json({ error: "at least one file is required" });
    return;
  }
  try {
    // Validate the target once up front so a bad path fails clearly instead
    // of as N per-file errors.
    resolveVirtualPath(targetPath);
    const saved = [];
    for (const file of files) {
      saved.push(await saveUpload(targetPath, file.originalname, file.buffer));
    }
    res.status(201).json({ entries: saved });
  } catch (err) {
    handleFilesError(err, res);
  }
});

// --- Mkdir: creates one subfolder inside an existing folder. Never
// overwrites (createFolder auto-suffixes on a name clash), same as upload.

filesRouter.post("/mkdir", async (req, res) => {
  const targetPath = typeof req.body?.path === "string" ? req.body.path : "";
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  if (!name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  try {
    const entry = await createFolder(targetPath, name);
    res.status(201).json({ entry });
  } catch (err) {
    handleFilesError(err, res);
  }
});

// --- Delete: removes a file or folder (recursively). Refuses to touch a
// root itself; anything else within the three known roots is fair game.

filesRouter.delete("/entry", async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : "";
  try {
    await deleteEntry(path);
    res.status(204).end();
  } catch (err) {
    handleFilesError(err, res);
  }
});

filesRouter.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});
