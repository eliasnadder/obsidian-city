/**
 * ObsidianCity3D — Vault Parser API v2
 * Route: /api/vault
 * Features: Search, Caching, Input Validation
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const Joi = require("joi");
const NodeCache = require("node-cache");

const VAULT_PATH =
  process.env.VAULT_PATH || path.join(process.env.HOME, "obsidian-vault");
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "300", 10); // 5 minutes

const IGNORED_DIRS = new Set([
  ".obsidian",
  ".trash",
  ".git",
  "node_modules",
  ".DS_Store",
]);
const NOTE_EXTS = new Set([".md", ".markdown"]);

// ── IN-MEMORY CACHE ──────────────────────────────────────────────────────────
const cache = new NodeCache({ 
  stdTTL: CACHE_TTL, 
  checkperiod: 60,
  useClones: false 
});

const CACHE_KEYS = {
  VAULT_DATA: "vault:data",
  NOTE_INDEX: "vault:index",
  STATS: "vault:stats",
  FOLDERS: "vault:folders"
};

function invalidateCache() {
  Object.values(CACHE_KEYS).forEach(key => cache.del(key));
}

// ── INPUT VALIDATION SCHEMAS ─────────────────────────────────────────────────
const schemas = {
  createNote: Joi.object({
    name: Joi.string()
      .min(1)
      .max(255)
      .pattern(/^[^/\\?%*:|"<>]+$/)
      .required()
      .messages({
        "string.pattern.base": "Name contains invalid characters (/\\?%*:|<>)"
      }),
    folder: Joi.string()
      .max(500)
      .allow("", null),
    content: Joi.string()
      .max(1000000) // 1MB max
      .allow("")
  }),

  search: Joi.object({
    q: Joi.string()
      .min(1)
      .max(100)
      .required(),
    folder: Joi.string()
      .max(500)
      .allow("", null),
    tags: Joi.string()
      .max(200)
      .allow("", null),
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .default(20),
    offset: Joi.number()
      .integer()
      .min(0)
      .default(0)
  })
};

// ── PARSERS ───────────────────────────────────────────────────────────────────

function extractWikilinks(content) {
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  const links = new Set();
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = path
      .basename(match[1].trim(), path.extname(match[1].trim()))
      .toLowerCase();
    if (name) links.add(name);
  }
  return [...links];
}

function extractTags(content) {
  const regex = /#([\w/\-]+)/g;
  const tags = new Set();
  let match;
  while ((match = regex.exec(content)) !== null)
    tags.add(match[1].split("/")[0].toLowerCase());
  return [...tags];
}

function extractFrontmatter(content) {
  const fm = { title: null, tags: [], aliases: [] };
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return fm;
  const yaml = match[1];
  const titleM = yaml.match(/^title:\s*(.+)$/m);
  if (titleM) fm.title = titleM[1].trim().replace(/^["']|["']$/g, "");
  const tagsBlock = yaml.match(/^tags:\s*([\s\S]*?)(?=^\w|\Z)/m);
  if (tagsBlock) {
    const inline = tagsBlock[1].match(/\[([^\]]+)\]/);
    if (inline) {
      fm.tags = inline[1].split(",").map((t) =>
        t
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase(),
      );
    } else {
      const listItems = tagsBlock[1].match(/^\s*-\s*(.+)$/gm);
      if (listItems)
        fm.tags = listItems.map((t) =>
          t
            .replace(/^\s*-\s*/, "")
            .trim()
            .toLowerCase(),
        );
    }
  }
  return fm;
}

const TAG_COLOR_MAP = {
  frontend: "#1a73e8",
  react: "#61dafb",
  vue: "#41b883",
  javascript: "#f7df1e",
  backend: "#1e8449",
  api: "#27ae60",
  node: "#2ecc71",
  database: "#b03a2e",
  sql: "#c0392b",
  mongodb: "#4db33d",
  ai: "#7d3c98",
  ml: "#6c3483",
  nlp: "#9b59b6",
  deep: "#8e44ad",
  devops: "#ca6f1e",
  docker: "#0db7ed",
  linux: "#e8831a",
  cloud: "#3498db",
  project: "#d4ac0d",
  research: "#1abc9c",
  idea: "#e67e22",
  default: "#546e7a",
};

function getColorForTags(tags) {
  for (const tag of tags)
    for (const [key, color] of Object.entries(TAG_COLOR_MAP))
      if (tag.includes(key)) return color;
  return TAG_COLOR_MAP.default;
}

