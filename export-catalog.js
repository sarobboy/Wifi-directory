#!/usr/bin/env node
/**
 * Export router metadata (no passwords) to docs/routers-directory.json for Git.
 */

const fs = require('fs');
const path = require('path');
const { loadRouters } = require('./lib/config');

const OUT = path.join(__dirname, '..', 'docs', 'routers-directory.json');

const routers = loadRouters();
const payload = {
  updatedAt: new Date().toISOString(),
  routers: routers.map((r) => ({
    ssid: r.ssid,
    label: r.label || null,
    location: r.location || null,
    shelf: r.shelf || null,
    notes: r.notes || null,
  })),
};

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(`Wrote ${OUT} (${payload.routers.length} routers, no passwords)`);
console.log('Commit this file so the team page lists all routers.');
