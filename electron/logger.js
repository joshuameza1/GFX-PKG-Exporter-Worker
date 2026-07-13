const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFilePath = null;

function getLogsDir() {
  return path.join(app.getPath('userData'), 'logs');
}

function getLogFilePath() {
  if (!logFilePath) {
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'app.log');
  }
  return logFilePath;
}

function appendLog(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(getLogFilePath(), line);
  } catch (_) {
    // ignore disk errors
  }
  return line;
}

function readRecentLogs(maxBytes = 64 * 1024) {
  const filePath = getLogFilePath();
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(filePath, 'r');
  try {
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  getLogsDir,
  getLogFilePath,
  appendLog,
  readRecentLogs,
};
