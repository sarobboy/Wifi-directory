#!/usr/bin/env bash
# Start scanner API for the team (office Mac). Run from Terminal.app.
set -euo pipefail
cd "$(dirname "$0")"
npm install --silent 2>/dev/null || npm install
echo ""
echo "Starting WiFi Region Scanner on port ${PORT:-3002}…"
echo "Team page (after GitHub Pages): docs/wifi-region-scanner.html"
echo "Live API: http://$(ipconfig getifaddr en0 2>/dev/null || echo 'YOUR-MAC-IP'):${PORT:-3002}"
echo ""
exec node server.js
