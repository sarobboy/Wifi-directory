const { execSync } = require('child_process');

function fetchJson(url) {
  const raw = execSync(`curl -sf --max-time 10 "${url}"`, {
    encoding: 'utf8',
    timeout: 15000,
  });
  return JSON.parse(raw);
}

/**
 * Detect egress region by public IP geolocation.
 * Tries ip-api.com first (no key), falls back to ipapi.co.
 */
function detectRegion() {
  const providers = [
    {
      url: 'http://ip-api.com/json/?fields=status,country,regionName,city,timezone,query,lat,lon',
      parse: (d) =>
        d.status === 'success'
          ? {
              ip: d.query,
              country: d.country,
              region: d.regionName,
              city: d.city,
              timezone: d.timezone,
              lat: d.lat,
              lon: d.lon,
              provider: 'ip-api.com',
            }
          : null,
    },
    {
      url: 'https://ipapi.co/json/',
      parse: (d) =>
        d.ip
          ? {
              ip: d.ip,
              country: d.country_name,
              region: d.region,
              city: d.city,
              timezone: d.timezone,
              lat: d.latitude,
              lon: d.longitude,
              provider: 'ipapi.co',
            }
          : null,
    },
  ];

  let lastError;
  for (const p of providers) {
    try {
      const data = fetchJson(p.url);
      const result = p.parse(data);
      if (result) return result;
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(`Could not detect region: ${lastError?.message || 'all providers failed'}`);
}

function formatRegion(info) {
  const parts = [info.city, info.region, info.country].filter(Boolean);
  return parts.join(', ');
}

module.exports = { detectRegion, formatRegion };
