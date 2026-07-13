const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let logFn = console.log;
let sendToRenderer = () => {};
let updateReady = false;

function getUpdateToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return require('./github-token');
  } catch (_) {
    return '';
  }
}

function setupAutoUpdater({ log, sendToRenderer: send }) {
  logFn = log || console.log;
  sendToRenderer = send || (() => {});

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const token = getUpdateToken();
  if (token) {
    autoUpdater.requestHeaders = { Authorization: `token ${token}` };
  }

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update:status', { status: 'checking' });
    logFn('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    updateReady = false;
    sendToRenderer('update:status', {
      status: 'available',
      version: info.version,
    });
    logFn(`Update available: v${info.version}`);
  });

  autoUpdater.on('update-not-available', (info) => {
    updateReady = false;
    sendToRenderer('update:status', {
      status: 'current',
      version: info.version,
    });
    logFn('App is up to date');
  });

  autoUpdater.on('error', (err) => {
    sendToRenderer('update:status', {
      status: 'error',
      message: err.message,
    });
    logFn(`Update error: ${err.message}`, 'error');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update:status', {
      status: 'downloading',
      percent: Math.round(progress.percent || 0),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    sendToRenderer('update:status', {
      status: 'ready',
      version: info.version,
    });
    logFn(`Update downloaded: v${info.version}. Restart to install.`);
  });
}

async function checkForUpdates({ silent = false } = {}) {
  if (!app.isPackaged) {
    const message = 'Updates are only available in the installed app.';
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
    await autoUpdater.checkForUpdates();
    return { status: 'checking' };
  } catch (err) {
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

async function downloadUpdate() {
  if (!app.isPackaged) return { status: 'dev-mode' };
  await autoUpdater.downloadUpdate();
  return { status: 'downloading' };
}

function installUpdate() {
  if (!updateReady) return { status: 'not-ready' };
  autoUpdater.quitAndInstall();
  return { status: 'installing' };
}

function isUpdateReady() {
  return updateReady;
}

module.exports = {
  setupAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  isUpdateReady,
};
