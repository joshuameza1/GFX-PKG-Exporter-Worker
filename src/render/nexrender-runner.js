const nexrender = require('@nexrender/core');

class NexrenderRunner {
  constructor(config, log = console.log) {
    this.config = config;
    this.log = typeof log === 'function' ? log : console.log;
    this.settings = null;
  }

  _ensureInit() {
    if (this.settings) return;
    if (!this.config.aerenderPath) {
      throw new Error('aerender path is not configured');
    }
    if (!this.config.nexrenderWorkpath) {
      throw new Error('nexrender workpath is not configured');
    }

    this.log(
      `Init nexrender — binary=${this.config.aerenderPath} workpath=${this.config.nexrenderWorkpath}`
    );
    this.settings = nexrender.init({
      workpath: this.config.nexrenderWorkpath,
      binary: this.config.aerenderPath,
      skipCleanup: true, // keep work files for crash diagnosis
      stopOnError: true,
      debug: true,
    });
  }

  async renderJob(nexrenderConfig, { onProgress, onStateChange, onError } = {}) {
    this._ensureInit();

    const templateSrc = nexrenderConfig?.template?.src;
    const composition = nexrenderConfig?.template?.composition;
    this.log(`Starting render — comp=${composition} template=${templateSrc}`);

    nexrenderConfig.onChange = (job, state) => {
      this.log(`Render state: ${state}`);
      onStateChange?.(state);
    };
    nexrenderConfig.onRenderProgress = (job, percent) => {
      onProgress?.(percent);
    };
    nexrenderConfig.onRenderError = (job, err) => {
      this.log(`Render error: ${err?.message || err}`, 'error');
      onError?.(err);
    };

    try {
      const result = await nexrender.render(nexrenderConfig, this.settings);
      this.log(`Render finished — comp=${composition}`);
      return result;
    } catch (err) {
      this.log(`Render threw: ${err?.message || err}`, 'error');
      throw err;
    }
  }
}

module.exports = { NexrenderRunner };
