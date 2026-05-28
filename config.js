const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'routers.json');
const EXAMPLE_PATH = path.join(__dirname, '..', 'routers.example.json');

function loadRouters() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Missing routers.json — copy routers.example.json to routers.json and add your SSIDs/passwords.\n` +
        `  cp "${EXAMPLE_PATH}" "${CONFIG_PATH}"`
    );
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  let routers;
  try {
    routers = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid routers.json: ${e.message}`);
  }

  if (!Array.isArray(routers) || routers.length === 0) {
    throw new Error('routers.json must be a non-empty array of { ssid, password } objects');
  }

  for (const r of routers) {
    if (!r.ssid || !r.password) {
      throw new Error(`Each router needs ssid and password. Bad entry: ${JSON.stringify(r)}`);
    }
  }

  return routers;
}

module.exports = { loadRouters, CONFIG_PATH };
