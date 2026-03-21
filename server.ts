/**
 * ObsidianCity3D — Backend Server
 * يشغّل Express + WebSocket لخدمة بيانات vault لـ Three.js
 */

import * as dotenv from "dotenv";
dotenv.config();
import express, { Express, Request, Response } from "express";
import http from "http";
import WebSocket from "ws";
import cors from "cors";
import * as path from "path";
import * as fs from "fs";
import chokidar from "chokidar";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";

// Config validation
import { initConfig } from "./config";

// Initialize config (exits on failure)
const config = initConfig();

// Structured logging with Pino
import pino from "pino";
const logger = pino({
  level: config.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production" 
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined
});

// Rate limiting
import rateLimit from "express-rate-limit";
const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW || 15 * 60 * 1000,
  max: config.RATE_LIMIT_MAX || 100,
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false
});

import vaultRouter from "./routes/vault";

const app: Express = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = config.OBSIDIAN_CITY_PORT || 3333;
const VAULT_PATH = config.VAULT_PATH;

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());

// Rate limiting for API routes
app.use("/api", apiLimiter);

// ── STATIC FILES (frontend) ───────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── API ROUTES ─────────────────────────────────────────────────────────────────
app.use("/api/vault", vaultRouter);

// ── SWAGGER DOCS ─────────────────────────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/api/swagger.json", (req: Request, res: Response) => {
  res.json(swaggerSpec);
});

// ── HEALTH CHECK (enhanced) ───────────────────────────────────────────────────
const startTime = Date.now();

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns server health status, uptime, and memory usage
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
app.get("/api/health", (req: Request, res: Response) => {
  const memUsage = process.memoryUsage();
  
  res.json({
    status: "ok",
    service: "ObsidianCity3D Backend",
    version: "0.2.0",
    vaultPath: VAULT_PATH,
    vaultExists: fs.existsSync(VAULT_PATH),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + " MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + " MB",
      rss: Math.round(memUsage.rss / 1024 / 1024) + " MB"
    },
    timestamp: new Date().toISOString(),
  });
});

// ── WEBSOCKET — إشعارات التغيير الفوري ──────────────────────────────────────
const clients = new Set<WebSocket>();

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  logger.info(`[WS] Client connected. Total: ${clients.size}`);

  ws.send(
    JSON.stringify({ type: "connected", message: "ObsidianCity3D ready" }),
  );

  ws.on("close", () => {
    clients.delete(ws);
    logger.info(`[WS] Client disconnected. Total: ${clients.size}`);
  });
});

function broadcast(data: Record<string, unknown>): void {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// ── VAULT FILE WATCHER — مراقبة التغييرات ──────────────────────────────────
function setupWatcher(): void {
  if (!fs.existsSync(VAULT_PATH)) {
    logger.warn(`[Watcher] Vault not found at: ${VAULT_PATH}`);
    logger.warn("[Watcher] Set VAULT_PATH in .env and restart");
    return;
  }

  const watcher = chokidar.watch(VAULT_PATH, {
    ignored: /(^|[/\\])\.obsidian|\.git|node_modules/,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 },
  });

  const debounced: Record<string, NodeJS.Timeout> = {};
  function debouncedBroadcast(event: string, filePath: string): void {
    clearTimeout(debounced[filePath]);
    debounced[filePath] = setTimeout(() => {
      const noteId = path
        .basename(filePath, path.extname(filePath))
        .toLowerCase()
        .replace(/\s+/g, "-");
      logger.info(`[Watcher] ${event}: ${path.basename(filePath)}`);
      broadcast({
        type: "vault:change",
        event,
        noteId,
        filePath,
        timestamp: Date.now(),
      });
      delete debounced[filePath];
    }, 700);
  }

  watcher
    .on("add", (f: string) => debouncedBroadcast("add", f))
    .on("change", (f: string) => debouncedBroadcast("change", f))
    .on("unlink", (f: string) => debouncedBroadcast("unlink", f))
    .on("addDir", (d: string) => broadcast({ type: "vault:newFolder", path: d }))
    .on("unlinkDir", (d: string) => broadcast({ type: "vault:removeFolder", path: d }))
    .on("error", (e: Error) => logger.error(e, "[Watcher] Error"));

  logger.info(`[Watcher] Watching: ${VAULT_PATH}`);
}

setupWatcher();

// ── START ──────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  logger.info(`\n🏙️  ObsidianCity3D Backend running on http://localhost:${PORT}`);
  logger.info(`📁  Vault: ${VAULT_PATH}`);
  logger.info(`🔌  WebSocket: ws://localhost:${PORT}`);
  logger.info(`📡  API: http://localhost:${PORT}/api/vault`);
  logger.info(`🛡️  Rate Limit: ${config.RATE_LIMIT_MAX} req/${config.RATE_LIMIT_WINDOW / 60000}min\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully...");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});
