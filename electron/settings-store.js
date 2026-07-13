const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const PLACEHOLDER_URLS = new Set([
  '',
  'https://your-server.example.com',
  'http://your-server.example.com',
]);

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
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
    watchFolder: process.env.WATCH_FOLDER || '',
    renderFolder: process.env.RENDER_FOLDER || '',
    cdnUrl: process.env.CDN_URL || '',
    aerenderPath: process.env.AERENDER_PATH || '/Applications/Adobe After Effects 2026/aerender',
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
  };
}

function needsSetup(settings) {
  if (!settings) return true;
  if (!settings.setupComplete) return true;
  return !isValidServerUrl(settings.socketIoUrl);
}

function applySettingsToConfig(config, settings) {
  config.socketIoUrl = normalizeUrl(settings.socketIoUrl);
  config.watchFolder = settings.watchFolder || config.watchFolder;
  config.renderFolder = settings.renderFolder || config.renderFolder;
  config.cdnUrl = settings.cdnUrl || config.cdnUrl;
  if (settings.aerenderPath) config.aerenderPath = settings.aerenderPath;
  return config;
}

function saveSettings(partial) {
  const current = loadSettings();
  const next = {
    ...current,
    ...partial,
    socketIoUrl: normalizeUrl(partial.socketIoUrl !== undefined ? partial.socketIoUrl : current.socketIoUrl),
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
};
