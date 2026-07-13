const nexrender = require('@nexrender/core');
const {
  isCommandLineRendererPatched,
  installCommandLineRendererPatch,
  withBlockedProcessExit,
} = require('../../electron/ae-patch');
const { ensureAfterEffectsRunning } = require('./ae-keepalive');

function isReuseAppleEventFailure(err) {
  const msg = String(err && (err.message || err));
  return (
    /-1701\b/.test(msg)
    || /-1712\b/.test(msg)
    || /AESend/i.test(msg)
    || /AEGetParamPt/i.test(msg)
    || /No render output found/i.test(msg)
  );
}

class NexrenderRunner {
  constructor(config, log = console.log) {
    this.config = config;
    this.log = typeof log === 'function' ? log : console.log;
    this.settingsReuse = null;
    this.settingsFresh = null;
    this._aeReady = null;
    this._reuseDisabled = false;
  }

  async ensureAeWarm() {
    if (this._aeReady?.ready) return this._aeReady;
    try {
      const result = await ensureAfterEffectsRunning(this.config.aerenderPath, this.log);
      if (result?.ready) this._aeReady = result;
      return result;
    } catch (err) {
      this.log(`AE keepalive failed: ${err.message}`, 'warn');
      return null;
    }
  }

  _prepareBinary() {
    if (!this.config.aerenderPath) {
      throw new Error('aerender path is not configured');
    }
    if (!this.config.nexrenderWorkpath) {
      throw new Error('nexrender workpath is not configured');
    }
    if (!isCommandLineRendererPatched(this.config.aerenderPath)) {
      installCommandLineRendererPatch(this.config.aerenderPath, this.log);
    }
    process.env.NEXRENDER_ENABLE_AELOG_PROJECT_FOLDER = 'true';
  }

  _initSettings(reuse) {
    this._prepareBinary();
    const self = this;
    this.log(
      `Init nexrender — binary=${this.config.aerenderPath} workpath=${this.config.nexrenderWorkpath} reuse=${reuse}`
    );
    return withBlockedProcessExit(() => nexrender.init({
      workpath: this.config.nexrenderWorkpath,
      binary: this.config.aerenderPath,
      skipCleanup: true,
      stopOnError: true,
      reuse,
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

  _getSettings(reuse) {
    if (reuse) {
      if (!this.settingsReuse) this.settingsReuse = this._initSettings(true);
      return this.settingsReuse;
    }
    if (!this.settingsFresh) this.settingsFresh = this._initSettings(false);
    return this.settingsFresh;
  }

  async _renderOnce(nexrenderConfig, settings, { onProgress, onStateChange, onError }) {
    const composition = nexrenderConfig?.template?.composition;
    nexrenderConfig.onChange = (job, state) => {
      this.log(`Render state: ${state}`);
      onStateChange?.(state);
    };
    nexrenderConfig.onRenderProgress = (job, percent) => onProgress?.(percent);
    nexrenderConfig.onRenderError = (job, err) => {
      this.log(`Render error: ${err?.message || err}`, 'error');
      onError?.(err);
    };

    const result = await nexrender.render(nexrenderConfig, settings);
    this.log(`Render finished — comp=${composition}`);
    return result;
  }

  async renderJob(nexrenderConfig, hooks = {}) {
    await this.ensureAeWarm();

    const composition = nexrenderConfig?.template?.composition;
    this.log(
      `Starting render — comp=${composition} useOriginal=${Boolean(nexrenderConfig?.template?.useOriginal)} template=${nexrenderConfig?.template?.src}`
    );

    // Prefer -reuse when AE is ready; fall back to a fresh aerender instance if Apple Events fail.
    const tryReuse = !this._reuseDisabled && Boolean(this._aeReady?.ready);

    if (tryReuse) {
      try {
        this.log('Trying aerender -reuse against the open After Effects instance…');
        return await this._renderOnce(nexrenderConfig, this._getSettings(true), hooks);
      } catch (err) {
        if (!isReuseAppleEventFailure(err)) {
          this.log(`Render threw: ${err?.message || err}`, 'error');
          throw err;
        }
        this.log(
          `Reuse failed (${err.message || err}) — retrying without -reuse (new AE instance)`,
          'warn'
        );
        this._reuseDisabled = true;
      }
    } else {
      this.log('Using fresh aerender instance (reuse unavailable)');
    }

    try {
      return await this._renderOnce(nexrenderConfig, this._getSettings(false), hooks);
    } catch (err) {
      this.log(`Render threw: ${err?.message || err}`, 'error');
      throw err;
    }
  }
}

module.exports = { NexrenderRunner };
