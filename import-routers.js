#!/usr/bin/env node
/**
 * Import routers from CSV into routers.json (merge by SSID).
 *
 * Usage:
 *   node import-routers.js routers-import.csv
 *   node import-routers.js ../my-routers.csv
 */

const fs = require('fs');
const path = require('path');
const { CONFIG_PATH } = require('./lib/config');

const OPTIONAL = ['label', 'location', 'shelf', 'notes'];

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row');

  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const ssidIdx = headers.indexOf('ssid');
  const passIdx = headers.indexOf('password');
  if (ssidIdx < 0) throw new Error('CSV must have an "ssid" column');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => {
      row[h] = (cols[j] ?? '').trim();
    });
    if (!row.ssid) continue;
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function csvRowToRouter(row) {
  const router = {
    ssid: row.ssid,
    password: row.password || '',
  };
  for (const key of OPTIONAL) {
    if (row[key]) router[key] = row[key];
  }
  return router;
}

function mergeRouters(existing, incoming) {
  const map = new Map(existing.map((r) => [r.ssid, { ...r }]));
  let added = 0;
  let updated = 0;

  for (const r of incoming) {
    if (!r.password) {
      console.warn(`  skip "${r.ssid}" — missing password`);
      continue;
    }
    if (map.has(r.ssid)) {
      map.set(r.ssid, { ...map.get(r.ssid), ...r });
      updated++;
    } else {
      map.set(r.ssid, r);
      added++;
    }
  }

  return { routers: [...map.values()], added, updated };
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.log(`Usage: node import-routers.js <file.csv>

Columns: ssid, password (required), label, location, shelf, notes (optional)
Template: routers-import.template.csv
`);
    process.exit(1);
  }

  const abs = path.resolve(csvPath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const incoming = parseCsv(fs.readFileSync(abs, 'utf8')).map(csvRowToRouter);
  let existing = [];
  if (fs.existsSync(CONFIG_PATH)) {
    existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }

  const { routers, added, updated } = mergeRouters(existing, incoming);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(routers, null, 2) + '\n');
  console.log(`Updated ${CONFIG_PATH}`);
  console.log(`  ${added} added, ${updated} updated, ${routers.length} total`);
}

main();
