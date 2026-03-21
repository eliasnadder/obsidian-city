/**
 * ObsidianCity3D — Vault Parser API v2
 * Route: /api/vault
 * Features: Search, Caching, Input Validation, Pagination
 * 
 * @swagger
 * tags:
 *   - name: Vault
 *     description: Vault operations and data retrieval
 */

import express, { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import Joi from "joi";
import NodeCache from "node-cache";
import { authMiddleware, isJwtEnabled } from "../auth";

const router: Router = express.Router();

const VAULT_PATH: string =
  process.env.VAULT_PATH || path.join(process.env.HOME || "", "obsidian-vault");
const CACHE_TTL: number = parseInt(process.env.CACHE_TTL || "300", 10);

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

function invalidateCache(): void {
  Object.values(CACHE_KEYS).forEach(key => cache.del(key));
}

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface Note {
  id: string;
  name: string;
  path: string;
  links: string[];
  linkCount: number;
  tags: string[];
  color: string;
  height: number;
  wordCount: number;
  inboundLinks?: number;
}

interface FolderNode {
  id: string;
  name: string;
  path: string;
  depth: number;
  notes: Note[];
  subfolders: FolderNode[];
  noteCount: number;
  position?: Position;
  _radius?: number;
}

interface Position {
  x: number;
  z: number;
  y: number;
}

interface SearchResult {
  id: string;
  name: string;
  path: string;
  folder: string;
  tags: string[];
  color: string;
  score: number;
  matchType: string;
  snippet: string;
}

interface CityData extends FolderNode {
  position: Position;
  _radius: number;
}

interface Connection {
  from: string | number;
  to: string | number;
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
      .max(1000000)
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

function extractWikilinks(content: string): string[] {
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  const links = new Set<string>();
  let match;
  while ((match = regex.exec(content)) !== null) {
    const name = path
      .basename(match[1].trim(), path.extname(match[1].trim()))
      .toLowerCase();
    if (name) links.add(name);
  }
  return [...links];
}

function extractTags(content: string): string[] {
  const regex = /#([\w/\-]+)/g;
  const tags = new Set<string>();
  let match;
  while ((match = regex.exec(content)) !== null)
    tags.add(match[1].split("/")[0].toLowerCase());
  return [...tags];
}

interface Frontmatter {
  title: string | null;
  tags: string[];
  aliases: string[];
}

function extractFrontmatter(content: string): Frontmatter {
  const fm: Frontmatter = { title: null, tags: [], aliases: [] };
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return fm;
  const yaml = match[1];
  const titleM = yaml.match(/^title:\s*(.+)$/m);
  if (titleM) fm.title = titleM[1].trim().replace(/^["']|["']$/g, "");
  const tagsBlock = yaml.match(/^tags:\s*([\s\S]*?)(?=^\w|\Z)/m);
  if (tagsBlock) {
    const inline = tagsBlock[1].match(/\[([^\]]+)\]/);
    if (inline) {
      fm.tags = inline[1].split(",").map((t: string) =>
        t
          .trim()
          .replace(/^["']|["']$/g, "")
          .toLowerCase(),
      );
    } else {
      const listItems = tagsBlock[1].match(/^\s*-\s*(.+)$/gm);
      if (listItems)
        fm.tags = listItems.map((t: string) =>
          t
            .replace(/^\s*-\s*/, "")
            .trim()
            .toLowerCase(),
        );
    }
  }
  return fm;
}

const TAG_COLOR_MAP: Record<string, string> = {
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

function getColorForTags(tags: string[]): string {
  for (const tag of tags)
    for (const [key, color] of Object.entries(TAG_COLOR_MAP))
      if (tag.includes(key)) return color;
  return TAG_COLOR_MAP.default;
}

// ── DIRECTORY PARSER ─────────────────────────────────────────────────────────

function parseDirectory(dirPath: string, dirName: string, depth = 0): FolderNode | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return null;
  }

  const notes: Note[] = [];
  const subfolders: FolderNode[] = [];

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

function buildNoteIndex(tree: FolderNode, index = new Map<string, Note>()): Map<string, Note> {
  for (const note of tree.notes || []) {
    index.set(note.id, note);
    const alias = note.name.toLowerCase().replace(/\s+/g, "-");
    if (!index.has(alias)) index.set(alias, note);
  }
  for (const sub of tree.subfolders || []) buildNoteIndex(sub, index);
  return index;
}

function computeInboundLinks(tree: FolderNode, index: Map<string, Note>): void {
  function walk(node: FolderNode): void {
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

function estimateCityRadius(city: FolderNode): number {
  function countNotes(node: FolderNode): number {
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

function assignPositions(cities: FolderNode[]): CityData[] {
  if (!cities.length) return [];

  const radii = cities.map((c) => estimateCityRadius(c));

  const GOLDEN_ANGLE = 2.39996;
  const SCALE = 55;

  const positions: Position[] = cities.map((city, i) => {
    if (i === 0) return { x: 0, z: 0, y: 0 };
    const r = SCALE * Math.sqrt(i);
    const theta = i * GOLDEN_ANGLE;
    return { x: Math.cos(theta) * r, z: Math.sin(theta) * r, y: 0 };
  });

  const ITERATIONS = 80;
  const MIN_MARGIN = 40;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < positions.length; i++) {
      let fx = 0;
      let fz = 0;

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

function buildHighwayConnections(cities: CityData[]): Connection[] {
  if (cities.length < 2) return [];

  const connections = new Set<string>();

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
      const a = cities[u].position;
      const b = cities[v].position;
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
    const a = cities[i].position;
    const b = cities[j].position;
    return Math.hypot(a.x - b.x, a.z - b.z);
  });
  const avgMSTLen =
    mstEdgeLengths.reduce((s, v) => s + v, 0) / (mstEdgeLengths.length || 1);
  const EXTRA_THRESHOLD = avgMSTLen * 1.5;

  for (let i = 0; i < cities.length; i++)
    for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i].position;
      const b = cities[j].position;
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

interface FuzzyMatch {
  score: number;
  match: string;
}

function fuzzyMatch(text: string, pattern: string): FuzzyMatch | null {
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

interface SearchOptions {
  folder?: string | null;
  tags?: string | null;
  limit?: number;
  offset?: number;
}

interface SearchResults {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
}

function searchNotes(tree: FolderNode, query: string, options: SearchOptions = {}): SearchResults {
  const { folder = null, tags = null, limit = 20, offset = 0 } = options;
  const results: SearchResult[] = [];
  const tagFilter = tags ? tags.toLowerCase().split(",").map(t => t.trim()) : [];
  
  function walk(node: FolderNode, folderPath = ""): void {
    const currentFolder = folderPath ? `${folderPath}/${node.name}` : node.name;
    
    for (const note of node.notes || []) {
      // Filter by tags if specified
      if (tagFilter.length > 0) {
        const noteTags = (note.tags || []).map(t => t.toLowerCase());
        const hasMatchingTag = tagFilter.some(t => noteTags.includes(t));
        if (!hasMatchingTag) continue;
      }
      
      // Search in name and content
      const nameMatch = fuzzyMatch(note.name, query);
      let contentMatch: FuzzyMatch | null = null;
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
        
        if (bestMatch) {
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

interface VaultData {
  tree: FolderNode | null;
  index: Map<string, Note>;
  parseTime: number;
}

function getVaultData(): VaultData {
  // Try cache first
  let tree: FolderNode | undefined = cache.get<FolderNode>(CACHE_KEYS.VAULT_DATA);
  let index: Map<string, Note> | undefined = cache.get<Map<string, Note>>(CACHE_KEYS.NOTE_INDEX);
  let parseTime: number | undefined = cache.get<number>("vault:parseTime");
  
  if (!tree) {
    const startTime = Date.now();
    const parsedTree = parseDirectory(VAULT_PATH, path.basename(VAULT_PATH), 0);
    parseTime = Date.now() - startTime;
    
    if (parsedTree) {
      tree = parsedTree;
      index = buildNoteIndex(parsedTree);
      computeInboundLinks(parsedTree, index);
      
      cache.set(CACHE_KEYS.VAULT_DATA, parsedTree);
      cache.set(CACHE_KEYS.NOTE_INDEX, index);
      cache.set("vault:parseTime", parseTime);
    }
  }
  
  return { 
    tree: tree || null, 
    index: index || new Map<string, Note>(), 
    parseTime: parseTime || 0 
  };
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vault:
 *   get:
 *     summary: Get vault data for 3D city visualization
 *     description: Returns the entire vault parsed into a city structure with positions and connections
 *     tags: [Vault]
 *     security: []
 *     responses:
 *       200:
 *         description: Vault data for 3D rendering
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 meta:
 *                   type: object
 *                 cities:
 *                   type: array
 *                 connections:
 *                   type: array
 *                 highwayConnections:
 *                   type: array
 *       404:
 *         description: Vault path not found
 *       500:
 *         description: Server error
 */
router.get("/", (req: Request, res: Response) => {
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

    const connections: Connection[] = [];
    const seen = new Set<string>();
    function collectLinks(node: FolderNode): void {
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
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── SEARCH ENDPOINT (NEW) ────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vault/search:
 *   get:
 *     summary: Search notes in vault
 *     description: Full-text fuzzy search across all notes with pagination support
 *     tags: [Vault]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: folder
 *         schema:
 *           type: string
 *         description: Filter by folder path
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated tags to filter
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Max results to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of results to skip
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SearchResponse'
 *       400:
 *         description: Invalid parameters
 *       404:
 *         description: Vault not found
 */

/**
 * @swagger
 * /api/vault/notes:
 *   get:
 *     summary: Get paginated list of all notes
 *     description: Returns a paginated list of all notes in the vault with optional folder/tag filtering
 *     tags: [Vault]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-indexed)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 500
 *         description: Number of notes per page
 *       - in: query
 *         name: folder
 *         schema:
 *           type: string
 *         description: Filter by folder path
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *         description: Filter by tag
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [name, date, links]
 *           default: name
 *         description: Sort field
 *     responses:
 *       200:
 *         description: Paginated notes list
 *       404:
 *         description: Vault not found
 */
router.get("/notes", (req: Request, res: Response) => {
  // Parse pagination params
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
  const offset = (page - 1) * limit;
  
  // Parse filters
  const folderFilter = req.query.folder as string | undefined;
  const tagFilter = req.query.tag as string | undefined;
  const sortBy = req.query.sort as string || "name";
  
  // Try cache first
  const cacheKey = `vault:notes:${page}:${limit}:${folderFilter || ""}:${tagFilter || ""}:${sortBy}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }
  
  if (!fs.existsSync(VAULT_PATH)) {
    return res.status(404).json({ error: "Vault not found" });
  }
  
  try {
    const { tree, index } = getVaultData();
    if (!tree) return res.status(500).json({ error: "Empty vault" });
    
    // Collect all notes
    const allNotes: any[] = [];
    
    function collectNotes(node: FolderNode, folderPath = ""): void {
      const currentFolder = folderPath ? `${folderPath}/${node.name}` : node.name;
      
      for (const note of node.notes || []) {
        const noteData = {
          id: note.id,
          name: note.name,
          path: note.path,
          folder: currentFolder,
          tags: note.tags,
          color: note.color,
          height: note.height,
          wordCount: note.wordCount,
          linkCount: note.linkCount,
          links: note.links,
          inboundLinks: note.inboundLinks || 0
        };
        
        // Apply filters
        if (folderFilter && currentFolder.toLowerCase() !== folderFilter.toLowerCase()) {
          return;
        }
        if (tagFilter && !note.tags.includes(tagFilter.toLowerCase())) {
          return;
        }
        
        allNotes.push(noteData);
      }
      
      for (const sub of node.subfolders || []) {
        collectNotes(sub, currentFolder);
      }
    }
    
    collectNotes(tree);
    
    // Sort notes
    if (sortBy === "date") {
      allNotes.sort((a, b) => {
        const dateA = fs.existsSync(a.path) ? fs.statSync(a.path).mtime.getTime() : 0;
        const dateB = fs.existsSync(b.path) ? fs.statSync(b.path).mtime.getTime() : 0;
        return dateB - dateA;
      });
    } else if (sortBy === "links") {
      allNotes.sort((a, b) => (b.inboundLinks || 0) - (a.inboundLinks || 0));
    } else {
      allNotes.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    const totalNotes = allNotes.length;
    const totalPages = Math.ceil(totalNotes / limit);
    const paginatedNotes = allNotes.slice(offset, offset + limit);
    
    const result = {
      notes: paginatedNotes,
      total: totalNotes,
      page,
      limit,
      totalPages,
      sort: sortBy,
      filters: {
        folder: folderFilter || null,
        tag: tagFilter || null
      }
    };
    
    cache.set(cacheKey, result, 60); // Cache for 60 seconds
    res.json({ ...result, cached: false });
  } catch (err) {
    console.error("[Notes] Error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/search", (req: Request, res: Response) => {
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
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * @swagger
 * /api/vault/note/{id}:
 *   get:
 *     summary: Get a single note by ID
 *     description: Returns the full content of a note by its ID
 *     tags: [Vault]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Note ID (filename without extension)
 *     responses:
 *       200:
 *         description: Note content
 *       404:
 *         description: Note not found
 */
router.get("/note/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  
  interface NoteInfo {
    path: string;
    name: string;
  }
  
  function findNote(dirPath: string): NoteInfo | null {
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
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/stats", (req: Request, res: Response) => {
  /**
   * @swagger
   * /api/vault/stats:
   *   get:
   *     summary: Get vault statistics
   *     description: Returns aggregated statistics about the vault
   *     tags: [Vault]
   *     security: []
   *     responses:
   *       200:
   *         description: Vault statistics
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Stats'
   *       404:
   *         description: Vault not found
   */
  // Try cache first
  const cached = cache.get(CACHE_KEYS.STATS);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }
  
  if (!fs.existsSync(VAULT_PATH))
    return res.status(404).json({ error: "Vault not found" });
  
  let totalNotes = 0;
  let totalDirs = 0;
  let totalLinks = 0;
  
  function walk(dirPath: string): void {
    let entries: fs.Dirent[];
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

interface FolderInfo {
  name: string;
  path: string;
  relativePath: string;
}

router.get("/folders", (req: Request, res: Response) => {
  /**
   * @swagger
   * /api/vault/folders:
   *   get:
   *     summary: Get list of all folders in vault
   *     description: Returns a flat list of all folders with pagination support
   *     tags: [Vault]
   *     security: []
   *     parameters:
   *       - in: query
   *         name: page
 *         schema:
   *           type: integer
 *           default: 1
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 100
   *     responses:
   *       200:
   *         description: List of folders
   *       404:
   *         description: Vault not found
   */
  const cached = cache.get<{ folders: FolderInfo[]; count: number }>(CACHE_KEYS.FOLDERS);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }
  
  if (!fs.existsSync(VAULT_PATH)) {
    return res.status(404).json({ error: "Vault not found" });
  }
  
  const folders: FolderInfo[] = [];
  
  function walk(dirPath: string, basePath = ""): void {
    let entries: fs.Dirent[];
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

/**
 * @swagger
 * /api/vault/note:
 *   post:
 *     summary: Create a new note
 *     description: Creates a new markdown note in the vault
 *     tags: [Vault]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               folder:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: Note created successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized (if JWT enabled)
 */
router.post("/note", authMiddleware, (req: Request, res: Response) => {
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
      function findDir(base: string): string | null {
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
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── CACHE MANAGEMENT ENDPOINTS ───────────────────────────────────────────────

/**
 * @swagger
 * /api/vault/cache/clear:
 *   post:
 *     summary: Clear the cache
 *     description: Invalidates all cached vault data
 *     tags: [Vault]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared
 *       401:
 *         description: Unauthorized (if JWT enabled)
 */
router.post("/cache/clear", authMiddleware, (req: Request, res: Response) => {
  invalidateCache();
  res.json({ success: true, message: "Cache cleared" });
});

router.get("/cache/status", (req: Request, res: Response) => {
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

export default router;