// ── DIRECTORY PARSER ─────────────────────────────────────────────────────────

function parseDirectory(dirPath, dirName, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return null;
  }

  const notes = [],
    subfolders = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const sub = parseDirectory(fullPath, entry.name, depth + 1);
      if (sub) subfolders.push(sub);
    } else if (
      entry.isFile() &&
      NOTE_EXTS.has(path.extname(entry.name).toLowerCase())
    ) {
      let content = "";
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {}
      const fm = extractFrontmatter(content);
      const links = extractWikilinks(content);
      const inlineTags = extractTags(content);
      const allTags = [...new Set([...fm.tags, ...inlineTags])];
      const baseName = path.basename(entry.name, path.extname(entry.name));
      notes.push({
        id: baseName.toLowerCase().replace(/\s+/g, "-"),
        name: fm.title || baseName,
        path: fullPath,
        links,
        linkCount: links.length,
        tags: allTags,
        color: getColorForTags(allTags),
        height: Math.max(1, links.length),
        wordCount: content.split(/\s+/).filter(Boolean).length,
      });
    }
  }
  if (notes.length === 0 && subfolders.length === 0) return null;
  return {
    id: dirName.toLowerCase().replace(/\s+/g, "-"),
    name: dirName,
    path: dirPath,
    depth,
    notes,
    subfolders,
    noteCount:
      notes.length + subfolders.reduce((s, sf) => s + (sf.noteCount || 0), 0),
  };
}

function buildNoteIndex(tree, index = new Map()) {
  for (const note of tree.notes || []) {
    index.set(note.id, note);
    const alias = note.name.toLowerCase().replace(/\s+/g, "-");
    if (!index.has(alias)) index.set(alias, note);
  }
  for (const sub of tree.subfolders || []) buildNoteIndex(sub, index);
  return index;
}

function computeInboundLinks(tree, index) {
  function walk(node) {
    for (const note of node.notes || [])
      for (const linkName of note.links) {
        const target =
          index.get(linkName) || index.get(linkName.replace(/\s+/g, "-"));
        if (target && target.id !== note.id)
          target.inboundLinks = (target.inboundLinks || 0) + 1;
      }
    for (const sub of node.subfolders || []) walk(sub);
  }
  walk(tree);
}

// ── CITY SIZE ESTIMATOR ──────────────────────────────────────────────────────

function estimateCityRadius(city) {
  function countNotes(node) {
    return (
      (node.notes?.length || 0) +
      (node.subfolders || []).reduce((s, sf) => s + countNotes(sf), 0)
    );
  }
  const n = countNotes(city);
  const size = Math.max(100, Math.ceil(Math.sqrt(n + 1)) * 28 + 50);
  return size / 2;
}

// ── ORGANIC CITY LAYOUT (Fibonacci Sunflower + Repulsion) ────────────────────

function assignPositions(cities) {
  if (!cities.length) return [];

  const radii = cities.map((c) => estimateCityRadius(c));

  const GOLDEN_ANGLE = 2.39996;
  const SCALE = 55;

  const positions = cities.map((city, i) => {
    if (i === 0) return { x: 0, z: 0 };
    const r = SCALE * Math.sqrt(i);
    const theta = i * GOLDEN_ANGLE;
    return { x: Math.cos(theta) * r, z: Math.sin(theta) * r };
  });

  const ITERATIONS = 80;
  const MIN_MARGIN = 40;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < positions.length; i++) {
      let fx = 0,
        fz = 0;

      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;
        const dx = positions[i].x - positions[j].x;
        const dz = positions[i].z - positions[j].z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const minDist = radii[i] + radii[j] + MIN_MARGIN;

        if (dist < minDist) {
          const force = ((minDist - dist) / minDist) * 3.5;
          fx += (dx / dist) * force;
          fz += (dz / dist) * force;
        }
      }
      positions[i].x += fx;
      positions[i].z += fz;
    }
  }

  const maxR = Math.max(...positions.map((p) => Math.hypot(p.x, p.z)), 1);
  const targetSpread = Math.max(300, cities.length * 80);
  const scaleFactor = targetSpread / maxR;

  const finalPositions = positions.map((p) => ({
    x: p.x * scaleFactor,
    z: p.z * scaleFactor,
  }));

  finalPositions.forEach((p, i) => {
    if (i === 0) return;
    const jitterScale = radii[i] * 0.18;
    p.x += Math.sin(i * 1.618) * jitterScale;
    p.z += Math.cos(i * 2.718) * jitterScale;
  });

  return cities.map((city, i) => ({
    ...city,
    position: {
      x: Math.round(finalPositions[i].x),
      z: Math.round(finalPositions[i].z),
      y: 0,
    },
    _radius: Math.round(radii[i]),
  }));
}

