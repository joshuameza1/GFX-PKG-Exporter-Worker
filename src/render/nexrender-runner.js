const nexrender = require('@nexrender/core');
const {
  isCommandLineRendererPatched,
  installCommandLineRendererPatch,
  withBlockedProcessExit,
} = require('../../electron/ae-patch');
const { ensureAfterEffectsRunning } = require('./ae-keepalive');

class NexrenderRunner {
  constructor(config, log = console.log) {
    this.config = config;
    this.log = typeof log === 'function' ? log : console.log;
    this.settings = null;
    this._aeWarmPromise = null;
  }

  async ensureAeWarm() {
    if (!this._aeWarmPromise) {
      this._aeWarmPromise = ensureAfterEffectsRunning(this.config.aerenderPath, this.log)
        .catch((err) => {
          this.log(`AE keepalive failed: ${err.message}`, 'warn');
          this._aeWarmPromise = null;
          return null;
        });
    }
    return this._aeWarmPromise;
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
    // Put aerender logs next to the job work folder (and quiet the deprecation spam).
    process.env.NEXRENDER_ENABLE_AELOG_PROJECT_FOLDER = 'true';

    const self = this;
    // NOTE: do NOT set reuse/aerender -reuse — AE 2026 rejects that flag.
    // Speed comes from keeping After Effects.app open instead.
    this.settings = withBlockedProcessExit(() => nexrender.init({
      workpath: this.config.nexrenderWorkpath,
      binary: this.config.aerenderPath,
      skipCleanup: true,
      stopOnError: true,
      debug: true,
      verbose: true,
      actions: {
        'gfx-copy-output': require('./action-copy-output'),
      },
      logger: {
        log: (...args) => self.log(args.map(String).join(' ')),
        error: (...args) => self.log(args.map(String).join(' '), 'error'),
      },
    }));
  }

  async renderJob(nexrenderConfig, { onProgress, onStateChange, onError } = {}) {
    this._ensureInit();
    await this.ensureAeWarm();

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
