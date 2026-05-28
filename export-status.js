const fs = require('fs');
const path = require('path');

const STATUS_PATH = path.join(__dirname, '..', '..', 'docs', 'routers-status.json');

function exportStatus(results, meta = {}) {
  const payload = {
    updatedAt: new Date().toISOString(),
    updatedBy: meta.updatedBy || osHostname(),
    routers: results.map((r) => ({
      ssid: r.ssid,
      label: r.label || null,
      location: r.location || null,
      shelf: r.shelf || null,
      notes: r.notes || null,
      region: r.region || null,
      ip: r.ip || null,
      rssi: r.rssi ?? null,
      country: r.country || null,
      timezone: r.timezone || null,
      status: r.status || 'unknown',
    })),
  };

  fs.writeFileSync(STATUS_PATH, JSON.stringify(payload, null, 2) + '\n');
  return STATUS_PATH;
}

function osHostname() {
  try {
    return require('os').hostname();
  } catch {
    return 'unknown';
  }
}

module.exports = { exportStatus, STATUS_PATH };
