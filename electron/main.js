const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

const { loadEnv } = require('./env-loader');
loadEnv();

const config = require('../src/config');
const {
  loadSettings,
  saveSettings,
  needsSetup,
  isValidServerUrl,
  applySettingsToConfig,
  getSettingsPath,
} = require('./settings-store');
const { JobStore } = require('../src/queue/job-store');
const { JobProcessor } = require('../src/queue/job-processor');
const { SocketClient } = require('../src/bridge/socket-client');
const { EventRouter } = require('../src/bridge/event-router');
const { TemplateWatcher } = require('../src/templates/template-watcher');
const { TemplateParser } = require('../src/templates/template-parser');
const { registerIpcHandlers } = require('./ipc-handlers');
const { setupAutoUpdater, checkForUpdates } = require('./updater');

const settings = loadSettings();
applySettingsToConfig(config, settings);

let mainWindow;
let socketClient;
let watcher;
let templateParser;

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function log(message, level = 'info') {
  const entry = { timestamp: new Date().toISOString(), message, level };
  console.log(`[${level}] ${message}`);
  sendToRenderer('log', entry);
}

function sendTemplateUpdate() {
  if (!templateParser) return;
  const info = templateParser.getCurrentInfo();
  sendToRenderer('template:updated', {
    ...info,
    graphics: templateParser.lastGraphics,
  });
}

function restartWatcher() {
  if (watcher) watcher.stop();
  watcher = new TemplateWatcher(config.watchFolder);
  watcher.on('template-changed', async (filePath) => {
    log('Template file changed, re-parsing...');
    await templateParser.updatePackage(filePath);
    const liveGraphics = templateParser.getLiveGraphics();
    if (socketClient) socketClient.emit('updateSlackAppUI', liveGraphics);
    log(`Pushed ${liveGraphics.length} compositions to Slack`);
    sendTemplateUpdate();
  });
  watcher.start();
}

app.whenReady().then(() => {
  let jobStore = null;
  let processor = null;
  let eventRouter = null;
  let initError = null;

  // Register IPC before the window loads so Settings / update never race a failed service init.
  try {
    jobStore = new JobStore(path.join(app.getPath('userData'), 'jobs.db'));
  } catch (err) {
    initError = err;
    console.error('[error] JobStore failed to open:', err);
  }

  socketClient = new SocketClient(config.socketIoUrl);
  templateParser = new TemplateParser(config.watchFolder);

  if (jobStore) {
    try {
      processor = new JobProcessor(jobStore, config);
      eventRouter = new EventRouter(socketClient, jobStore, processor);
    } catch (err) {
      initError = initError || err;
      console.error('[error] Queue/processor init failed:', err);
    }
  }

  registerIpcHandlers(ipcMain, {
    jobStore,
    socketClient,
    templateParser,
    config,
    processor,
    getSettings: () => loadSettings(),
    saveAppSettings: (partial) => {
      try {
        const prevUrl = config.socketIoUrl;
        const prevWatch = config.watchFolder;
        const next = saveSettings(partial);
        applySettingsToConfig(config, next);

        // Return immediately; reconnect/watch work must not block Settings UI.
        setImmediate(() => {
          try {
            if (config.socketIoUrl !== prevUrl) {
              if (isValidServerUrl(config.socketIoUrl)) {
                log(`Connecting to ${config.socketIoUrl}...`);
                socketClient.reconnect(config.socketIoUrl);
              } else {
                socketClient.disconnect();
                log('Server URL cleared — disconnected', 'warn');
              }
            }

            if (config.watchFolder !== prevWatch) {
              templateParser.watchFolder = config.watchFolder;
              if (config.watchFolder) restartWatcher();
              else if (watcher) watcher.stop();
              log(`Watch folder updated: ${config.watchFolder || '(none)'}`);
            }

            if (!needsSetup(next) && app.isPackaged) {
              scheduleUpdateCheck();
            }

            sendToRenderer('config:updated', {
              socketIoUrl: config.socketIoUrl,
              watchFolder: config.watchFolder,
              renderFolder: config.renderFolder,
              cdnUrl: config.cdnUrl,
              settingsPath: getSettingsPath(),
              needsSetup: needsSetup(next),
              hostname: require('os').hostname(),
              appVersion: app.getVersion(),
              isPackaged: app.isPackaged,
            });
          } catch (err) {
            log(`Settings apply failed: ${err.message}`, 'error');
          }
        });

        return {
          settings: next,
          needsSetup: needsSetup(next),
        };
      } catch (err) {
        return { error: err.message || 'Failed to save settings' };
      }
    },
  });

  setupAutoUpdater({ log, sendToRenderer });

  let updateCheckScheduled = false;
  function scheduleUpdateCheck() {
    if (!app.isPackaged || updateCheckScheduled) return;
    if (needsSetup(loadSettings())) return;
    updateCheckScheduled = true;
    setTimeout(() => {
      checkForUpdates({ silent: true }).catch((err) => {
        log(`Update check failed: ${err.message}`, 'warn');
      });
    }, 8000);
  }

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 500,
    title: 'GFX PKG Exporter',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));

  if (initError) {
    dialog.showErrorBox(
      'GFX PKG Exporter — database failed to open',
      [
        initError.message || String(initError),
        '',
        'Settings and update checks should still work.',
        'If this Mac is Intel, install the x64 DMG (not arm64).',
        `This build architecture: ${process.arch}`,
      ].join('\n')
    );
  }

  socketClient.on('status', (status) => {
    sendToRenderer('socket:status', status);
    if (status === 'connected') {
      log('Connected to server');
      setImmediate(() => {
        templateParser.parseAllTemplates()
          .then((liveGraphics) => {
            if (liveGraphics && liveGraphics.length > 0) {
              socketClient.emit('updateSlackAppUI', liveGraphics);
              log(`Pushed ${liveGraphics.length} compositions to Slack`);
            }
            sendTemplateUpdate();
          })
          .catch((err) => log(`Template parse failed: ${err.message}`, 'error'));
      });
    } else if (status === 'disconnected') {
      log('Disconnected from server', 'warn');
    } else if (status === 'connecting') {
      log('Connecting to server...');
    }
  });

  if (eventRouter) {
    eventRouter.on('job:queued', (data) => {
      log(`Job queued: ${data.request.type} from ${data.request.display_name || data.request.user_id}`);
      sendToRenderer('queue:updated');
    });
    eventRouter.on('job:completed', (data) => {
      log(`Job completed: ${data.id}`);
      sendToRenderer('queue:updated');
    });
    eventRouter.on('job:failed', (data) => {
      log(`Job failed: ${data.id} — ${data.errorMessage}`, 'error');
      sendToRenderer('queue:updated');
    });
  }

  if (processor) {
    processor.on('job:progress', (data) => {
      sendToRenderer('job:progress', data);
    });
  }

  if (isValidServerUrl(config.socketIoUrl) && !needsSetup(settings)) {
    socketClient.connect();
    scheduleUpdateCheck();
  } else {
    log('Setup required — open Settings or complete first-launch setup', 'warn');
  }

  if (config.watchFolder) {
    restartWatcher();
  }

  if (processor) processor.start();
  log('GFX PKG Exporter started');
}).catch((err) => {
  console.error('[fatal] App failed to start:', err);
  dialog.showErrorBox('GFX PKG Exporter failed to start', err.message || String(err));
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});
