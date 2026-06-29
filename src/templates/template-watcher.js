const EventEmitter = require('events');
const chokidar = require('chokidar');
const path = require('path');

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
    });

    this.watcher.on('change', (filePath) => {
      if (!this._isValidTemplate(filePath)) return;

      // Debounce rapid saves (AE can trigger multiple change events)
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        console.log(`[watcher] Template changed: ${path.basename(filePath)}`);
        this.emit('template-changed', filePath);
      }, 1000);
    });

    this.watcher.on('add', (filePath) => {
      if (!this._isValidTemplate(filePath)) return;
      console.log(`[watcher] Template added: ${path.basename(filePath)}`);
      this.emit('template-changed', filePath);
    });
  }

  _isValidTemplate(filePath) {
    const basename = path.basename(filePath);
    if (!basename.endsWith('.aepx')) return false;
    if (basename.startsWith('.') || basename.startsWith('~')) return false;
    if (filePath.includes('Auto-Save')) return false;
    if (filePath.includes('_PastBrandings')) return false;
    return true;
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = { TemplateWatcher };
