/**
 * Gemini-powered AI organizer routes
 * Route: /api/ai
 */

import express, { Request, Response, Router } from "express";
import * as fs from "fs";
import * as path from "path";
import Joi from "joi";
import { authMiddleware } from "../auth";
import {
  AiDisabledError,
  auditVaultWithGemini,
  chatWithVaultOrganizer,
  getAiStatus,
  invalidateAiCache,
  organizeNoteWithGemini,
  streamVaultOrganizerChat,
} from "../services/gemini-ai";
import {
  findFolderPathByName,
  flattenNotes,
  getNoteDetailsById,
  getVaultData,
  getVaultPath,
  invalidateCache,
  Note,
} from "./vault";

const router: Router = express.Router();
const ROOT_FOLDER_LABEL = "Vault root";

const schemas = {
  organizeNote: Joi.object({
    noteId: Joi.string().trim().min(1).max(255).required(),
    objective: Joi.string().trim().max(500).allow("", null),
  }),
  applyNote: Joi.object({
    noteId: Joi.string().trim().min(1).max(255).required(),
    title: Joi.string().trim().min(1).max(255).allow("", null),
    content: Joi.string().max(1_000_000).required(),
    folder: Joi.string().trim().max(500).allow("", null),
    tags: Joi.array().items(Joi.string().trim().min(1).max(100)).max(24).default([]),
  }),
  auditVault: Joi.object({
    limit: Joi.number().integer().min(20).max(180).default(120),
  }),
  chat: Joi.object({
    question: Joi.string().trim().min(1).max(2_000).required(),
    noteId: Joi.string().trim().max(255).allow("", null),
  }),
};

function sendValidationError(res: Response, error: Joi.ValidationError): Response {
  return res.status(400).json({
    error: "Invalid request body",
    details: error.details.map((detail) => ({
      field: detail.path.join("."),
      message: detail.message,
    })),
  });
}

function handleAiError(res: Response, err: unknown): Response {
  if (err instanceof AiDisabledError) {
    return res.status(503).json({
      error: "AI unavailable",
      message: "Gemini AI is disabled or GEMINI_API_KEY is not configured",
    });
  }

  return res.status(500).json({
    error: "AI request failed",
    message: err instanceof Error ? err.message : "Unknown AI error",
  });
}

function scoreRelatedNote(baseNote: Note, candidate: Note & { folder: string }): number {
  if (candidate.id === baseNote.id) return -1;

  const baseTags = new Set((baseNote.tags || []).map((tag) => tag.toLowerCase()));
  const candidateTags = new Set((candidate.tags || []).map((tag) => tag.toLowerCase()));
  let score = 0;

  for (const tag of candidateTags) {
    if (baseTags.has(tag)) score += 8;
  }

  if ((baseNote.links || []).includes(candidate.id)) score += 6;
  if ((candidate.links || []).includes(baseNote.id)) score += 6;

  const baseFolder = path.dirname(baseNote.path);
  const candidateFolder = path.dirname(candidate.path);
  if (baseFolder === candidateFolder) score += 3;

  const baseWords = new Set(baseNote.name.toLowerCase().split(/\s+/).filter(Boolean));
  for (const word of candidate.name.toLowerCase().split(/\s+/)) {
    if (baseWords.has(word)) score += 1;
  }

  return score;
}

function getRelatedNotes(baseNote: Note, notes: Array<Note & { folder: string }>) {
  return notes
    .map((candidate) => ({
      candidate,
      score: scoreRelatedNote(baseNote, candidate),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ candidate, score }) => ({
      id: candidate.id,
      name: candidate.name,
      folder: getRelativeFolder(candidate.path),
      tags: candidate.tags || [],
      reason:
        score >= 14
          ? "Strong overlap in tags, links, or folder context"
          : "Potentially relevant based on nearby tags or references",
    }));
}