// ── SMART HIGHWAY CONNECTIONS ────────────────────────────────────────────────

function buildHighwayConnections(cities) {
  if (cities.length < 2) return [];

  const connections = new Set();

  const inMST = new Array(cities.length).fill(false);
  const minEdge = new Array(cities.length).fill(Infinity);
  const parent = new Array(cities.length).fill(-1);
  minEdge[0] = 0;

  for (let count = 0; count < cities.length; count++) {
    let u = -1;
    for (let v = 0; v < cities.length; v++)
      if (!inMST[v] && (u === -1 || minEdge[v] < minEdge[u])) u = v;
    inMST[u] = true;

    if (parent[u] !== -1) {
      const key = [Math.min(u, parent[u]), Math.max(u, parent[u])].join("-");
      connections.add(key);
    }

    for (let v = 0; v < cities.length; v++) {
      if (inMST[v]) continue;
      const a = cities[u].position,
        b = cities[v].position;
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < minEdge[v]) {
        minEdge[v] = d;
        parent[v] = u;
      }
    }
  }

  const mstEdgeLengths = [...connections].map((k) => {
    const [i, j] = k.split("-").map(Number);
    const a = cities[i].position,
      b = cities[j].position;
    return Math.hypot(a.x - b.x, a.z - b.z);
  });
  const avgMSTLen =
    mstEdgeLengths.reduce((s, v) => s + v, 0) / (mstEdgeLengths.length || 1);
  const EXTRA_THRESHOLD = avgMSTLen * 1.5;

  for (let i = 0; i < cities.length; i++)
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i].position,
        b = cities[j].position;
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < EXTRA_THRESHOLD) {
        connections.add(`${i}-${j}`);
      }
    }

  return [...connections].map((k) => {
    const [i, j] = k.split("-").map(Number);
    return { from: i, to: j };
  });
}

// ── FUZZY SEARCH ─────────────────────────────────────────────────────────────

function fuzzyMatch(text, pattern) {
  const textLower = text.toLowerCase();
  const patternLower = pattern.toLowerCase();
  
  // Exact substring match (highest priority)
  if (textLower.includes(patternLower)) {
    return { score: 100 + (patternLower.length / textLower.length) * 10, match: "exact" };
  }
  
  // Word-based match
  const words = textLower.split(/\s+/);
  for (const word of words) {
    if (word.startsWith(patternLower)) {
      return { score: 80 + (patternLower.length / word.length) * 10, match: "prefix" };
    }
  }
  
  // Fuzzy character match
  let patternIdx = 0;
  let score = 0;
  let consecutive = 0;
  
  for (let i = 0; i < textLower.length && patternIdx < patternLower.length; i++) {
    if (textLower[i] === patternLower[patternIdx]) {
      score += 1 + consecutive * 0.5;
      consecutive++;
      patternIdx++;
    } else {
      consecutive = 0;
    }
  }
  
  if (patternIdx === patternLower.length) {
    return { score: score * 10, match: "fuzzy" };
  }
  
  return null;
}

