const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getEnvPath() {
  if (!app.isPackaged) {
    return path.join(__dirname, '..', '.env');
  }

  const userEnvPath = path.join(app.getPath('userData'), '.env');
  if (!fs.existsSync(userEnvPath)) {
    const examplePath = path.join(process.resourcesPath, '.env.example');
    const fallbackExample = path.join(__dirname, '..', '.env.example');

    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, userEnvPath);
    } else if (fs.existsSync(fallbackExample)) {
      fs.copyFileSync(fallbackExample, userEnvPath);
    }
  }

  return userEnvPath;
}

function loadEnv() {
  const envPath = getEnvPath();
  require('dotenv').config({ path: envPath });
  return envPath;
}

module.exports = { getEnvPath, loadEnv };
