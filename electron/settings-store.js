const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { resolveAerenderPath } = require('./ae-paths');

const PLACEHOLDER_URLS = new Set([
  '',
  'https://your-server.example.com',
  'http://your-server.example.com',
]);

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getDefaultAppDirs() {
  const root = path.join(app.getPath('documents'), 'GFXPKGExporter');
  return {
    root,
    packages: path.join(root, 'Packages'),
    renders: path.join(root, 'Renders'),
    work: path.join(root, 'Work'),
  };
}

function ensureDir(dirPath) {
  if (!dirPath) return;
  fs.mkdirSync(dirPath, { recursive: true });
}

function isPlaceholderPath(value) {
  const v = (value || '').trim().toLowerCase();
  if (!v) return true;
  return (
    v.includes('/path/to/')
    || v.includes('\\path\\to\\')
    || v === 'example.com'
    || v.includes('your-server.example')
    || v.includes('cdn.example.com')
  );
}

function cleanPath(value) {
  const v = (value || '').trim();
  return isPlaceholderPath(v) ? '' : v;
}

function readSettingsFile() {
  const filePath = getSettingsPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeSettingsFile(settings) {
  const filePath = getSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  return filePath;
}

function normalizeUrl(url) {
  return (url || '').trim().replace(/\/$/, '');
}

function isValidServerUrl(url) {
  const value = normalizeUrl(url);
  if (!value || PLACEHOLDER_URLS.has(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function buildDefaultsFromEnv() {
  const dirs = getDefaultAppDirs();
  return {
    setupComplete: false,
    socketIoUrl: normalizeUrl(process.env.SOCKET_IO_URL),
    watchFolder: cleanPath(process.env.WATCH_FOLDER) || dirs.packages,
    renderFolder: cleanPath(process.env.RENDER_FOLDER) || dirs.renders,
    cdnUrl: cleanPath(process.env.CDN_URL) || '',
    aerenderPath: cleanPath(process.env.AERENDER_PATH) || '',
  };
}

function withDefaultFolders(settings) {
  const dirs = getDefaultAppDirs();
  const next = {
    ...settings,
    watchFolder: cleanPath(settings.watchFolder) || dirs.packages,
    renderFolder: cleanPath(settings.renderFolder) || dirs.renders,
  };
  ensureDir(dirs.root);
  ensureDir(next.watchFolder);
  ensureDir(next.renderFolder);
  ensureDir(dirs.work);
  return { settings: next, dirs };
}

function loadSettings() {
  const defaults = buildDefaultsFromEnv();
  const stored = readSettingsFile();
  const merged = stored
    ? {
      ...defaults,
      ...stored,
      socketIoUrl: normalizeUrl(stored.socketIoUrl || defaults.socketIoUrl),
      watchFolder: cleanPath(stored.watchFolder ?? defaults.watchFolder),
      renderFolder: cleanPath(stored.renderFolder ?? defaults.renderFolder),
      cdnUrl: cleanPath(stored.cdnUrl ?? defaults.cdnUrl) || (stored.cdnUrl || ''),
    }
    : defaults;

  const { settings, dirs } = withDefaultFolders(merged);

  // Persist defaults for fresh installs so Settings shows real paths.
  if (!stored || !stored.watchFolder || !stored.renderFolder) {
    writeSettingsFile({
      ...settings,
      // Don't mark setup complete just because folders exist.
      setupComplete: Boolean(stored?.setupComplete),
    });
  }

  settings._dirs = dirs;
  return settings;
}

function needsSetup(settings) {
  if (!settings) return true;
  if (!settings.setupComplete) return true;
  return !isValidServerUrl(settings.socketIoUrl);
}

function applySettingsToConfig(config, settings) {
  const { settings: normalized, dirs } = withDefaultFolders(settings);
  config.socketIoUrl = normalizeUrl(normalized.socketIoUrl);
  config.watchFolder = normalized.watchFolder;
  config.renderFolder = normalized.renderFolder;
  config.cdnUrl = normalized.cdnUrl || '';
  config.nexrenderWorkpath = dirs.work;
  const preferred = cleanPath(normalized.aerenderPath) || cleanPath(config.aerenderPath);
  config.aerenderPath = resolveAerenderPath(preferred) || preferred || '';
  return config;
}

function saveSettings(partial) {
  const current = loadSettings();
  const next = {
    ...current,
    ...partial,
    socketIoUrl: normalizeUrl(
      partial.socketIoUrl !== undefined ? partial.socketIoUrl : current.socketIoUrl
    ),
    watchFolder: cleanPath(
      partial.watchFolder !== undefined ? partial.watchFolder : current.watchFolder
    ),
    renderFolder: cleanPath(
      partial.renderFolder !== undefined ? partial.renderFolder : current.renderFolder
    ),
    cdnUrl: partial.cdnUrl !== undefined ? partial.cdnUrl.trim() : current.cdnUrl,
    setupComplete: true,
  };
  delete next._dirs;
  const { settings } = withDefaultFolders(next);
  writeSettingsFile(settings);
  return settings;
}

module.exports = {
  getSettingsPath,
  getDefaultAppDirs,
  loadSettings,
  saveSettings,
  needsSetup,
  isValidServerUrl,
  applySettingsToConfig,
  normalizeUrl,
  cleanPath,
  isPlaceholderPath,
};
