/**
 * OpenAPI/Swagger Configuration
 * Auto-generates API documentation from JSDoc comments
 */

import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "ObsidianCity3D API",
      version: "0.2.0",
      description: "Backend API for parsing Obsidian vault into 3D city data",
      contact: {
        name: "API Support"
      }
    },
    servers: [
      {
        url: "http://localhost:3333",
        description: "Development server"
      }
    ],
    tags: [
      {
        name: "Vault",
        description: "Vault operations and data retrieval"
      },
      {
        name: "Health",
        description: "Server health and status"
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Optional JWT token for authenticated endpoints"
        }
      },
      schemas: {
        Note: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            path: { type: "string" },
            links: { type: "array", items: { type: "string" } },
            linkCount: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
            color: { type: "string" },
            height: { type: "number" },
            wordCount: { type: "number" },
            inboundLinks: { type: "number" }
          }
        },
        FolderNode: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            path: { type: "string" },
            depth: { type: "number" },
            notes: { type: "array", items: { $ref: "#/components/schemas/Note" } },
            subfolders: { type: "array", items: { $ref: "#/components/schemas/FolderNode" } },
            noteCount: { type: "number" }
          }
        },
        SearchResult: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            path: { type: "string" },
            folder: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            color: { type: "string" },
            score: { type: "number" },
            matchType: { type: "string" },
            snippet: { type: "string" }
          }
        },
        SearchResponse: {
          type: "object",
          properties: {
            results: { type: "array", items: { $ref: "#/components/schemas/SearchResult" } },
            total: { type: "number" },
            limit: { type: "number" },
            offset: { type: "number" }
          }
        },
        Stats: {
          type: "object",
          properties: {
            totalNotes: { type: "number" },
            totalFolders: { type: "number" },
            totalLinks: { type: "number" },
            totalTags: { type: "number" },
            avgWordCount: { type: "number" },
            topTags: { type: "array", items: { type: "object" } }
          }
        },
        HealthResponse: {
          type: "object",
          properties: {
            status: { type: "string" },
            service: { type: "string" },
            version: { type: "string" },
            vaultPath: { type: "string" },
            vaultExists: { type: "boolean" },
            uptime: { type: "number" },
            memory: { type: "object" },
            timestamp: { type: "string" }
          }
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            message: { type: "string" }
          }
        }
      }
    },
    security: [
      {
        BearerAuth: []
      }
    ]
  },
  apis: ["./routes/*.ts", "./server.ts"]
};

export const swaggerSpec = swaggerJsdoc(options);
