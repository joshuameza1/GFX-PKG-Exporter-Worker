const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function getAeRoot(aerenderPath) {
  return path.dirname(aerenderPath);
}

function getCommandLineRendererPath(aerenderPath) {
  return path.join(getAeRoot(aerenderPath), 'Scripts', 'Startup', 'commandLineRenderer.jsx');
}

function getPatchedScript(aerenderPath) {
  const yearMatch = getAeRoot(aerenderPath).match(/(20\d{2})/);
  if (yearMatch && Number(yearMatch[1]) >= 2022) {
    return require('@nexrender/core/src/assets/commandLineRenderer-2022.jsx');
  }
  return require('@nexrender/core/src/assets/commandLineRenderer-default.jsx');
}

function isCommandLineRendererPatched(aerenderPath) {
  const filePath = getCommandLineRendererPath(aerenderPath);
  if (!fs.existsSync(filePath)) return false;
  try {
    return fs.readFileSync(filePath, 'utf8').includes('nexrender-patch');
  } catch (_) {
    return false;
  }
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * One-time admin install of nexrender's AE commandLineRenderer.jsx patch.
 * Without this, nexrender calls process.exit(2) and kills the Electron app.
 */
function installCommandLineRendererPatch(aerenderPath, log = console.log) {
  if (!aerenderPath || !fs.existsSync(aerenderPath)) {
    throw new Error('aerender path not found — cannot install AE patch');
  }

  if (isCommandLineRendererPatched(aerenderPath)) {
    log('AE commandLineRenderer.jsx already patched');
    return { patched: true, already: true };
  }

  const aeRoot = getAeRoot(aerenderPath);
  const originalFile = getCommandLineRendererPath(aerenderPath);
  const backupDir = path.join(aeRoot, 'Backup.Scripts', 'Startup');
  const backupFile = path.join(backupDir, 'commandLineRenderer.jsx');
  const patched = getPatchedScript(aerenderPath);
  const tmpFile = path.join(os.tmpdir(), `nexrender-commandLineRenderer-${Date.now()}.jsx`);

  fs.writeFileSync(tmpFile, patched, 'utf8');
  log('Requesting admin permission to patch After Effects commandLineRenderer.jsx (one-time)...');

  try {
    const { dialog, BrowserWindow } = require('electron');
    dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow(), {
      type: 'info',
      title: 'After Effects setup (one-time)',
      message: 'GFX PKG Exporter needs your Mac admin password once.',
      detail:
        'This installs a small After Effects command-line patch required for rendering. ' +
        'macOS will ask for your password next.',
      buttons: ['Continue'],
    });
  } catch (_) {
    // Non-Electron / headless fallback: osascript prompt is enough.
  }

  const cmd = [
    `mkdir -p ${shellSingleQuote(backupDir)}`,
    `if [ ! -f ${shellSingleQuote(backupFile)} ]; then cp ${shellSingleQuote(originalFile)} ${shellSingleQuote(backupFile)}; fi`,
    `cp ${shellSingleQuote(tmpFile)} ${shellSingleQuote(originalFile)}`,
    `chmod 755 ${shellSingleQuote(originalFile)}`,
  ].join(' && ');

  try {
    execFileSync(
      'osascript',
      ['-e', `do shell script ${JSON.stringify(cmd)} with administrator privileges`],
      { timeout: 180000 }
    );
  } catch (err) {
    throw new Error(
      'Could not install the After Effects nexrender patch. ' +
      'Enter your Mac password when prompted, or ask an admin to run this app once. ' +
      `(${err.message || err})`
    );
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }

  if (!isCommandLineRendererPatched(aerenderPath)) {
    throw new Error('AE patch install finished but commandLineRenderer.jsx still looks unpatched');
  }

  log('AE commandLineRenderer.jsx patch installed');
  return { patched: true, already: false };
}

function withBlockedProcessExit(fn) {
  const originalExit = process.exit;
  process.exit = (code) => {
    throw new Error(
      `Blocked process.exit(${code}) from nexrender. ` +
      'Usually means the AE commandLineRenderer.jsx patch could not be written (needs admin once).'
    );
  };
  try {
    return fn();
  } finally {
    process.exit = originalExit;
  }
}

module.exports = {
  isCommandLineRendererPatched,
  installCommandLineRendererPatch,
  withBlockedProcessExit,
  getCommandLineRendererPath,
};
