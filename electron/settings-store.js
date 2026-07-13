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
  return {
    setupComplete: false,
    socketIoUrl: normalizeUrl(process.env.SOCKET_IO_URL),
    watchFolder: cleanPath(process.env.WATCH_FOLDER),
    renderFolder: cleanPath(process.env.RENDER_FOLDER),
    cdnUrl: cleanPath(process.env.CDN_URL) || '',
    aerenderPath: cleanPath(process.env.AERENDER_PATH) || '',
  };
}

function loadSettings() {
  const defaults = buildDefaultsFromEnv();
  const stored = readSettingsFile();
  if (!stored) return defaults;
  return {
    ...defaults,
    ...stored,
    socketIoUrl: normalizeUrl(stored.socketIoUrl || defaults.socketIoUrl),
    watchFolder: cleanPath(stored.watchFolder ?? defaults.watchFolder),
    renderFolder: cleanPath(stored.renderFolder ?? defaults.renderFolder),
    cdnUrl: cleanPath(stored.cdnUrl ?? defaults.cdnUrl) || (stored.cdnUrl || ''),
  };
}

function needsSetup(settings) {
  if (!settings) return true;
  if (!settings.setupComplete) return true;
  return !isValidServerUrl(settings.socketIoUrl);
}

function applySettingsToConfig(config, settings) {
  config.socketIoUrl = normalizeUrl(settings.socketIoUrl);
  config.watchFolder = cleanPath(settings.watchFolder);
  config.renderFolder = cleanPath(settings.renderFolder);
  config.cdnUrl = settings.cdnUrl || '';
  const preferred = cleanPath(settings.aerenderPath) || cleanPath(config.aerenderPath);
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
  writeSettingsFile(next);
  return next;
}

module.exports = {
  getSettingsPath,
  loadSettings,
  saveSettings,
  needsSetup,
  isValidServerUrl,
  applySettingsToConfig,
  normalizeUrl,
  cleanPath,
  isPlaceholderPath,
};
