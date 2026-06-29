const EventEmitter = require('events');
const { NexrenderRunner } = require('../render/nexrender-runner');
const { buildNexrenderConfigs } = require('../render/job-builder');

class JobProcessor extends EventEmitter {
  constructor(jobStore, config) {
    super();
    this.jobStore = jobStore;
    this.config = config;
    this.runner = new NexrenderRunner(config);
    this.running = false;
    this.processing = false;
  }

  start() {
    this.running = true;
    this._tick();
  }

  stop() {
    this.running = false;
  }

  nudge() {
    if (!this.processing) this._tick();
  }

  async _tick() {
    if (!this.running || this.processing) return;

    this.processing = true;
    try {
      let job = this.jobStore.claimNext();
      while (job) {
        await this._processJob(job);
        job = this.jobStore.claimNext();
      }
    } catch (err) {
      console.error('[processor] Tick error:', err);
    } finally {
      this.processing = false;
      if (this.running) {
        setTimeout(() => this._tick(), 2000);
      }
    }
  }

  async _processJob(job) {
    const { id, request } = job;
    try {
      const { requestKey, configs } = buildNexrenderConfigs(request, this.config);

      for (const nexrenderConfig of configs) {
        await this.runner.renderJob(nexrenderConfig, {
          onProgress: (percent) => {
            this.jobStore.updateProgress(id, percent);
            this.emit('job:progress', { id, percent });
          },
          onStateChange: (state) => {
            this.emit('job:state-change', { id, state });
          },
        });
      }

      const fileLink = this._buildFileLink(request, requestKey, configs);
      const localPath = this._buildLocalPath(request, requestKey, configs);
      const filename = `${requestKey}.${request.outputExt}`;
      this.jobStore.markCompleted(id, fileLink, localPath);
      this.emit('job:completed', { id, request, filename, fileLink, localPath });
    } catch (err) {
      const errorMessage = err.message || String(err);
      this.jobStore.markFailed(id, errorMessage);
      this.emit('job:failed', { id, request, errorMessage });
    }
  }

  _buildFileLink(request, requestKey, configs) {
    const prefix = `${this.config.cdnUrl}/${requestKey}`;
    if (configs.length === 1) {
      return `${prefix}/${configs[0]._jobName}.${request.outputExt}`;
    }
    return `${prefix}.zip`;
  }

  _buildLocalPath(request, requestKey, configs) {
    const outputDir = require('path').join(this.config.renderFolder, requestKey);
    if (configs.length === 1) {
      return require('path').join(outputDir, `${configs[0]._jobName}.${request.outputExt}`);
    }
    return outputDir;
  }
}

module.exports = { JobProcessor };
