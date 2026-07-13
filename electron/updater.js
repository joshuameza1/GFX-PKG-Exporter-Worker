const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

let logFn = console.log;
let sendToRenderer = () => {};
let updateReady = false;

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

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  if (!app.isPackaged) return;

  const token = getUpdateToken();
  if (!token) {
    logFn('No GitHub token configured — update checks disabled', 'warn');
    sendToRenderer('update:status', {
      status: 'error',
      message: 'Update token not configured in this build',
    });
    return;
  }

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'joshuameza1',
    repo: 'GFX-PKG-Exporter-Worker',
    private: true,
    token,
  });

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
    const raw = err.message || String(err);
    let message = raw;
    if (/not signed|code signature|code object is not signed/i.test(raw)) {
      message =
        'Auto-update requires a signed app. Download the latest .dmg from GitHub Releases and install it manually (right-click → Open).';
    }
    sendToRenderer('update:status', {
      status: 'error',
      message,
    });
    logFn(`Update error: ${message}`, 'error');
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
    const result = await Promise.race([
      autoUpdater.checkForUpdates(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Update check timed out')), 20000);
      }),
    ]);
    return { status: 'checking', result };
  } catch (err) {
    sendToRenderer('update:status', {
      status: 'error',
      message: err.message,
    });
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
