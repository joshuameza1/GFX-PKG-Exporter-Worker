const nexrender = require('@nexrender/core');
const {
  isCommandLineRendererPatched,
  installCommandLineRendererPatch,
  withBlockedProcessExit,
} = require('../../electron/ae-patch');

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

    // nexrender otherwise calls process.exit(2) when it can't write the AE patch,
    // which kills the whole Electron app mid-render.
    if (!isCommandLineRendererPatched(this.config.aerenderPath)) {
      installCommandLineRendererPatch(this.config.aerenderPath, this.log);
    }

    this.log(
      `Init nexrender — binary=${this.config.aerenderPath} workpath=${this.config.nexrenderWorkpath}`
    );
    const self = this;
    this.settings = withBlockedProcessExit(() => nexrender.init({
      workpath: this.config.nexrenderWorkpath,
      binary: this.config.aerenderPath,
      skipCleanup: true,
      stopOnError: true,
      debug: true,
      verbose: true,
      logger: {
        log: (...args) => self.log(args.map(String).join(' ')),
        error: (...args) => self.log(args.map(String).join(' '), 'error'),
      },
    }));
  }

  async renderJob(nexrenderConfig, { onProgress, onStateChange, onError } = {}) {
    this._ensureInit();

    const templateSrc = nexrenderConfig?.template?.src;
    const composition = nexrenderConfig?.template?.composition;
    const useOriginal = Boolean(nexrenderConfig?.template?.useOriginal);
    this.log(
      `Starting render — comp=${composition} useOriginal=${useOriginal} template=${templateSrc}`
    );

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
