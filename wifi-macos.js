const { execSync, execFileSync } = require('child_process');
const fs = require('fs');

const AIRPORT =
  '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) {
    const out = e.stdout?.toString?.() || e.message;
    throw new Error(out || 'Command failed');
  }
}

function tryRun(cmd) {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

function getWifiInterface() {
  const out = run('networksetup -listallhardwareports');
  const blocks = out.split(/\n\n+/);
  for (const block of blocks) {
    if (/Hardware Port: Wi-Fi/i.test(block)) {
      const m = block.match(/Device: (\S+)/);
      if (m) return m[1];
    }
  }
  throw new Error('Wi-Fi interface not found (are you on macOS?)');
}

function getCurrentNetwork(iface) {
  const attempts = [
    () => {
      const out = run(`networksetup -getairportnetwork ${iface}`);
      const m = out.match(/Current Wi-Fi Network: (.+)/);
      return m ? m[1].trim() : null;
    },
    () => {
      const out = tryRun(`ipconfig getsummary ${iface}`);
      if (!out) return null;
      const m = out.match(/ SSID : (.+)/);
      return m ? m[1].trim() : null;
    },
  ];

  for (const fn of attempts) {
    try {
      const ssid = fn();
      if (ssid && ssid !== 'None') return ssid;
    } catch {
      /* next */
    }
  }
  return null;
}

function parseAirportScan(raw) {
  const lines = raw.split('\n').slice(1);
  const networks = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const secMatch = line.match(/\s(WPA[23]?(?:\/[^\s]+)?|WEP|OPEN(?:\/[^\s]+)?|RSN[^\s]*)\s*$/i);
    if (!secMatch) continue;

    const beforeSec = line.slice(0, secMatch.index).trimEnd();
    const parts = beforeSec.split(/\s+/);
    if (parts.length < 4) continue;

    parts.pop(); // channel
    const rssi = parseInt(parts.pop(), 10);
    parts.pop(); // bssid
    const ssid = parts.join(' ').trim();

    if (!ssid || Number.isNaN(rssi) || ssid.includes('deprecated')) continue;
    networks.push({ ssid, bssid: null, rssi, channel: null, source: 'airport' });
  }

  return networks;
}

function scanWithAirport() {
  if (!fs.existsSync(AIRPORT)) return [];
  const raw = execFileSync(AIRPORT, ['-s'], { encoding: 'utf8', timeout: 20000 });
  if (/deprecated|removed in a future release/i.test(raw)) return [];
  return parseAirportScan(raw);
}

function scanWithMacWifiCli() {
  const bin = tryRun('which macwifi-cli');
  if (!bin) return [];

  const raw = execFileSync(bin, ['scan', '--json'], { encoding: 'utf8', timeout: 30000 });
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) return [];

  return list
    .filter((n) => n.ssid)
    .map((n) => ({
      ssid: n.ssid,
      bssid: n.bssid || null,
      rssi: typeof n.rssi === 'number' ? n.rssi : parseInt(n.rssi, 10),
      channel: n.channel || null,
      source: 'macwifi-cli',
    }))
    .filter((n) => !Number.isNaN(n.rssi));
}

function parseSystemProfilerJson(data) {
  const networks = [];
  const root = data?.SPAirPortDataType?.[0]?.spairport_airport_interfaces || [];

  for (const iface of root) {
    const lists = [
      iface.spairport_airport_other_local_wireless_networks,
      iface.spairport_airport_other_networks,
    ].filter(Boolean);

    for (const list of lists) {
      for (const net of list || []) {
        const ssid = net._name;
        if (!ssid || ssid === '<redacted>') continue;

        let rssi = null;
        const sig = net.spairport_signal_noise || '';
        const m = sig.match(/(-?\d+)\s*dBm/);
        if (m) rssi = parseInt(m[1], 10);

        networks.push({
          ssid,
          bssid: null,
          rssi,
          channel: net.spairport_network_channel || null,
          source: 'system_profiler',
        });
      }
    }
  }

  return networks;
}

function scanWithSystemProfiler() {
  const raw = execFileSync('system_profiler', ['SPAirPortDataType', '-json'], {
    encoding: 'utf8',
    timeout: 45000,
  });
  return parseSystemProfilerJson(JSON.parse(raw));
}

function dedupeBySsid(networks) {
  const best = new Map();
  for (const n of networks) {
    const prev = best.get(n.ssid);
    if (!prev || (n.rssi != null && (prev.rssi == null || n.rssi > prev.rssi))) {
      best.set(n.ssid, n);
    }
  }
  return [...best.values()];
}

function scanNetworks() {
  const errors = [];
  const all = [];

  for (const fn of [scanWithMacWifiCli, scanWithAirport, scanWithSystemProfiler]) {
    try {
      const found = fn();
      if (found.length) all.push(...found);
    } catch (e) {
      errors.push(e.message);
    }
  }

  const networks = dedupeBySsid(all);
  return { networks, errors, scanLimited: networks.length === 0 || networks.every((n) => !n.ssid) };
}

/**
 * Pick routers to probe. Uses scan results when SSIDs match; otherwise tries
 * every entry in routers.json (works on macOS 15+ where SSIDs are often hidden).
 */
function getDetectTargets(routers, { ssidFilter } = {}) {
  const { networks: scanned } = scanNetworks();
  const known = new Map(routers.map((r) => [r.ssid, r]));

  let fromScan = scanned.filter((n) => known.has(n.ssid));
  if (ssidFilter) fromScan = fromScan.filter((n) => n.ssid === ssidFilter);

  if (fromScan.length > 0) {
    return {
      targets: fromScan.sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)),
      mode: 'scan',
      scannedCount: scanned.length,
    };
  }

  let fromConfig = routers.map((r) => ({ ssid: r.ssid, rssi: null, bssid: null }));
  if (ssidFilter) {
    fromConfig = fromConfig.filter((r) => r.ssid === ssidFilter);
    if (fromConfig.length === 0) {
      throw new Error(`SSID "${ssidFilter}" not found in routers.json`);
    }
  }

  return {
    targets: fromConfig,
    mode: 'config',
    scannedCount: scanned.length,
  };
}

function formatSignal(rssi) {
  if (rssi == null) return '—';
  const bars = rssi >= -50 ? '████' : rssi >= -60 ? '███░' : rssi >= -70 ? '██░░' : '█░░░';
  return `${bars} ${rssi}dBm`;
}

function connect(iface, ssid, password) {
  const args = ['-setairportnetwork', iface, ssid];
  if (password) args.push(password);
  execFileSync('networksetup', args, { encoding: 'utf8', timeout: 60000 });
}

function waitForNetwork(iface, ssid, maxMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const current = getCurrentNetwork(iface);
    if (current === ssid) return true;
    execSync('sleep 1');
  }
  return false;
}

function waitForInternet(maxMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      execSync('curl -sf --max-time 3 https://1.1.1.1/cdn-cgi/trace > /dev/null', {
        timeout: 5000,
      });
      return true;
    } catch {
      execSync('sleep 1');
    }
  }
  return false;
}

module.exports = {
  getWifiInterface,
  getCurrentNetwork,
  scanNetworks,
  getDetectTargets,
  formatSignal,
  connect,
  waitForNetwork,
  waitForInternet,
};
