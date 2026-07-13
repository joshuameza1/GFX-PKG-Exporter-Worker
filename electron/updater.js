const { app, dialog, shell } = require('electron');

const OWNER = 'joshuameza1';
const REPO = 'GFX-PKG-Exporter-Worker';
const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;

let logFn = console.log;
let sendToRenderer = () => {};
let latestUpdate = null;

function getUpdateToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const token = require('./github-token');
    return typeof token === 'string' ? token : '';
  } catch (_) {
    return '';
  }
}

function setupAutoUpdater({ log, sendToRenderer: send }) {
  logFn = log || console.log;
  sendToRenderer = send || (() => {});
}

function parseVersion(version) {
  return String(version || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function isNewerVersion(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i] || 0;
    const right = b[i] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
}

function pickDmgAsset(assets = []) {
  const dmgs = assets.filter((asset) => /\.dmg$/i.test(asset.name || ''));
  if (!dmgs.length) return null;

  // Match this machine's CPU. Prefer arch-specific builds over a "universal"
  // DMG that may still ship arm64-only native modules.
  const arch = process.arch; // arm64 | x64
  const archMatch = dmgs.find((asset) => new RegExp(`(^|[-_.])${arch}([-_.]|$)`, 'i').test(asset.name));
  if (archMatch) return archMatch;

  const universal = dmgs.find((asset) => /universal/i.test(asset.name));
  return universal || dmgs[0];
}

async function fetchLatestRelease() {
  const token = getUpdateToken();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'GFX-PKG-Exporter',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(RELEASES_API, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub release check failed (${response.status}): ${body.slice(0, 180)}`);
  }
  return response.json();
}

async function checkForUpdates({ silent = false } = {}) {
  sendToRenderer('update:status', { status: 'checking' });
  logFn('Checking for updates...');

  if (!app.isPackaged) {
    const message = 'Update checks run in the installed app. Dev builds always use local code.';
    sendToRenderer('update:status', { status: 'dev-mode', message });
    if (!silent) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'GFX PKG Exporter',
        message,
      });
    }
    return { status: 'dev-mode', message };
  }

  try {
    const release = await Promise.race([
      fetchLatestRelease(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Update check timed out')), 15000);
      }),
    ]);

    const remoteVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
    const localVersion = app.getVersion();
    const dmg = pickDmgAsset(release.assets || []);
    const releaseUrl = release.html_url || RELEASES_PAGE;
    const downloadUrl = dmg?.browser_download_url || releaseUrl;

    if (!remoteVersion) {
      throw new Error('Could not read latest release version');
    }

    if (isNewerVersion(remoteVersion, localVersion)) {
      latestUpdate = {
        version: remoteVersion,
        releaseUrl,
        downloadUrl,
        dmgName: dmg?.name || null,
      };
      sendToRenderer('update:status', {
        status: 'available',
        version: remoteVersion,
        releaseUrl,
        downloadUrl,
        dmgName: dmg?.name || null,
      });
      logFn(`Update available: v${remoteVersion}`);
      return { status: 'available', ...latestUpdate };
    }

    latestUpdate = null;
    sendToRenderer('update:status', {
      status: 'current',
      version: localVersion,
    });
    logFn('App is up to date');
    return { status: 'current', version: localVersion };
  } catch (err) {
    latestUpdate = null;
    sendToRenderer('update:status', {
      status: 'error',
      message: err.message,
    });
    logFn(`Update error: ${err.message}`, 'error');
    if (!silent) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update check failed',
        message: err.message,
      });
    }
    return { status: 'error', message: err.message };
  }
}

async function openLatestDownload() {
  const target = latestUpdate?.downloadUrl || latestUpdate?.releaseUrl || RELEASES_PAGE;
  await shell.openExternal(target);
  return { status: 'opened', url: target };
}

function getLatestUpdate() {
  return latestUpdate;
}

module.exports = {
  setupAutoUpdater,
  checkForUpdates,
  openLatestDownload,
  getLatestUpdate,
  // Keep old names as no-ops so older IPC wiring doesn't crash mid-deploy
  downloadUpdate: openLatestDownload,
  installUpdate: async () => ({ status: 'manual' }),
  isUpdateReady: () => Boolean(latestUpdate),
};
