/**
 * ObsidianCity3D — Backend Server
 * يشغّل Express + WebSocket لخدمة بيانات vault لـ Three.js
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const chokidar = require("chokidar");

// Config validation
const { initConfig } = require("./config");

// Initialize config (exits on failure)
const config = initConfig();

// Structured logging with Pino
const pino = require("pino");
const logger = pino({
  level: config.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production" 
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined
});

// Rate limiting
const rateLimit = require("express-rate-limit");
const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW || 15 * 60 * 1000, // 15 minutes
  max: config.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later" },
  standardHeaders: true,
  legacyHeaders: false
});

const vaultRouter = require("./routes/vault");

const app = express();
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

// ── HEALTH CHECK (enhanced) ───────────────────────────────────────────────────
const startTime = Date.now();

app.get("/api/health", (req, res) => {
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
const clients = new Set();

wss.on("connection", (ws) => {
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

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// ── VAULT FILE WATCHER — مراقبة التغييرات ──────────────────────────────────
function setupWatcher() {
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

  const debounced = {};
  function debouncedBroadcast(event, filePath) {
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
    .on("add", (f) => debouncedBroadcast("add", f))
    .on("change", (f) => debouncedBroadcast("change", f))
    .on("unlink", (f) => debouncedBroadcast("unlink", f))
    .on("addDir", (d) => broadcast({ type: "vault:newFolder", path: d }))
    .on("unlinkDir", (d) => broadcast({ type: "vault:removeFolder", path: d }))
    .on("error", (e) => logger.error("[Watcher] Error:", e));

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
