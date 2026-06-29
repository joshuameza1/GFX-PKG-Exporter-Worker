const nexrender = require('@nexrender/core');

class NexrenderRunner {
  constructor(config) {
    this.config = config;
    this.settings = null;
  }

  _ensureInit() {
    if (this.settings) return;
    this.settings = nexrender.init({
      workpath: this.config.nexrenderWorkpath,
      binary: this.config.aerenderPath,
      skipCleanup: false,
      stopOnError: true,
      debug: false,
    });
  }

  async renderJob(nexrenderConfig, { onProgress, onStateChange, onError } = {}) {
    this._ensureInit();

    nexrenderConfig.onChange = (job, state) => onStateChange?.(state);
    nexrenderConfig.onRenderProgress = (job, percent) => onProgress?.(percent);
    nexrenderConfig.onRenderError = (job, err) => onError?.(err);

    return nexrender.render(nexrenderConfig, this.settings);
  }
}

module.exports = { NexrenderRunner };
