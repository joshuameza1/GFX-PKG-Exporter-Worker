const EventEmitter = require('events');
const chokidar = require('chokidar');
const path = require('path');
const { packageIdFromAepxPath, isIgnoredName } = require('./package-paths');

class TemplateWatcher extends EventEmitter {
  constructor(watchFolder) {
    super();
    this.watchFolder = watchFolder;
    this.watcher = null;
    this.debounceTimer = null;
  }

  start() {
    const fs = require('fs');
    if (!this.watchFolder || !fs.existsSync(this.watchFolder)) {
      console.warn(`[watcher] Watch folder does not exist: ${this.watchFolder}`);
      return;
    }

    this.watcher = chokidar.watch(this.watchFolder, {
      persistent: true,
      usePolling: true,
      alwaysStat: true,
      ignoreInitial: true,
      depth: 6,
    });

    this.watcher.on('change', (filePath) => this._handle(filePath, 'changed'));
    this.watcher.on('add', (filePath) => this._handle(filePath, 'added'));
  }

  _handle(filePath, action) {
    if (!this._isValidTemplate(filePath)) return;

    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const packageId = packageIdFromAepxPath(this.watchFolder, filePath);
      console.log(`[watcher] Template ${action}: ${packageId || path.basename(filePath)}`);
      this.emit('template-changed', filePath);
    }, 1000);
  }

  _isValidTemplate(filePath) {
    const basename = path.basename(filePath);
    if (!basename.toLowerCase().endsWith('.aepx')) return false;
    if (isIgnoredName(basename)) return false;
    if (filePath.includes(`${path.sep}_PastBrandings${path.sep}`)) return false;
    if (filePath.includes('Auto-Save')) return false;

    const rel = path.relative(this.watchFolder, filePath);
    if (!rel || rel.startsWith('..')) return false;
    // Ignore nested random aepx outside first-level package / flat file
    const parts = rel.split(path.sep);
    if (parts.length === 1) return true; // flat
    if (parts.length >= 2) return true; // inside package folder
    return false;
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = { TemplateWatcher };
