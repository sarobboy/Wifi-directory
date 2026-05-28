# Router Network — WiFi Region Scanner

## Add more routers

### Option A — Paste JSON into `wifi-region-scanner/routers.json`

```json
[
  {
    "ssid": "Router-Name",
    "password": "your-wifi-password",
    "label": "Friendly name",
    "location": "Shelf 3, left",
    "shelf": "B12",
    "notes": "US testing"
  }
]
```

### Option B — CSV import (good for 50+ routers)

1. Copy `wifi-region-scanner/routers-import.template.csv`
2. Fill in rows (ssid + password required)
3. Run:

```bash
cd wifi-region-scanner
npm run import -- my-routers.csv
npm run export-catalog
```

4. Commit `docs/routers-directory.json` (no passwords)

---


## Error: `airport ENOENT`

If you see:

```
Error: Wi-Fi scan failed. Ensure Wi-Fi is on and run from Terminal.app.
spawnSync .../airport ENOENT
```

This happens because **Apple removed the old `airport` Wi‑Fi tool** on newer macOS. The scanner has been updated to work without it.

---

## What changed

`npm run detect` no longer needs a Wi‑Fi scan first. It now:

1. Reads all routers from your `routers.json` (e.g. LP, Ash, AsusPTC075)
2. Tries to connect to each one directly
3. Detects the live region from the public IP
4. Skips routers that are **not in range**

---

## Try again (in Terminal.app)

```bash
cd /Users/ptc/Device_Farm/wifi-region-scanner
npm run detect
```

You should see something like:

```
Wi‑Fi scan did not show router names — trying all 3 router(s) from routers.json.
[1/3] LP … Mumbai, Maharashtra, India
[2/3] Ash … not in range
...
```

When it finishes, commit the updated results:

```bash
git add docs/routers-status.json
git commit -m "Update router regions"
git push
```

---

## Notes

- Run from **Terminal.app** (not Cursor) with **Wi‑Fi enabled**
- Routers not nearby will show **not in range** — that’s normal
- Your Mac will briefly switch Wi‑Fi for each router, then restore your previous network
- **`npm run scan`** may show 0 matches on recent macOS because Apple hides Wi‑Fi names — **`detect` still works**

---

## Optional: see Wi‑Fi names in scan

If you want `npm run scan` to list SSIDs by name:

```bash
brew install jaisonerick/tap/macwifi-cli
```

Approve **Location Services** when prompted, then `npm run scan` will show network names.

---

## Related files

| File | Purpose |
|------|---------|
| `wifi-region-scanner/routers.json` | Your SSIDs + passwords (local only, gitignored) |
| `docs/routers-status.json` | Last detected regions (safe to commit) |
| `docs/wifi-region-scanner.html` | Team page (GitHub Pages) |

## Team URL (GitHub Pages)

After enabling Pages from the `/docs` folder:

```
https://<your-org>.github.io/<repo>/wifi-region-scanner.html
```