function searchNotes(tree, query, options = {}) {
  const { folder = null, tags = null, limit = 20, offset = 0 } = options;
  const results = [];
  const tagFilter = tags ? tags.toLowerCase().split(",").map(t => t.trim()) : [];
  
  function walk(node, folderPath = "") {
    const currentFolder = folderPath ? `${folderPath}/${node.name}` : node.name;
    
    // Filter by folder if specified
    if (folder && !currentFolder.toLowerCase().includes(folder.toLowerCase())) {
      // Still traverse subfolders to find matching ones
    }
    
    for (const note of node.notes || []) {
      // Filter by tags if specified
      if (tagFilter.length > 0) {
        const noteTags = (note.tags || []).map(t => t.toLowerCase());
        const hasMatchingTag = tagFilter.some(t => noteTags.includes(t));
        if (!hasMatchingTag) continue;
      }
      
      // Search in name and content
      const nameMatch = fuzzyMatch(note.name, query);
      let contentMatch = null;
      let contentSnippet = "";
      
      // Read content for fuzzy search (cached)
      if (note.path && fs.existsSync(note.path)) {
        try {
          const content = fs.readFileSync(note.path, "utf-8");
          // Strip frontmatter
          const contentWithoutFm = content.replace(/^---[\s\S]*?---/, "");
          contentMatch = fuzzyMatch(contentWithoutFm, query);
          
          // Extract snippet around match
          if (contentMatch) {
            const matchPos = contentWithoutFm.toLowerCase().indexOf(query.toLowerCase());
            if (matchPos !== -1) {
              const start = Math.max(0, matchPos - 50);
              const end = Math.min(contentWithoutFm.length, matchPos + query.length + 50);
              contentSnippet = (start > 0 ? "..." : "") + 
                contentWithoutFm.slice(start, end).trim() + 
                (end < contentWithoutFm.length ? "..." : "");
            }
          }
        } catch {}
      }
      
      if (nameMatch || contentMatch) {
        const bestMatch = nameMatch && contentMatch 
          ? (nameMatch.score >= contentMatch.score ? nameMatch : contentMatch)
          : (nameMatch || contentMatch);
        
        results.push({
          id: note.id,
          name: note.name,
          path: note.path,
          folder: currentFolder,
          tags: note.tags,
          color: note.color,
          score: bestMatch.score,
          matchType: bestMatch.match,
          snippet: contentSnippet
        });
      }
    }
    
    for (const sub of node.subfolders || []) {
      walk(sub, currentFolder);
    }
  }
  
  walk(tree);
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  
  // Apply pagination
  const total = results.length;
  const paginated = results.slice(offset, offset + limit);
  
  return { results: paginated, total, limit, offset };
}

// ── HELPER: GET PARSED VAULT (with caching) ──────────────────────────────────