function buildFolderList(notes: Array<Note & { folder: string }>): string[] {
  return [...new Set(notes.map((note) => getRelativeFolder(note.path)).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/u, "");
}

function buildFrontmatter(title: string, tags: string[]): string {
  const normalizedTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  const escapedTitle = title.replace(/"/g, '\\"');
  const tagBlock = normalizedTags.length
    ? `tags: [${normalizedTags.map((tag) => `"${tag.replace(/"/g, '\\"')}"`).join(", ")}]\n`
    : "";

  return `---\ntitle: "${escapedTitle}"\n${tagBlock}---\n\n`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").trim();
}

function getRelativeFolder(notePath: string): string {
  const relative = path.relative(getVaultPath(), path.dirname(notePath));
  return relative || ROOT_FOLDER_LABEL;
}

/**
 * @swagger
 * /api/ai/status:
 *   get:
 *     summary: Get AI availability status
 *     tags: [AI]
 *     security: []
 *     responses:
 *       200:
 *         description: Current AI provider status
 */
router.get("/status", (req: Request, res: Response) => {
  res.json(getAiStatus());
});

/**
 * @swagger
 * /api/ai/note/organize:
 *   post:
 *     summary: Analyze and rewrite a note with Gemini
 *     tags: [AI]
 *     security: []
 */
router.post("/note/organize", async (req: Request, res: Response) => {
  const { error, value } = schemas.organizeNote.validate(req.body);
  if (error) return sendValidationError(res, error);

  try {
    const noteDetails = getNoteDetailsById(value.noteId);
    if (!noteDetails) {
      return res.status(404).json({ error: "Note not found", id: value.noteId });
    }

    const { tree, index } = getVaultData();
    const baseNote = index.get(value.noteId) || {
      id: noteDetails.id,
      name: noteDetails.name,
      path: noteDetails.path,
      links: noteDetails.links,
      linkCount: noteDetails.links.length,
      tags: noteDetails.tags,
      color: noteDetails.color,
      height: Math.max(1, noteDetails.links.length),
      wordCount: noteDetails.wordCount,
      inboundLinks: 0,
    };
    const notes = flattenNotes(tree);
    const relatedNotes = getRelatedNotes(baseNote, notes);
    const availableFolders = buildFolderList(notes);
    const organization = await organizeNoteWithGemini({
      note: {
        id: noteDetails.id,
        name: noteDetails.name,
        path: noteDetails.path,
        folder: getRelativeFolder(noteDetails.path),
        tags: noteDetails.tags,
        links: noteDetails.links,
        wordCount: noteDetails.wordCount,
        content: stripFrontmatter(noteDetails.content),
      },
      relatedNotes,
      availableFolders,
      objective: value.objective || undefined,
    });

    return res.json({
      note: {
        id: noteDetails.id,
        name: noteDetails.name,
        path: noteDetails.path,
        folder: getRelativeFolder(noteDetails.path),
        tags: noteDetails.tags,
        links: noteDetails.links,
        wordCount: noteDetails.wordCount,
      },
      organization,
    });
  } catch (err) {
    return handleAiError(res, err);
  }
});

/**
 * @swagger
 * /api/ai/note/apply:
 *   post:
 *     summary: Apply an AI suggestion to a note
 *     tags: [AI]
 *     security:
 *       - BearerAuth: []
 */
