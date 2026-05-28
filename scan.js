#!/usr/bin/env node
/**
 * WiFi Region Scanner — macOS
 *
 * Connects to configured office routers and detects the region traffic
 * exits from (via public IP geolocation).
 */

const wifi = require('./lib/wifi-macos');
const { detectRegion, formatRegion } = require('./lib/region-detect');
const { loadRouters } = require('./lib/config');
const { exportStatus } = require('./lib/export-status');

function routerMeta(cfg) {
  return {
    label: cfg.label || null,
    location: cfg.location || null,
    shelf: cfg.shelf || null,
    notes: cfg.notes || null,
  };
}

function resultRow(net, cfg, extra = {}) {
  return { ssid: net.ssid, rssi: net.rssi, ...routerMeta(cfg), ...extra };
}

function printTable(rows) {
  const cols = [
    ['SSID', 28],
    ['Signal', 12],
    ['Region (detected)', 36],
    ['IP', 16],
    ['Status', 14],
  ];

  const line = cols.map(([h, w]) => h.padEnd(w)).join('  ');
  console.log(line);
  console.log('-'.repeat(line.length));

  for (const r of rows) {
    console.log(
      [
        (r.ssid || '').slice(0, 28).padEnd(28),
        (r.signal || '—').padEnd(12),
        (r.region || '—').slice(0, 36).padEnd(36),
        (r.ip || '—').padEnd(16),
        (r.status || '—').padEnd(14),
      ].join('  ')
    );
  }
}

async function cmdScan() {
  const routers = loadRouters();
  const known = new Map(routers.map((r) => [r.ssid, r]));
  const { networks, errors } = wifi.scanNetworks();

  const rows = networks
    .filter((n) => known.has(n.ssid))
    .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999))
    .map((n) => ({
      ssid: n.ssid,
      signal: wifi.formatSignal(n.rssi),
      region: known.get(n.ssid).label || '(run detect)',
      ip: '—',
      status: 'in range',
    }));

  if (rows.length === 0) {
    console.log('No configured routers visible in Wi‑Fi scan.');
    console.log(`Configured: ${routers.length} router(s) in routers.json`);
    console.log(`Nearby networks seen: ${networks.length}`);
    console.log('');
    console.log('On recent macOS, Wi‑Fi names are often hidden from scans.');
    console.log('Run anyway:  npm run detect');
    console.log('Optional:     brew install jaisonerick/tap/macwifi-cli  (shows SSIDs)');
    if (errors.length) console.log('\nScan notes:', errors.slice(0, 2).join('; '));
    return;
  }

  console.log(`Found ${rows.length} configured router(s) in scan:\n`);
  printTable(rows);
  console.log('\nRun: npm run detect   — to connect and detect live regions');
}

async function cmdDetect({ ssidFilter } = {}) {
  const routers = loadRouters();
  const known = new Map(routers.map((r) => [r.ssid, r]));
  const { targets, mode, scannedCount } = wifi.getDetectTargets(routers, { ssidFilter });
  const iface = wifi.getWifiInterface();
  const previous = wifi.getCurrentNetwork(iface);

  if (targets.length === 0) {
    console.log('No routers in routers.json to detect.');
    return;
  }

  console.log(`Wi-Fi interface: ${iface}`);
  if (previous) console.log(`Will restore to: ${previous}`);
  if (mode === 'config') {
    console.log(
      `Wi‑Fi scan did not show router names (${scannedCount} networks seen) — trying all ${targets.length} router(s) from routers.json.`
    );
  } else {
    console.log(`Matched ${targets.length} router(s) from Wi‑Fi scan.`);
  }
  console.log('Connecting to each briefly to detect live region…\n');

  const results = [];

  for (let i = 0; i < targets.length; i++) {
    const net = targets[i];
    const cfg = known.get(net.ssid);
    process.stdout.write(`[${i + 1}/${targets.length}] ${net.ssid} … `);

    try {
      wifi.connect(iface, net.ssid, cfg.password);
      const joined = wifi.waitForNetwork(iface, net.ssid);
      if (!joined) {
        results.push(
          resultRow(net, cfg, {
            signal: wifi.formatSignal(net.rssi),
            region: '—',
            ip: '—',
            status: 'not in range',
          })
        );
        console.log('not in range');
        continue;
      }

      if (!wifi.waitForInternet()) {
        results.push(
          resultRow(net, cfg, {
            signal: wifi.formatSignal(net.rssi),
            region: '—',
            ip: '—',
            status: 'no internet',
          })
        );
        console.log('no internet');
        continue;
      }

      const geo = detectRegion();
      const region = formatRegion(geo);
      results.push(
        resultRow(net, cfg, {
          signal: wifi.formatSignal(net.rssi),
          region,
          ip: geo.ip,
          status: 'ok',
          country: geo.country,
          timezone: geo.timezone,
        })
      );
      console.log(region);
    } catch (e) {
      results.push(
        resultRow(net, cfg, {
          signal: wifi.formatSignal(net.rssi),
          region: '—',
          ip: '—',
          status: e.message.slice(0, 40),
        })
      );
      console.log(`error: ${e.message}`);
    }
  }

  if (previous) {
    process.stdout.write(`\nRestoring previous network (${previous}) … `);
    try {
      const prevCfg = known.get(previous);
      wifi.connect(iface, previous, prevCfg?.password || '');
      console.log('done');
    } catch {
      console.log('manual reconnect may be needed');
    }
  }

  console.log('\nResults:\n');
  printTable(results);

  if (results.length > 0) {
    try {
      const out = exportStatus(results);
      console.log(`\nExported to ${out} — commit and push so team sees updates on GitHub Pages.`);
    } catch (e) {
      console.log(`\nCould not export status file: ${e.message}`);
    }
  }
}

function usage() {
  console.log(`Usage:
  node scan.js scan              List configured routers visible in Wi‑Fi scan
  node scan.js detect            Connect to each router and detect live region
  node scan.js detect --ssid X   Detect only one SSID

  node import-routers.js file.csv   Bulk-add routers from CSV

Setup:
  cp routers.example.json routers.json
  Edit routers.json with your Wi-Fi names and passwords
  Run from Terminal.app (not Cursor) with Wi‑Fi enabled
`);
}

const [,, cmd, ...rest] = process.argv;
const ssidFlag = rest.indexOf('--ssid');
const ssidFilter = ssidFlag >= 0 ? rest[ssidFlag + 1] : null;

if (process.platform !== 'darwin') {
  console.error('This tool currently supports macOS only.');
  process.exit(1);
}

(async () => {
  try {
    if (cmd === 'scan') await cmdScan();
    else if (cmd === 'detect') await cmdDetect({ ssidFilter });
    else usage();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
})();
