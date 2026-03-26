import request from "supertest";
import express, { Express } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TEST_VAULT = path.join(os.tmpdir(), "test-obsidian-vault-ai");

function createTestVault(): void {
  if (fs.existsSync(TEST_VAULT)) {
    fs.rmSync(TEST_VAULT, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(TEST_VAULT, "TestFolder", "SubFolder"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(TEST_VAULT, "AnotherFolder"), { recursive: true });

  fs.writeFileSync(
    path.join(TEST_VAULT, "TestFolder", "Note1.md"),
    "# Note 1\n#tag1 #tag2\n\nContent with [[Note2]] link",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(TEST_VAULT, "TestFolder", "Note2.md"),
    "# Note 2\n#tag2 #tag3\n\nLinked from [[Note1]]",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(TEST_VAULT, "TestFolder", "SubFolder", "Note3.md"),
    "# Note 3\n#tag3\n\nHas [[Note1]] and [[Note2]] links",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(TEST_VAULT, "AnotherFolder", "Note4.md"),
    "# Note 4\n#tag4\n\nNo links",
    "utf-8",
  );
}

process.env.VAULT_PATH = TEST_VAULT;
process.env.NODE_ENV = "test";
process.env.AI_FEATURES_ENABLED = "true";
process.env.GEMINI_API_KEY = "test-key";
process.env.GEMINI_MODEL = "gemini-2.5-flash";

createTestVault();

jest.mock("../services/gemini-ai", () => ({
  AiDisabledError: class AiDisabledError extends Error {},
  organizeNoteWithGemini: jest.fn(),
  auditVaultWithGemini: jest.fn(),
  chatWithVaultOrganizer: jest.fn(),
  streamVaultOrganizerChat: jest.fn(),
  getAiStatus: jest.fn(() => ({
    enabled: true,
    provider: "google-gemini",
    model: "gemini-2.5-flash",
  })),
  invalidateAiCache: jest.fn(),
}));

import aiRouter from "../routes/ai";
import {
  auditVaultWithGemini,
  chatWithVaultOrganizer,
  organizeNoteWithGemini,
  streamVaultOrganizerChat,
} from "../services/gemini-ai";

describe("AI Organizer API", () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/ai", aiRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_VAULT)) {
      fs.rmSync(TEST_VAULT, { recursive: true, force: true });
    }
  });

  it("returns AI status", async () => {
    const response = await request(app).get("/api/ai/status");

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(response.body.model).toBe("gemini-2.5-flash");
  });

  it("organizes a note with Gemini suggestions", async () => {
    (organizeNoteWithGemini as jest.Mock).mockResolvedValue({
      language: "en",
      summary: "Organized summary",
      refinedTitle: "Better Note 1",
      suggestedFolder: "TestFolder",
      suggestedTags: ["organized", "tag1"],
      suggestedLinks: [
        {
          noteId: "note2",
          noteName: "Note2",
          reason: "Strong shared context",
        },
      ],
      organizationIssues: ["Title is too generic"],
      actionItems: ["Add better headings"],
      rewriteMarkdown: "# Better Note 1\n\nImproved content",
    });

    const response = await request(app)
      .post("/api/ai/note/organize")
      .send({ noteId: "note1" });

    expect(response.status).toBe(200);
    expect(response.body.organization.refinedTitle).toBe("Better Note 1");
    expect(organizeNoteWithGemini).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when organizing an unknown note", async () => {
    const response = await request(app)
      .post("/api/ai/note/organize")
      .send({ noteId: "missing-note" });

    expect(response.status).toBe(404);
  });

  it("returns a vault audit report", async () => {
    (auditVaultWithGemini as jest.Mock).mockResolvedValue({
      summary: "Audit summary",
      quickWins: ["Add tags to note1"],
      missingTags: [],
      orphanNotes: [],
      namingIssues: [],
      duplicateCandidates: [],
      folderSuggestions: [],
    });

    const response = await request(app)
      .post("/api/ai/vault/audit")
      .send({ limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body.audit.summary).toBe("Audit summary");
    expect(auditVaultWithGemini).toHaveBeenCalledTimes(1);
  });

  it("answers vault questions through chat", async () => {
    (chatWithVaultOrganizer as jest.Mock).mockResolvedValue({
      answer: "Move this note into TestFolder and add #tag1.",
      suggestedActions: ["Review headings", "Add tags"],
      focusNoteIds: ["note2"],
    });

    const response = await request(app)
      .post("/api/ai/chat")
      .send({ question: "How should I organize note1?", noteId: "note1" });

    expect(response.status).toBe(200);
    expect(response.body.answer).toContain("Move this note");
    expect(chatWithVaultOrganizer).toHaveBeenCalledTimes(1);
  });

  it("streams vault answers through SSE", async () => {
    async function* mockStream() {
      yield { delta: "First ", fullText: "First " };
      yield { delta: "answer", fullText: "First answer" };
    }

    (streamVaultOrganizerChat as jest.Mock).mockReturnValue(mockStream());

    const response = await request(app)
      .post("/api/ai/chat/stream")
      .send({ question: "Stream this answer", noteId: "note1" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain('"type":"chunk"');
    expect(response.text).toContain('"fullText":"First answer"');
    expect(response.text).toContain('"type":"done"');
  });

  it("applies an AI draft to a note file", async () => {
    const response = await request(app)
      .post("/api/ai/note/apply")
      .send({
        noteId: "note1",
        title: "Note 1 Organized",
        content: "# Better Note 1\n\nRewritten content",
        folder: "TestFolder",
        tags: ["organized", "tag1"],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const updatedPath = path.join(TEST_VAULT, "TestFolder", "Note 1 Organized.md");
    expect(fs.existsSync(updatedPath)).toBe(true);

    const written = fs.readFileSync(updatedPath, "utf-8");
    expect(written).toContain('title: "Note 1 Organized"');
    expect(written).toContain('"organized"');
    expect(written).toContain("# Better Note 1");
  });
});
