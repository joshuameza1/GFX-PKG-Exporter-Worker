const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getEnvPath() {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', '.env');
  }

  const userEnvPath = path.join(app.getPath('userData'), '.env');
  // Prefer settings.json going forward. Only create a blank .env stub if missing —
  // never copy example placeholder paths that break the first launch.
  if (!fs.existsSync(userEnvPath)) {
    fs.mkdirSync(path.dirname(userEnvPath), { recursive: true });
    fs.writeFileSync(
      userEnvPath,
      [
        '# Optional fallback. Prefer Settings in the app UI.',
        'SOCKET_IO_URL=',
        'WATCH_FOLDER=',
        'RENDER_FOLDER=',
        'CDN_URL=',
        '',
      ].join('\n')
    );
  }

  return userEnvPath;
}

function loadEnv() {
  const envPath = getEnvPath();
  require('dotenv').config({ path: envPath });
  return envPath;
}

module.exports = { getEnvPath, loadEnv };
