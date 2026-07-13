# GFX PKG Exporter

After Effects render worker with an Electron UI. Connects to the GFX PKG Exporter Slack app, queues render jobs, and manages template packages.

## Development

```bash
npm install
cp .env.example .env   # edit with your paths and server URL
npm run dev
```

## First install on a Mac (unsigned DMG)

Builds are **not code-signed** (no Apple Developer account required). macOS will show a security warning on first launch — that's expected for internal use.

1. Download the latest `.dmg` from [GitHub Releases](https://github.com/joshuameza1/GFX-PKG-Exporter-Worker/releases).
2. Drag **GFX PKG Exporter** into Applications.
3. **First launch:** right-click the app → **Open** → **Open** again in the dialog.  
   Or go to **System Settings → Privacy & Security → Open Anyway**.
4. The app creates a config file at:
   `~/Library/Application Support/GFX PKG Exporter/.env`
5. Edit that `.env` with the machine's watch folder, render folder, socket URL, and AE path.
6. Restart the app.

Local config, job history, and template packages are stored outside the app bundle and are preserved across updates.

## Releasing a new version

1. Bump `version` in `package.json` (e.g. `1.0.0` → `1.0.1`).
2. Commit and push to `main`.
3. Create and push a version tag:

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions builds an unsigned universal Mac `.dmg` + `.zip` and publishes to GitHub Releases. Installed apps check for updates on launch and via **Settings → Check for updates**.

## Building locally (unsigned DMG)

```bash
npm install
cp electron/github-token.js.example electron/github-token.js
# Paste a read-only GitHub PAT into github-token.js for update checks

npm run build        # outputs to dist/ — install locally
npm run release      # build + publish to GitHub Releases (needs GH_TOKEN env var)
```

## GitHub Actions secrets

Only **one secret** is required for unsigned releases:

| Secret | Purpose |
|---|---|
| `GH_TOKEN` | Fine-grained PAT with repo contents read/write (releases + update checks) |

You do **not** need Apple signing secrets (`CSC_LINK`, `APPLE_ID`, etc.) for unsigned builds.

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