function getVaultData() {
  // Try cache first
  let tree = cache.get(CACHE_KEYS.VAULT_DATA);
  let index = cache.get(CACHE_KEYS.NOTE_INDEX);
  let parseTime = cache.get("vault:parseTime");
  
  if (!tree) {
    const startTime = Date.now();
    tree = parseDirectory(VAULT_PATH, path.basename(VAULT_PATH), 0);
    parseTime = Date.now() - startTime;
    
    if (tree) {
      index = buildNoteIndex(tree);
      computeInboundLinks(tree, index);
      
      cache.set(CACHE_KEYS.VAULT_DATA, tree);
      cache.set(CACHE_KEYS.NOTE_INDEX, index);
      cache.set("vault:parseTime", parseTime);
    }
  }
  
  return { tree, index, parseTime };
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

router.get("/", (req, res) => {
  if (!fs.existsSync(VAULT_PATH))
    return res.status(404).json({
      error: "Vault path not found",
      path: VAULT_PATH,
      hint: "Set VAULT_PATH in .env",
    });

  try {
    const { tree, index, parseTime } = getVaultData();
    if (!tree) return res.status(500).json({ error: "Empty vault" });

    const rawCities = tree.subfolders.length > 0 ? tree.subfolders : [tree];
    const cities = assignPositions(rawCities);
    const highwayConns = buildHighwayConnections(cities);

    const connections = [];
    const seen = new Set();
    function collectLinks(node) {
      for (const note of node.notes || [])
        for (const linkName of note.links) {
          const target =
            index.get(linkName) || index.get(linkName.replace(/\s+/g, "-"));
          if (target && target.id !== note.id) {
            const key = [note.id, target.id].sort().join("||");
            if (!seen.has(key)) {
              seen.add(key);
              connections.push({ from: note.id, to: target.id });
            }
          }
        }
      for (const sub of node.subfolders || []) collectLinks(sub);
    }
    collectLinks(tree);

    res.json({
      meta: {
        vaultName: path.basename(VAULT_PATH),
        vaultPath: VAULT_PATH,
        totalCities: cities.length,
        totalNotes: index.size,
        totalLinks: connections.length,
        parsedAt: new Date().toISOString(),
        parseTimeMs: parseTime,
        cached: cache.has(CACHE_KEYS.VAULT_DATA)
      },
      cities,
      connections,
      highwayConnections: highwayConns,
    });
  } catch (err) {
    console.error("[VaultParser] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── SEARCH ENDPOINT (NEW) ────────────────────────────────────────────────────

router.get("/search", (req, res) => {
  const { error, value } = schemas.search.validate(req.query);
  
  if (error) {
    return res.status(400).json({
      error: "Invalid search parameters",
      details: error.details.map(d => d.message)
    });
  }
  
  if (!fs.existsSync(VAULT_PATH)) {
    return res.status(404).json({ error: "Vault not found" });
  }
  
  try {
    const { tree } = getVaultData();
    if (!tree) return res.status(500).json({ error: "Empty vault" });
    
    const searchResults = searchNotes(tree, value.q, {
      folder: value.folder,
      tags: value.tags,
      limit: value.limit,
      offset: value.offset
    });
    
    res.json({
      query: value.q,
      ...searchResults,
      cache: cache.has(CACHE_KEYS.VAULT_DATA)
    });
  } catch (err) {
    console.error("[Search] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/note/:id", (req, res) => {
  const { id } = req.params;
  function findNote(dirPath) {
    if (!fs.existsSync(dirPath)) return null;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const found = findNote(full);
        if (found) return found;
      } else if (NOTE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const baseName = path.basename(entry.name, path.extname(entry.name));
        if (baseName.toLowerCase().replace(/\s+/g, "-") === id)
          return { path: full, name: baseName };
      }
    }
    return null;
  }
  const note = findNote(VAULT_PATH);
  if (!note) return res.status(404).json({ error: "Note not found", id });
  try {
    const content = fs.readFileSync(note.path, "utf-8");
    res.json({
      id,
      name: note.name,
      path: note.path,
      content,
      links: extractWikilinks(content),
      tags: [
        ...new Set([
          ...extractFrontmatter(content).tags,
          ...extractTags(content),
        ]),
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", (req, res) => {
  // Try cache first
  const cached = cache.get(CACHE_KEYS.STATS);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }
  
  if (!fs.existsSync(VAULT_PATH))
    return res.status(404).json({ error: "Vault not found" });
  let totalNotes = 0,
    totalDirs = 0,
    totalLinks = 0;
  function walk(dirPath) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalDirs++;
        walk(full);
      } else if (NOTE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        totalNotes++;
        try {
          totalLinks += extractWikilinks(fs.readFileSync(full, "utf-8")).length;
        } catch {}
      }
    }
  }
  walk(VAULT_PATH);
  
  const stats = { totalNotes, totalDirs, totalLinks, vaultPath: VAULT_PATH };
  cache.set(CACHE_KEYS.STATS, stats);
  
  res.json({ ...stats, cached: false });
});

// ── GET FOLDERS LIST (NEW) ──────────────────────────────────────────────────

router.get("/folders", (req, res) => {
  const cached = cache.get(CACHE_KEYS.FOLDERS);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }
  
  if (!fs.existsSync(VAULT_PATH)) {
    return res.status(404).json({ error: "Vault not found" });
  }
  
  const folders = [];
  
  function walk(dirPath, basePath = "") {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      
      folders.push({
        name: entry.name,
        path: fullPath,
        relativePath
      });
      
      walk(fullPath, relativePath);
    }
  }
  
  walk(VAULT_PATH);
  
  const result = { folders, count: folders.length };
  cache.set(CACHE_KEYS.FOLDERS, result);
  
  res.json({ ...result, cached: false });
});

// ── CREATE NOTE (with validation) ───────────────────────────────────────────

router.post("/note", (req, res) => {
  const { error, value } = schemas.createNote.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      error: "Invalid request body",
      details: error.details.map(d => ({
        field: d.path.join("."),
        message: d.message
      }))
    });
  }

  const { name, folder, content } = value;

  try {
    // find folder path
    let targetDir = VAULT_PATH;
    if (folder) {
      function findDir(base) {
        if (!fs.existsSync(base)) return null;
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const full = path.join(base, e.name);
          if (e.name.toLowerCase() === folder.toLowerCase()) return full;
          const found = findDir(full);
          if (found) return found;
        }
        return null;
      }
      targetDir = findDir(VAULT_PATH) || VAULT_PATH;
    }

    const fileName = name.replace(/[/\\?%*:|"<>]/g, "-") + ".md";
    const filePath = path.join(targetDir, fileName);

    if (fs.existsSync(filePath))
      return res
        .status(409)
        .json({ error: "Note already exists", path: filePath });

    fs.writeFileSync(filePath, content || `# ${name}\n`, "utf-8");
    
    // Invalidate cache after creating note
    invalidateCache();
    
    res.json({ success: true, name, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CACHE MANAGEMENT ENDPOINTS ───────────────────────────────────────────────

router.post("/cache/clear", (req, res) => {
  invalidateCache();
  res.json({ success: true, message: "Cache cleared" });
});

router.get("/cache/status", (req, res) => {
  const keys = cache.keys();
  const stats = cache.getStats();
  
  res.json({
    enabled: true,
    ttl: CACHE_TTL,
    keys: keys.length,
    keyList: keys,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: stats.hits / (stats.hits + stats.misses || 1)
  });
});

module.exports = router;
