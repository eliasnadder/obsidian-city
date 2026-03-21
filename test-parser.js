/**
 * test-parser.js
 * اختبار سريع للـ vault parser — شغّله من terminal:
 * node test-parser.js
 * أو مع vault حقيقي:
 * VAULT_PATH=/path/to/vault node test-parser.js
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ── إنشاء vault وهمي للاختبار ───────────────────────────────────────────────
const TEST_VAULT = path.join(os.tmpdir(), 'test-obsidian-vault');

function createTestVault() {
  const dirs = [
    'المعلوماتية',
    'المعلوماتية/Frontend',
    'الذكاء-الاصطناعي',
    'المشاريع',
  ];
  const notes = [
    ['المعلوماتية/React.md',      '# React\n#frontend #javascript\n\nمرتبط بـ [[TypeScript]] و [[Node.js]] و[[Express]]'],
    ['المعلوماتية/TypeScript.md', '# TypeScript\n#frontend\n\nيُستخدم مع [[React]] و[[Node.js]]'],
    ['المعلوماتية/Node.js.md',    '# Node.js\n#backend\n\nخادم [[Express]] و[[Redis]]'],
    ['المعلوماتية/Frontend/Vue.md','# Vue\n#frontend\n\nbedil [[React]]'],
    ['الذكاء-الاصطناعي/NLP.md',   '# NLP\n#ai #nlp\n\nيشمل [[Transformers]] و[[Arabic NLP]]'],
    ['الذكاء-الاصطناعي/Arabic NLP.md','# Arabic NLP\n#ai #arabic\n\nيعتمد على [[NLP]] و[[Transformers]]'],
    ['المشاريع/SaaS Dashboard.md', '# SaaS Dashboard\n#project\n\nيستخدم [[React]] و[[Node.js]] و[[PostgreSQL]]'],
    ['المشاريع/ObsidianCity.md',   '# ObsidianCity\n#project\n\nيستخدم [[Three.js]] و[[Node.js]]'],
  ];

  fs.mkdirSync(TEST_VAULT, { recursive: true });
  for (const d of dirs) fs.mkdirSync(path.join(TEST_VAULT, d), { recursive: true });
  for (const [rel, content] of notes) {
    fs.writeFileSync(path.join(TEST_VAULT, rel), content, 'utf-8');
  }
  return TEST_VAULT;
}

// ── استيراد الـ parser ────────────────────────────────────────────────────────
process.env.VAULT_PATH = process.env.VAULT_PATH || createTestVault();

// inline mini-parser للاختبار
const { execSync } = require('child_process');

console.log('🏙️  ObsidianCity3D — Vault Parser Test\n');
console.log(`📁  Vault: ${process.env.VAULT_PATH}\n`);

// فحص المسار
if (!fs.existsSync(process.env.VAULT_PATH)) {
  console.error('❌ Vault path not found:', process.env.VAULT_PATH);
  process.exit(1);
}

// استدعاء router مباشرة
const express   = require('express');
const supertest = require('supertest').default || require('supertest');

// بسيط: استدعاء مباشر بدون supertest
const vaultRoute = require('./routes/vault');
const app = express();
app.use('/api/vault', vaultRoute);

// محاكاة request
const server = app.listen(0, () => {
  const port = server.address().port;
  const http = require('http');

  http.get(`http://localhost:${port}/api/vault`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const json = JSON.parse(data);
      console.log('✅ /api/vault responded\n');
      console.log('📊 Meta:');
      console.log(`   - Vault:       ${json.meta?.vaultName}`);
      console.log(`   - Cities:      ${json.meta?.totalCities}`);
      console.log(`   - Notes:       ${json.meta?.totalNotes}`);
      console.log(`   - Connections: ${json.meta?.totalLinks}`);
      console.log('\n🏙️  Cities:');
      for (const city of (json.cities || [])) {
        console.log(`   📂 ${city.name} (${city.notes?.length || 0} notes, ${city.subfolders?.length || 0} subfolders)`);
        for (const note of (city.notes || [])) {
          console.log(`      🏢 ${note.name} | links:${note.linkCount} | tags:[${note.tags.join(',')}] | color:${note.color}`);
        }
      }
      console.log(`\n🔗 Sample connections (first 5):`);
      for (const c of (json.connections || []).slice(0, 5)) {
        console.log(`   ${c.from} → ${c.to}`);
      }
      console.log('\n✅ Test passed!\n');
      server.close();

      // تنظيف vault الاختبار إذا كان مؤقتاً
      if (process.env.VAULT_PATH.startsWith(os.tmpdir())) {
        fs.rmSync(TEST_VAULT, { recursive: true, force: true });
        console.log('🧹 Cleaned up test vault');
      }
    });
  }).on('error', err => {
    console.error('❌ Request failed:', err.message);
    server.close();
  });
});