router.post("/note/apply", authMiddleware, (req: Request, res: Response) => {
  const { error, value } = schemas.applyNote.validate(req.body);
  if (error) return sendValidationError(res, error);

  const noteDetails = getNoteDetailsById(value.noteId);
  if (!noteDetails) {
    return res.status(404).json({ error: "Note not found", id: value.noteId });
  }

  const desiredTitle = sanitizeFileName(value.title || noteDetails.name);
  if (!desiredTitle) {
    return res.status(400).json({ error: "Invalid title" });
  }

  const currentDir = path.dirname(noteDetails.path);
  let targetDir = currentDir;
  if (value.folder) {
    if (value.folder === ROOT_FOLDER_LABEL) {
      targetDir = path.resolve(getVaultPath());
    } else {
    const resolvedDir =
      findFolderPathByName(value.folder, getVaultPath()) ||
      path.resolve(getVaultPath(), value.folder);
    const vaultRoot = path.resolve(getVaultPath()) + path.sep;
    const normalizedResolvedDir = path.resolve(resolvedDir);

    if (
      normalizedResolvedDir !== path.resolve(getVaultPath()) &&
      !normalizedResolvedDir.startsWith(vaultRoot)
    ) {
      return res.status(400).json({ error: "Invalid target folder" });
    }

    if (!fs.existsSync(normalizedResolvedDir) || !fs.statSync(normalizedResolvedDir).isDirectory()) {
      return res.status(400).json({
        error: "Target folder does not exist",
        folder: value.folder,
      });
    }

    targetDir = normalizedResolvedDir;
    }
  }

  const targetPath = path.join(targetDir, `${desiredTitle}.md`);
  if (targetPath !== noteDetails.path && fs.existsSync(targetPath)) {
    return res.status(409).json({
      error: "A note with the target title already exists",
      path: targetPath,
    });
  }

  const updatedContent =
    buildFrontmatter(desiredTitle, value.tags || []) + stripFrontmatter(value.content);

  try {
    if (targetPath !== noteDetails.path) {
      fs.renameSync(noteDetails.path, targetPath);
    }

    fs.writeFileSync(targetPath, updatedContent, "utf-8");
    invalidateCache();
    invalidateAiCache();

    return res.json({
      success: true,
      note: {
        id: desiredTitle.toLowerCase().replace(/\s+/g, "-"),
        name: desiredTitle,
        path: targetPath,
        folder: path.relative(getVaultPath(), targetDir) || path.basename(targetDir),
        tags: value.tags || [],
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to apply AI changes",
      message: err instanceof Error ? err.message : "Unknown write error",
    });
  }
});

/**
 * @swagger
 * /api/ai/vault/audit:
 *   post:
 *     summary: Audit the vault with Gemini
 *     tags: [AI]
 *     security: []
 */
router.post("/vault/audit", async (req: Request, res: Response) => {
  const { error, value } = schemas.auditVault.validate(req.body || {});
  if (error) return sendValidationError(res, error);

  try {
    const { tree } = getVaultData();
    const notes = flattenNotes(tree);
    const limitedNotes = notes.slice(0, value.limit).map((note) => {
      let excerpt = "";
      try {
        excerpt = stripFrontmatter(fs.readFileSync(note.path, "utf-8"))
          .replace(/\s+/g, " ")
          .slice(0, 240);
      } catch {}

      return {
        id: note.id,
        name: note.name,
        folder: getRelativeFolder(note.path),
        tags: note.tags || [],
        links: note.links || [],
        inboundLinks: note.inboundLinks || 0,
        wordCount: note.wordCount || 0,
        excerpt,
      };
    });

    const folderMap = new Map<string, number>();
    for (const note of notes) {
      const folder = getRelativeFolder(note.path);
      folderMap.set(folder, (folderMap.get(folder) || 0) + 1);
    }

    const audit = await auditVaultWithGemini({
      vaultName: path.basename(getVaultPath()),
      notes: limitedNotes,
      folders: [...folderMap.entries()]
        .map(([name, noteCount]) => ({ name, noteCount }))
        .sort((a, b) => b.noteCount - a.noteCount),
      totals: {
        totalNotes: notes.length,
        totalFolders: folderMap.size,
        totalLinks: notes.reduce((sum, note) => sum + (note.links?.length || 0), 0),
      },
    });

    return res.json({
      sampleSize: limitedNotes.length,
      audit,
    });
  } catch (err) {
    return handleAiError(res, err);
  }
});

/**
 * @swagger
 * /api/ai/chat:
 *   post:
 *     summary: Ask the vault organizer a question
 *     tags: [AI]
 *     security: []
 */
router.post("/chat", async (req: Request, res: Response) => {
  const { error, value } = schemas.chat.validate(req.body);
  if (error) return sendValidationError(res, error);

  try {
    const { tree, index } = getVaultData();
    const notes = flattenNotes(tree);
    const focusNote = value.noteId ? getNoteDetailsById(value.noteId) : null;
    const baseNote =
      value.noteId && index.get(value.noteId)
        ? index.get(value.noteId)
        : focusNote
          ? {
              id: focusNote.id,
              name: focusNote.name,
              path: focusNote.path,
              links: focusNote.links,
              linkCount: focusNote.links.length,
              tags: focusNote.tags,
              color: focusNote.color,
              height: Math.max(1, focusNote.links.length),
              wordCount: focusNote.wordCount,
              inboundLinks: 0,
            }
          : null;

    const relatedNotes = baseNote
      ? getRelatedNotes(baseNote, notes).map(({ reason, ...note }) => note)
      : notes.slice(0, 12).map((note) => ({
          id: note.id,
          name: note.name,
          folder: getRelativeFolder(note.path),
          tags: note.tags || [],
        }));

    const reply = await chatWithVaultOrganizer({
      question: value.question,
      note: focusNote
        ? {
            id: focusNote.id,
            name: focusNote.name,
            folder: getRelativeFolder(focusNote.path),
            tags: focusNote.tags,
            links: focusNote.links,
            content: stripFrontmatter(focusNote.content),
          }
        : null,
      relatedNotes,
      vaultTotals: {
        totalNotes: notes.length,
        totalFolders: buildFolderList(notes).length,
        totalLinks: notes.reduce((sum, note) => sum + (note.links?.length || 0), 0),
      },
    });

    return res.json(reply);
  } catch (err) {
    return handleAiError(res, err);
  }
});

/**
 * @swagger
 * /api/ai/chat/stream:
 *   post:
 *     summary: Ask the vault organizer with streamed text response
 *     tags: [AI]
 *     security: []
 */
router.post("/chat/stream", async (req: Request, res: Response) => {
  const { error, value } = schemas.chat.validate(req.body);
  if (error) return sendValidationError(res, error);

  try {
    const { tree, index } = getVaultData();
    const notes = flattenNotes(tree);
    const focusNote = value.noteId ? getNoteDetailsById(value.noteId) : null;
    const baseNote =
      value.noteId && index.get(value.noteId)
        ? index.get(value.noteId)
        : focusNote
          ? {
              id: focusNote.id,
              name: focusNote.name,
              path: focusNote.path,
              links: focusNote.links,
              linkCount: focusNote.links.length,
              tags: focusNote.tags,
              color: focusNote.color,
              height: Math.max(1, focusNote.links.length),
              wordCount: focusNote.wordCount,
              inboundLinks: 0,
            }
          : null;

    const relatedNotes = baseNote
      ? getRelatedNotes(baseNote, notes).map(({ reason, ...note }) => note)
      : notes.slice(0, 12).map((note) => ({
          id: note.id,
          name: note.name,
          folder: getRelativeFolder(note.path),
          tags: note.tags || [],
        }));

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let closed = false;
    req.on("aborted", () => {
      closed = true;
    });
    res.on("close", () => {
      closed = true;
    });

    const stream = streamVaultOrganizerChat({
      question: value.question,
      note: focusNote
        ? {
            id: focusNote.id,
            name: focusNote.name,
            folder: getRelativeFolder(focusNote.path),
            tags: focusNote.tags,
            links: focusNote.links,
            content: stripFrontmatter(focusNote.content),
          }
        : null,
      relatedNotes,
      vaultTotals: {
        totalNotes: notes.length,
        totalFolders: buildFolderList(notes).length,
        totalLinks: notes.reduce((sum, note) => sum + (note.links?.length || 0), 0),
      },
    });

    for await (const chunk of stream) {
      if (closed) break;
      res.write(`data: ${JSON.stringify({ type: "chunk", delta: chunk.delta, fullText: chunk.fullText })}\n\n`);
    }

    if (!closed) {
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } else if (!res.writableEnded) {
      res.end();
    }
  } catch (err) {
    if (!res.headersSent) {
      return handleAiError(res, err);
    }
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message: err instanceof Error ? err.message : "Unknown AI error",
      })}\n\n`,
    );
    res.end();
  }
});

router.post("/cache/clear", authMiddleware, (req: Request, res: Response) => {
  invalidateAiCache();
  res.json({ success: true, message: "AI cache cleared" });
});

export default router;
