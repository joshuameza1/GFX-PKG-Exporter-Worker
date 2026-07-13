const EventEmitter = require('events');
const path = require('path');
const { NexrenderRunner } = require('../render/nexrender-runner');
const { buildNexrenderConfigs } = require('../render/job-builder');

const PHASE_PROGRESS = {
  'render:setup': 5,
  'render:predownload': 8,
  'render:download': 10,
  'render:postdownload': 12,
  'render:prerender': 15,
  'render:script': 18,
  'render:dorender': 25,
  'render:postrender': 90,
  'render:cleanup': 96,
};

const PHASE_LABELS = {
  'render:setup': 'Preparing…',
  'render:predownload': 'Preparing…',
  'render:download': 'Preparing assets…',
  'render:postdownload': 'Preparing assets…',
  'render:prerender': 'Preparing…',
  'render:script': 'Preparing script…',
  'render:dorender': 'Rendering via open After Effects…',
  'render:postrender': 'Copying to render folder…',
  'render:cleanup': 'Finishing…',
};

class JobProcessor extends EventEmitter {
  constructor(jobStore, config, log = console.log) {
    super();
    this.jobStore = jobStore;
    this.config = config;
    this.log = typeof log === 'function' ? log : console.log;
    this.runner = new NexrenderRunner(config, this.log);
    this.running = false;
    this.processing = false;
  }

  start() {
    this.running = true;
    // Warm AE in the background so the first job isn't always a full cold start.
    this.runner.ensureAeWarm().catch(() => {});
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
    let lastPercent = 0;
    let heartbeat = null;
    let gotFrameProgress = false;

    const setProgress = (percent, label) => {
      const next = Math.max(0, Math.min(100, Math.round(percent)));
      // Never go backwards except for the final 100.
      if (next < lastPercent && next !== 100) return;
      if (next === lastPercent && !label) return;
      lastPercent = next;
      this.jobStore.updateProgress(id, next);
      this.emit('job:progress', { id, percent: next, label: label || null });
    };

    const stopHeartbeat = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    try {
      setProgress(2, 'Starting…');
      this.log(`Processing job ${id} — ${request.type} (${request.gfxpkg})`);
      const { requestKey, configs, templatePath, packageRoot } = buildNexrenderConfigs(request, this.config);
      this.log(`Template: ${templatePath}`);
      this.log(`Package root: ${packageRoot} — ${configs.length} render pass(es)`);
      setProgress(4, 'Template ready');

      for (const nexrenderConfig of configs) {
        await this.runner.renderJob(nexrenderConfig, {
          onProgress: (percent) => {
            // Single-frame jobs often only report 0%. Don't reset phase progress.
            if (percent <= 0 && lastPercent >= 25) return;
            gotFrameProgress = true;
            stopHeartbeat();
            const mapped = 40 + (Math.max(0, percent) * 0.48);
            setProgress(mapped, 'Rendering frames…');
          },
          onStateChange: (state) => {
            const phasePct = PHASE_PROGRESS[state];
            const label = PHASE_LABELS[state] || state;
            if (phasePct != null) setProgress(phasePct, label);

            if (state === 'render:dorender') {
              // AE cold-start is ~30–50s with no frame progress — fake a steady climb.
              const start = Date.now();
              stopHeartbeat();
              heartbeat = setInterval(() => {
                if (gotFrameProgress) {
                  stopHeartbeat();
                  return;
                }
                const elapsed = (Date.now() - start) / 1000;
                const synthetic = 25 + Math.min(50, elapsed * 0.85);
                setProgress(
                  synthetic,
                  elapsed < 5
                    ? 'Connecting to After Effects…'
                    : 'Rendering via open After Effects…'
                );
              }, 400);
            } else if (state === 'render:postrender' || state === 'render:cleanup') {
              stopHeartbeat();
            }
          },
        });
      }

      stopHeartbeat();
      setProgress(98, 'Publishing link…');

      const fileLink = this._buildFileLink(request, requestKey, configs);
      const localPath = this._buildLocalPath(request, requestKey, configs);
      const filename = `${requestKey}.${request.outputExt}`;
      this.jobStore.markCompleted(id, fileLink, localPath);
      setProgress(100, 'Done');
      this.log(`Job completed: ${id} → ${fileLink}`);
      this.emit('job:completed', { id, request, filename, fileLink, localPath });
    } catch (err) {
      stopHeartbeat();
      const errorMessage = err.message || String(err);
      this.log(`Job ${id} failed: ${errorMessage}`, 'error');
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
    const outputDir = path.join(this.config.renderFolder, requestKey);
    if (configs.length === 1) {
      return path.join(outputDir, `${configs[0]._jobName}.${request.outputExt}`);
    }
    return outputDir;
  }
}

module.exports = { JobProcessor };
