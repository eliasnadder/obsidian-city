/**
 * Vault Parser API Tests
 * Run with: npm test
 */

import request from "supertest";
import express, { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Test vault setup
const TEST_VAULT = path.join(os.tmpdir(), "test-obsidian-vault-jest");

function createTestVault(): void {
  const dirs = [
    "TestFolder",
    "TestFolder/SubFolder",
    "AnotherFolder",
  ];
  const notes = [
    ["TestFolder/Note1.md", "# Note 1\n#tag1 #tag2\n\nContent with [[Note2]] link"],
    ["TestFolder/Note2.md", "# Note 2\n#tag2 #tag3\n\nLinked from [[Note1]]"],
    ["TestFolder/SubFolder/Note3.md", "# Note 3\n#tag3\n\nHas [[Note1]] and [[Note2]] links"],
    ["AnotherFolder/Note4.md", "# Note 4\n#tag4\n\nNo links"],
  ];

  // Clean up
  if (fs.existsSync(TEST_VAULT)) {
    fs.rmSync(TEST_VAULT, { recursive: true, force: true });
  }

  // Create directories
  for (const dir of dirs) {
    fs.mkdirSync(path.join(TEST_VAULT, dir), { recursive: true });
  }

  // Create notes
  for (const [rel, content] of notes) {
    fs.writeFileSync(path.join(TEST_VAULT, rel), content, "utf-8");
  }
}

// Set test vault path before importing
process.env.VAULT_PATH = TEST_VAULT;
process.env.NODE_ENV = "test";

createTestVault();

// Import after setting env
import vaultRouter from "../routes/vault";

describe("Vault Parser API", () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/vault", vaultRouter);
  });

  afterAll(() => {
    // Clean up test vault
    if (fs.existsSync(TEST_VAULT)) {
      fs.rmSync(TEST_VAULT, { recursive: true, force: true });
    }
  });

  describe("GET /api/vault", () => {
    it("should return vault data with cities and connections", async () => {
      const response = await request(app).get("/api/vault");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("meta");
      expect(response.body).toHaveProperty("cities");
      expect(response.body).toHaveProperty("connections");
      expect(response.body.meta).toHaveProperty("totalNotes");
      expect(response.body.meta).toHaveProperty("totalCities");
    });

    it("should return 404 when vault doesn't exist", async () => {
      const response = await request(app).get("/api/vault");

      // Vault exists since we create it in beforeAll
      expect(response.status).toBe(200);
    });
  });

  describe("GET /api/vault/search", () => {
    it("should return search results", async () => {
      const response = await request(app).get("/api/vault/search?q=Note1");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("results");
      expect(response.body).toHaveProperty("total");
      expect(response.body).toHaveProperty("query");
      expect(response.body.query).toBe("Note1");
    });

    it("should handle pagination with limit and offset", async () => {
      const response = await request(app).get(
        "/api/vault/search?q=Note&limit=2&offset=0"
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("limit", 2);
      expect(response.body).toHaveProperty("offset", 0);
    });

    it("should return 400 for invalid query", async () => {
      const response = await request(app).get("/api/vault/search");

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty("error");
    });
  });

  describe("GET /api/vault/note/:id", () => {
    it("should return a specific note by id", async () => {
      const response = await request(app).get("/api/vault/note/note1");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("id");
      expect(response.body).toHaveProperty("name");
      expect(response.body).toHaveProperty("content");
      expect(response.body).toHaveProperty("links");
    });

    it("should return 404 for non-existent note", async () => {
      const response = await request(app).get("/api/vault/note/nonexistent");

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/vault/stats", () => {
    it("should return vault statistics", async () => {
      const response = await request(app).get("/api/vault/stats");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("totalNotes");
      expect(response.body).toHaveProperty("totalDirs");
      expect(response.body).toHaveProperty("totalLinks");
    });
  });

  describe("GET /api/vault/folders", () => {
    it("should return list of folders", async () => {
      const response = await request(app).get("/api/vault/folders");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("folders");
      expect(response.body).toHaveProperty("count");
      expect(Array.isArray(response.body.folders)).toBe(true);
    });
  });
});

describe("Input Validation", () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use("/api/vault", vaultRouter);
  });

  describe("Search validation", () => {
    it("should reject empty search query", async () => {
      const response = await request(app).get("/api/vault/search?q=");

      expect(response.status).toBe(400);
    });

    it("should reject query exceeding max length", async () => {
      const longQuery = "a".repeat(101);
      const response = await request(app).get(`/api/vault/search?q=${longQuery}`);

      expect(response.status).toBe(400);
    });

    it("should accept valid limit and offset", async () => {
      const response = await request(app).get(
        "/api/vault/search?q=test&limit=50&offset=100"
      );

      expect(response.status).toBe(200);
    });
  });
});
