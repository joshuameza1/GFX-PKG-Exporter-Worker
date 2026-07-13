# GFX PKG Exporter

After Effects render worker with an Electron UI. Connects to the GFX PKG Exporter Slack app, queues render jobs, and manages template packages.

## Development

```bash
npm install
cp .env.example .env   # edit with your paths and server URL
npm run dev
```

## First install on a Mac (DMG)

1. Download the latest `.dmg` from [GitHub Releases](https://github.com/joshuameza1/GFX-PKG-Exporter-Worker/releases).
2. Drag **GFX PKG Exporter** into Applications.
3. On first launch, the app creates a config file at:
   `~/Library/Application Support/GFX PKG Exporter/.env`
4. Edit that `.env` with the machine's watch folder, render folder, socket URL, and AE path.
5. Restart the app.

Local config, job history, and template packages are stored outside the app bundle and are preserved across updates.

## Releasing a new version

1. Bump `version` in `package.json` (e.g. `1.0.0` → `1.0.1`).
2. Commit and push to `main`.
3. Create and push a version tag:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions builds a signed universal Mac `.dmg` + `.zip`, notarizes it, and publishes to GitHub Releases. Installed apps check for updates on launch and via **Settings → Check for updates**.

## Building locally (signed DMG)

Export your Developer ID certificate and notarization credentials, then:

```bash
npm install
cp electron/github-token.js.example electron/github-token.js
# Paste a read-only GitHub PAT into github-token.js for update checks

export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"

npm run build
```

Output lands in `dist/`. Use `npm run release` to also publish to GitHub Releases.

## GitHub Actions secrets

Add these in the repo's **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|---|---|
| `GH_TOKEN` | Fine-grained PAT with repo contents read/write (releases + update checks) |
| `CSC_LINK` | Base64-encoded `.p12` Developer ID certificate |
| `CSC_KEY_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character Team ID |

To base64-encode your certificate:

```bash
base64 -i YourCert.p12 | pbcopy
```

## How updates work

- **App code** updates via `electron-updater` from GitHub Releases (`.zip` for in-place update, `.dmg` for fresh installs).
- **Machine config** (`.env`) lives in Application Support and is never overwritten.
- **Templates** live in the watch folder and are managed through the app UI.
- **Job history** (`jobs.db`) lives in Application Support.

## Project layout

```
electron/     Main process, IPC, auto-updater
src/          Worker logic (queue, render, templates, socket bridge)
ui/           Renderer UI
ae/           Bundled AE assets (not in git — add locally before building)
```
