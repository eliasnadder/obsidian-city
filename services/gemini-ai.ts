import { createHash } from "crypto";
import NodeCache from "node-cache";
import { GoogleGenAI } from "@google/genai";
import { getConfig } from "../config";

export interface RelatedNoteSuggestion {
  noteId: string;
  noteName: string;
  reason: string;
}

export interface NoteOrganizationResult {
  language: string;
  summary: string;
  refinedTitle: string;
  suggestedFolder: string;
  suggestedTags: string[];
  suggestedLinks: RelatedNoteSuggestion[];
  organizationIssues: string[];
  actionItems: string[];
  rewriteMarkdown: string;
}

export interface AuditNoteIssue {
  noteId: string;
  noteName: string;
  folder: string;
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface DuplicateCandidate {
  noteIds: string[];
  noteNames: string[];
  reason: string;
}

export interface FolderSuggestion {
  folder: string;
  issue: string;
  suggestion: string;
}

export interface VaultAuditResult {
  summary: string;
  quickWins: string[];
  missingTags: AuditNoteIssue[];
  orphanNotes: AuditNoteIssue[];
  namingIssues: AuditNoteIssue[];
  duplicateCandidates: DuplicateCandidate[];
  folderSuggestions: FolderSuggestion[];
}

export interface AiChatResult {
  answer: string;
  suggestedActions: string[];
  focusNoteIds: string[];
}

export interface AiChatStreamChunk {
  delta: string;
  fullText: string;
}

export interface GeminiGenerateParams<T> {
  cacheNamespace: string;
  cachePayload: unknown;
  schema: Record<string, unknown>;
  systemInstruction: string;
  prompt: string;
}

class AiDisabledError extends Error {
  constructor(message = "Gemini AI is not configured") {
    super(message);
    this.name = "AiDisabledError";
  }
}

let cachedClient: GoogleGenAI | null = null;
let cachedAiCache: NodeCache | null = null;

type SupportedLanguage = "ar" | "en" | "mixed";

const NOTE_ORGANIZATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: [
    "language",
    "summary",
    "refinedTitle",
    "suggestedFolder",
    "suggestedTags",
    "suggestedLinks",
    "organizationIssues",
    "actionItems",
    "rewriteMarkdown",
  ],
  properties: {
    language: { type: "string" },
    summary: { type: "string" },
    refinedTitle: { type: "string" },
    suggestedFolder: { type: "string" },
    suggestedTags: { type: "array", items: { type: "string" } },
    suggestedLinks: {
      type: "array",
      items: {
        type: "object",
        required: ["noteId", "noteName", "reason"],
        properties: {
          noteId: { type: "string" },
          noteName: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    organizationIssues: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    rewriteMarkdown: { type: "string" },
  },
};

const VAULT_AUDIT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: [
    "summary",
    "quickWins",
    "missingTags",
    "orphanNotes",
    "namingIssues",
    "duplicateCandidates",
    "folderSuggestions",
  ],
  properties: {
    summary: { type: "string" },
    quickWins: { type: "array", items: { type: "string" } },
    missingTags: {
      type: "array",
      items: {
        type: "object",
        required: ["noteId", "noteName", "folder", "reason", "priority"],
        properties: {
          noteId: { type: "string" },
          noteName: { type: "string" },
          folder: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    orphanNotes: {
      type: "array",
      items: {
        type: "object",
        required: ["noteId", "noteName", "folder", "reason", "priority"],
        properties: {
          noteId: { type: "string" },
          noteName: { type: "string" },
          folder: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    namingIssues: {
      type: "array",
      items: {
        type: "object",
        required: ["noteId", "noteName", "folder", "reason", "priority"],
        properties: {
          noteId: { type: "string" },
          noteName: { type: "string" },
          folder: { type: "string" },
          reason: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    duplicateCandidates: {
      type: "array",
      items: {
        type: "object",
        required: ["noteIds", "noteNames", "reason"],
        properties: {
          noteIds: { type: "array", items: { type: "string" } },
          noteNames: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
      },
    },
    folderSuggestions: {
      type: "array",
      items: {
        type: "object",
        required: ["folder", "issue", "suggestion"],
        properties: {
          folder: { type: "string" },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
};

const AI_CHAT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["answer", "suggestedActions", "focusNoteIds"],
  properties: {
    answer: { type: "string" },
    suggestedActions: { type: "array", items: { type: "string" } },
    focusNoteIds: { type: "array", items: { type: "string" } },
  },
};

function getAiCache(): NodeCache {
  if (!cachedAiCache) {
    const config = getConfig();
    cachedAiCache = new NodeCache({
      stdTTL: config.AI_CACHE_TTL,
      checkperiod: 60,
      useClones: false,
    });
  }

  return cachedAiCache;
}

function getClient(): GoogleGenAI {
  const config = getConfig();
  if (!config.AI_FEATURES_ENABLED || !config.GEMINI_API_KEY) {
    throw new AiDisabledError();
  }

  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  }

  return cachedClient;
}

function buildCacheKey(namespace: string, payload: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  return `${namespace}:${hash}`;
}

function cleanStringList(values: unknown, maxItems: number): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleaned = value.trim();
    if (!cleaned || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

function truncateText(input: string, maxChars = 12000): string {
  if (!input || input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n\n[truncated]`;
}

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function detectDominantLanguage(text = ""): SupportedLanguage {
  const sample = String(text || "");
  const rtlCount =
    sample.match(/[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/g)?.length || 0;
  const ltrCount =
    sample.match(/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g)?.length || 0;

  if (rtlCount > 0 && rtlCount >= ltrCount * 1.25) return "ar";
  if (ltrCount > 0 && ltrCount >= rtlCount * 1.25) return "en";
  return "mixed";
}

function buildLanguageStyleGuidance(language: SupportedLanguage, context: "organize" | "audit" | "chat"): string {
  if (language === "ar") {
    if (context === "organize") {
      return [
        "Respond in clear Modern Standard Arabic.",
        "Keep technical names and library names in their original language when that improves clarity.",
        "Prefer strong Arabic section headings and concise, practical wording.",
        "Do not over-translate technical jargon if the note already uses English terms naturally.",
      ].join(" ");
    }
    if (context === "audit") {
      return [
        "Write the audit in Arabic.",
        "Keep each recommendation direct and operational.",
        "Preserve English technical terms such as framework or package names when needed.",
      ].join(" ");
    }
    return [
      "Reply in Arabic.",
      "Keep the answer short, concrete, and action-oriented.",
      "Preserve technical terms in English when that is the natural form used in the note.",
    ].join(" ");
  }

  if (language === "en") {
    if (context === "organize") {
      return [
        "Respond in concise English.",
        "Preserve existing technical terminology.",
        "Prefer stronger headings, cleaner structure, and direct notes-oriented phrasing.",
      ].join(" ");
    }
    if (context === "audit") {
      return [
        "Write the audit in concise English.",
        "Favor specific organizational findings over generic productivity advice.",
      ].join(" ");
    }
    return [
      "Reply in concise English.",
      "Be direct, practical, and specific to the supplied vault context.",
    ].join(" ");
  }

  return [
    "Mirror the dominant language of the user's note or question.",
    "Keep technical terms in their natural original form.",
    "Do not force translation when the source is mixed Arabic and English.",
  ].join(" ");
}

function buildNoteOrganizerSystemInstruction(language: SupportedLanguage): string {
  return [
    "You are an Obsidian vault organizer.",
    "Produce precise suggestions that improve structure, tags, folder placement, and internal linking.",
    "The rewritten markdown must preserve the original facts and avoid fabrication.",
    "Prefer useful titles, meaningful headings, and note structures that are easy to scan later.",
    buildLanguageStyleGuidance(language, "organize"),
  ].join(" ");
}

function buildVaultAuditSystemInstruction(language: SupportedLanguage): string {
  return [
    "You are an Obsidian vault auditor.",
    "Return a focused organization report with actionable priorities.",
    "Prefer high-signal, concrete issues over vague writing advice.",
    buildLanguageStyleGuidance(language, "audit"),
  ].join(" ");
}

function buildVaultChatSystemInstruction(language: SupportedLanguage): string {
  return [
    "You are an AI assistant embedded in an Obsidian organization tool.",
    "Answer only from the provided vault context.",
    "Be practical, direct, and specific.",
    buildLanguageStyleGuidance(language, "chat"),
  ].join(" ");
}

function buildChatPrompt(input: {
  question: string;
  note?: {
    id: string;
    name: string;
    folder: string;
    tags: string[];
    links: string[];
    content: string;
  } | null;
  relatedNotes: Array<{
    id: string;
    name: string;
    folder: string;
    tags: string[];
  }>;
  vaultTotals: {
    totalNotes: number;
    totalFolders: number;
    totalLinks: number;
  };
}): { language: SupportedLanguage; prompt: string } {
  const language = detectDominantLanguage(
    [
      input.question,
      input.note?.name || "",
      input.note?.content || "",
      input.relatedNotes.map((note) => note.name).join("\n"),
    ].join("\n"),
  );

  return {
    language,
    prompt: [
      "Answer the user's vault-organization question using the supplied Obsidian context.",
      "Be practical and specific.",
      "",
      "Question:",
      input.question,
      "",
      "Vault totals:",
      JSON.stringify(input.vaultTotals),
      "",
      "Current note:",
      JSON.stringify(
        input.note
          ? {
              ...input.note,
              content: truncateText(input.note.content, 6000),
            }
          : null,
      ),
      "",
      "Related notes:",
      JSON.stringify(input.relatedNotes),
    ].join("\n"),
  };
}

async function generateStructured<T>({
  cacheNamespace,
  cachePayload,
  schema,
  systemInstruction,
  prompt,
}: GeminiGenerateParams<T>): Promise<T> {
  const cacheKey = buildCacheKey(cacheNamespace, cachePayload);
  const cache = getAiCache();
  const cached = cache.get<T>(cacheKey);
  if (cached) return cached;

  const config = getConfig();
  const client = getClient();
  const response = await client.models.generateContent({
    model: config.GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      thinkingConfig: {
        thinkingBudget: config.GEMINI_THINKING_BUDGET,
      },
    },
  });

  const rawText = typeof response.text === "string" ? response.text.trim() : "";
  if (!rawText) {
    throw new Error("Gemini returned an empty response");
  }

  const parsed = JSON.parse(rawText) as T;
  cache.set(cacheKey, parsed);
  return parsed;
}

export function getAiStatus(): {
  enabled: boolean;
  provider: string;
  model: string | null;
} {
  const config = getConfig();
  return {
    enabled: Boolean(config.AI_FEATURES_ENABLED && config.GEMINI_API_KEY),
    provider: "google-gemini",
    model: config.AI_FEATURES_ENABLED && config.GEMINI_API_KEY ? config.GEMINI_MODEL : null,
  };
}

export function invalidateAiCache(): void {
  getAiCache().flushAll();
}

export async function organizeNoteWithGemini(input: {
  note: {
    id: string;
    name: string;
    path: string;
    folder: string;
    tags: string[];
    links: string[];
    wordCount: number;
    content: string;
  };
  relatedNotes: Array<{
    id: string;
    name: string;
    folder: string;
    tags: string[];
    reason: string;
  }>;
  availableFolders: string[];
  objective?: string;
}): Promise<NoteOrganizationResult> {
  const language = detectDominantLanguage(`${input.note.name}\n${input.note.content}`);
  const prompt = [
    "Organize the following Obsidian note.",
    "Keep the answer in the same dominant language as the note.",
    "Do not invent facts that are not present in the note.",
    "Only suggest links from the provided related notes.",
    "",
    "Organization objective:",
    input.objective || "Improve structure, tags, folder placement, and internal linking.",
    "",
    "Available folders:",
    JSON.stringify(input.availableFolders),
    "",
    "Candidate related notes:",
    JSON.stringify(input.relatedNotes),
    "",
    "Current note metadata:",
    JSON.stringify({
      id: input.note.id,
      name: input.note.name,
      path: input.note.path,
      folder: input.note.folder,
      tags: input.note.tags,
      links: input.note.links,
      wordCount: input.note.wordCount,
    }),
    "",
    "Current note content:",
    truncateText(input.note.content),
  ].join("\n");

  const result = await generateStructured<NoteOrganizationResult>({
    cacheNamespace: "note-organize",
    cachePayload: {
      language,
      objective: input.objective || "",
      note: input.note,
      relatedNotes: input.relatedNotes,
      availableFolders: input.availableFolders,
    },
    schema: NOTE_ORGANIZATION_SCHEMA,
    systemInstruction: buildNoteOrganizerSystemInstruction(language),
    prompt,
  });

  return {
    language: typeof result.language === "string" ? result.language : "unknown",
    summary: typeof result.summary === "string" ? result.summary.trim() : "",
    refinedTitle:
      typeof result.refinedTitle === "string" && result.refinedTitle.trim()
        ? result.refinedTitle.trim()
        : input.note.name,
    suggestedFolder:
      typeof result.suggestedFolder === "string" ? result.suggestedFolder.trim() : "",
    suggestedTags: cleanStringList(result.suggestedTags, 12),
    suggestedLinks: Array.isArray(result.suggestedLinks)
      ? result.suggestedLinks
          .map((item) => ensureObject(item))
          .filter((item) => typeof item.noteId === "string" && typeof item.noteName === "string")
          .slice(0, 8)
          .map((item) => ({
            noteId: String(item.noteId).trim(),
            noteName: String(item.noteName).trim(),
            reason: typeof item.reason === "string" ? item.reason.trim() : "",
          }))
      : [],
    organizationIssues: cleanStringList(result.organizationIssues, 8),
    actionItems: cleanStringList(result.actionItems, 8),
    rewriteMarkdown:
      typeof result.rewriteMarkdown === "string" && result.rewriteMarkdown.trim()
        ? result.rewriteMarkdown
        : input.note.content,
  };
}

export async function auditVaultWithGemini(input: {
  vaultName: string;
  notes: Array<{
    id: string;
    name: string;
    folder: string;
    tags: string[];
    links: string[];
    inboundLinks: number;
    wordCount: number;
    excerpt: string;
  }>;
  folders: Array<{
    name: string;
    noteCount: number;
  }>;
  totals: {
    totalNotes: number;
    totalFolders: number;
    totalLinks: number;
  };
}): Promise<VaultAuditResult> {
  const language = detectDominantLanguage(
    `${input.vaultName}\n${input.notes.map((note) => `${note.name}\n${note.excerpt}`).join("\n")}`,
  );
  const prompt = [
    "Audit this Obsidian vault for organization issues.",
    "Focus on missing tags, orphan notes, weak naming, duplicates, and folder cleanup.",
    "Use only the supplied notes and folders.",
    "",
    "Vault totals:",
    JSON.stringify(input.totals),
    "",
    "Folders:",
    JSON.stringify(input.folders),
    "",
    "Notes:",
    JSON.stringify(input.notes),
  ].join("\n");

  const result = await generateStructured<VaultAuditResult>({
    cacheNamespace: "vault-audit",
    cachePayload: { ...input, language },
    schema: VAULT_AUDIT_SCHEMA,
    systemInstruction: buildVaultAuditSystemInstruction(language),
    prompt,
  });

  return {
    summary: typeof result.summary === "string" ? result.summary.trim() : "",
    quickWins: cleanStringList(result.quickWins, 10),
    missingTags: Array.isArray(result.missingTags)
      ? result.missingTags.map((item) => normalizeAuditNoteIssue(item)).slice(0, 10)
      : [],
    orphanNotes: Array.isArray(result.orphanNotes)
      ? result.orphanNotes.map((item) => normalizeAuditNoteIssue(item)).slice(0, 10)
      : [],
    namingIssues: Array.isArray(result.namingIssues)
      ? result.namingIssues.map((item) => normalizeAuditNoteIssue(item)).slice(0, 10)
      : [],
    duplicateCandidates: Array.isArray(result.duplicateCandidates)
      ? result.duplicateCandidates
          .map((item) => ensureObject(item))
          .slice(0, 10)
          .map((item) => ({
            noteIds: cleanStringList(item.noteIds, 4),
            noteNames: cleanStringList(item.noteNames, 4),
            reason: typeof item.reason === "string" ? item.reason.trim() : "",
          }))
      : [],
    folderSuggestions: Array.isArray(result.folderSuggestions)
      ? result.folderSuggestions
          .map((item) => ensureObject(item))
          .slice(0, 10)
          .map((item) => ({
            folder: typeof item.folder === "string" ? item.folder.trim() : "",
            issue: typeof item.issue === "string" ? item.issue.trim() : "",
            suggestion: typeof item.suggestion === "string" ? item.suggestion.trim() : "",
          }))
      : [],
  };
}

function normalizeAuditNoteIssue(value: unknown): AuditNoteIssue {
  const item = ensureObject(value);
  const priorityValue =
    item.priority === "high" || item.priority === "medium" || item.priority === "low"
      ? item.priority
      : "medium";

  return {
    noteId: typeof item.noteId === "string" ? item.noteId.trim() : "",
    noteName: typeof item.noteName === "string" ? item.noteName.trim() : "",
    folder: typeof item.folder === "string" ? item.folder.trim() : "",
    reason: typeof item.reason === "string" ? item.reason.trim() : "",
    priority: priorityValue,
  };
}

export async function chatWithVaultOrganizer(input: {
  question: string;
  note?: {
    id: string;
    name: string;
    folder: string;
    tags: string[];
    links: string[];
    content: string;
  } | null;
  relatedNotes: Array<{
    id: string;
    name: string;
    folder: string;
    tags: string[];
  }>;
  vaultTotals: {
    totalNotes: number;
    totalFolders: number;
    totalLinks: number;
  };
}): Promise<AiChatResult> {
  const { language, prompt } = buildChatPrompt(input);

  const result = await generateStructured<AiChatResult>({
    cacheNamespace: "vault-chat",
    cachePayload: { ...input, language },
    schema: AI_CHAT_SCHEMA,
    systemInstruction: buildVaultChatSystemInstruction(language),
    prompt,
  });

  return {
    answer: typeof result.answer === "string" ? result.answer.trim() : "",
    suggestedActions: cleanStringList(result.suggestedActions, 8),
    focusNoteIds: cleanStringList(result.focusNoteIds, 8),
  };
}

export async function* streamVaultOrganizerChat(input: {
  question: string;
  note?: {
    id: string;
    name: string;
    folder: string;
    tags: string[];
    links: string[];
    content: string;
  } | null;
  relatedNotes: Array<{
    id: string;
    name: string;
    folder: string;
    tags: string[];
  }>;
  vaultTotals: {
    totalNotes: number;
    totalFolders: number;
    totalLinks: number;
  };
}): AsyncGenerator<AiChatStreamChunk> {
  const { language, prompt } = buildChatPrompt(input);
  const config = getConfig();
  const client = getClient();
  const stream = await client.models.generateContentStream({
    model: config.GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction: buildVaultChatSystemInstruction(language),
      thinkingConfig: {
        thinkingBudget: config.GEMINI_THINKING_BUDGET,
      },
    },
  });

  let fullText = "";
  for await (const chunk of stream) {
    const chunkText = typeof chunk.text === "string" ? chunk.text : "";
    if (!chunkText) continue;

    let delta = "";
    if (chunkText.startsWith(fullText)) {
      delta = chunkText.slice(fullText.length);
      fullText = chunkText;
    } else {
      delta = chunkText;
      fullText += chunkText;
    }

    if (!delta) continue;
    yield { delta, fullText };
  }
}

export { AiDisabledError };
