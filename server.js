/**
 * Local web UI for WiFi region scanner.
 * Run from Terminal.app (needs Wi-Fi + network access).
 */

const express = require('express');
const path = require('path');
const wifi = require('./lib/wifi-macos');
const { detectRegion, formatRegion } = require('./lib/region-detect');
const { loadRouters } = require('./lib/config');
const { exportStatus } = require('./lib/export-status');

function routerFields(cfg) {
  return {
    label: cfg.label || null,
    location: cfg.location || null,
    shelf: cfg.shelf || null,
    notes: cfg.notes || null,
  };
}

const app = express();
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'ui')));

let detectRunning = false;

app.get('/api/scan', (req, res) => {
  try {
    const routers = loadRouters();
    const known = new Map(routers.map((r) => [r.ssid, r]));
    const { networks } = wifi.scanNetworks();

    const inRange = networks
      .filter((n) => known.has(n.ssid))
      .sort((a, b) => b.rssi - a.rssi)
      .map((n) => ({
        ssid: n.ssid,
        bssid: n.bssid,
        rssi: n.rssi,
        channel: n.channel,
        label: known.get(n.ssid).label || null,
        location: known.get(n.ssid).location || null,
        shelf: known.get(n.ssid).shelf || null,
        notes: known.get(n.ssid).notes || null,
      }));

    res.json({
      ok: true,
      totalScanned: networks.length,
      configured: routers.length,
      inRange,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/detect', async (req, res) => {
  if (detectRunning) {
    return res.status(409).json({ ok: false, error: 'Detection already in progress' });
  }

  detectRunning = true;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const routers = loadRouters();
    const known = new Map(routers.map((r) => [r.ssid, r]));
    const { targets } = wifi.getDetectTargets(routers, { ssidFilter: req.body?.ssid || null });
    const iface = wifi.getWifiInterface();
    const previous = wifi.getCurrentNetwork(iface);

    send('start', { total: targets.length, previous });

    const collected = [];

    for (let i = 0; i < targets.length; i++) {
      const net = targets[i];
      const cfg = known.get(net.ssid);
      send('progress', { index: i + 1, total: targets.length, ssid: net.ssid, phase: 'connecting' });

      const row = { ssid: net.ssid, rssi: net.rssi, ...routerFields(cfg), status: 'pending' };

      try {
        wifi.connect(iface, net.ssid, cfg.password);
        if (!wifi.waitForNetwork(iface, net.ssid)) {
          row.status = 'not_in_range';
          send('result', row);
          collected.push(row);
          continue;
        }

        send('progress', { index: i + 1, total: targets.length, ssid: net.ssid, phase: 'detecting' });

        if (!wifi.waitForInternet()) {
          row.status = 'no_internet';
          send('result', row);
          collected.push(row);
          continue;
        }

        const geo = detectRegion();
        Object.assign(row, {
          status: 'ok',
          ip: geo.ip,
          region: formatRegion(geo),
          country: geo.country,
          timezone: geo.timezone,
          ...routerFields(cfg),
        });
      } catch (e) {
        row.status = 'error';
        row.error = e.message;
      }

      send('result', row);
      collected.push(row);
    }

    if (collected.length > 0) {
      try {
        const out = exportStatus(collected);
        send('exported', { path: out, count: collected.length });
      } catch (e) {
        send('warn', { message: `Could not export status file: ${e.message}` });
      }
    }

    if (previous) {
      send('progress', { phase: 'restoring', ssid: previous });
      try {
        const prevCfg = known.get(previous);
        wifi.connect(iface, previous, prevCfg?.password || '');
      } catch {
        send('warn', { message: `Could not auto-restore ${previous}` });
      }
    }

    send('done', {});
  } catch (e) {
    send('error', { message: e.message });
  } finally {
    detectRunning = false;
    res.end();
  }
});

app.listen(PORT, HOST, () => {
  console.log(`WiFi Region Scanner API: http://localhost:${PORT}`);
  console.log(`Share on office network: http://<this-mac-ip>:${PORT}`);
  console.log('Run from Terminal.app with Wi-Fi enabled.');
});
