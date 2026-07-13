const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

function resolveAeAppPath(aerenderPath) {
  if (!aerenderPath) return null;
  const dir = path.dirname(aerenderPath);
  if (!fs.existsSync(dir)) return null;

  let apps = [];
  try {
    apps = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.app') && /After Effects/i.test(name))
      .filter((name) => !/Render Engine/i.test(name));
  } catch (_) {
    return null;
  }

  if (!apps.length) return null;
  apps.sort((a, b) => a.length - b.length);
  return path.join(dir, apps[0]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pattern) {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', pattern], (err, stdout) => {
      resolve(Boolean(stdout && String(stdout).trim()));
    });
  });
}

function aeRespondsToAppleEvents(appName) {
  try {
    execFileSync(
      'osascript',
      ['-e', `tell application ${JSON.stringify(appName)} to get version`],
      { timeout: 8000, stdio: 'pipe' }
    );
    return true;
  } catch (_) {
    return false;
  }
}

async function waitForAeReady(appName, log, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (aeRespondsToAppleEvents(appName)) {
      log(`After Effects is ready for -reuse (${appName})`);
      return true;
    }
    log('Waiting for After Effects to finish launching…');
    await sleep(2000);
  }
  log('After Effects did not become Apple Event ready in time', 'warn');
  return false;
}

/**
 * Keep After Effects.app open and wait until it accepts Apple Events.
 * aerender -reuse only works once AE can receive AESend; otherwise it fails
 * or falls back to a slow new instance.
 */
async function ensureAfterEffectsRunning(aerenderPath, log = console.log) {
  const appPath = resolveAeAppPath(aerenderPath);
  if (!appPath) {
    log('Could not locate After Effects.app next to aerender', 'warn');
    return { ok: false, ready: false, reason: 'app-not-found' };
  }

  const appName = path.basename(appPath, '.app');
  const running = await isProcessRunning(`${appName}.app/Contents/MacOS`);

  if (!running) {
    log(`Opening ${appName} in the background — leave it open for fast -reuse renders`);
    try {
      await new Promise((resolve, reject) => {
        execFile('open', ['-gj', '-a', appPath], (err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      log(`Failed to open After Effects: ${err.message}`, 'warn');
      return { ok: false, ready: false, appPath, reason: 'open-failed' };
    }
  } else {
    log(`After Effects process found (${appName})`);
  }

  const ready = await waitForAeReady(appName, log);
  return { ok: true, ready, already: running, appPath, appName };
}

module.exports = {
  resolveAeAppPath,
  ensureAfterEffectsRunning,
  aeRespondsToAppleEvents,
};
