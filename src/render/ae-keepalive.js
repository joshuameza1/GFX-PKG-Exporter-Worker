const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

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
  // Prefer exact "Adobe After Effects YYYY.app" over helpers.
  apps.sort((a, b) => a.length - b.length);
  return path.join(dir, apps[0]);
}

function isProcessRunning(pattern) {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', pattern], (err, stdout) => {
      resolve(Boolean(stdout && String(stdout).trim()));
    });
  });
}

/**
 * Keep After Effects.app open in the background. Warm launches are much faster
 * than cold aerender starts. AE 2026 does not support aerender's -reuse flag.
 */
async function ensureAfterEffectsRunning(aerenderPath, log = console.log) {
  const appPath = resolveAeAppPath(aerenderPath);
  if (!appPath) {
    log('Could not locate After Effects.app next to aerender', 'warn');
    return { ok: false, reason: 'app-not-found' };
  }

  const appName = path.basename(appPath, '.app');
  const running = await isProcessRunning(`${appName}.app/Contents/MacOS`);
  if (running) {
    log(`After Effects already open (${appName}) — renders should stay fast`);
    return { ok: true, already: true, appPath };
  }

  log(`Opening ${appName} in the background — leave it open for fast renders`);
  await new Promise((resolve, reject) => {
    execFile('open', ['-gj', '-a', appPath], (err) => (err ? reject(err) : resolve()));
  }).catch((err) => {
    log(`Failed to open After Effects: ${err.message}`, 'warn');
    return null;
  });

  // Brief wait so AE can start bootstrapping before aerender attaches.
  await new Promise((r) => setTimeout(r, 4000));
  return { ok: true, already: false, appPath };
}

module.exports = {
  resolveAeAppPath,
  ensureAfterEffectsRunning,
};
