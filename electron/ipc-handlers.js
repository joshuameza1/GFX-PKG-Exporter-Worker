const { shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

function registerIpcHandlers(ipcMain, services) {
  const { jobStore, socketClient, templateParser, config, processor } = services;

  ipcMain.handle('get-jobs', () => {
    return jobStore.getAll();
  });

  ipcMain.handle('get-socket-status', () => {
    return socketClient.getStatus();
  });

  ipcMain.handle('get-template-info', () => {
    if (!templateParser) return null;
    return templateParser.getCurrentInfo();
  });

  ipcMain.handle('get-config', () => {
    return {
      socketIoUrl: config.socketIoUrl,
      watchFolder: config.watchFolder,
      renderFolder: config.renderFolder,
      cdnUrl: config.cdnUrl,
      hostname: os.hostname(),
    };
  });

  ipcMain.handle('test-render', async (event, data) => {
    const { graphic, fields } = data;

    const request = {
      timestamp: new Date().toLocaleString(),
      job_status: 'Rendering Final...',
      request_id: `test_${Date.now()}`,
      user_id: 'local',
      display_name: 'Test Render',
      campus: '',
      gfxpkg: graphic.gfxpkg || 'GFX',
      type: graphic.button.name,
      preview: graphic.comp_settings.preview_frame,
      preview_frame: graphic.comp_settings.preview_frame,
      final_frames: graphic.comp_settings.final_frames,
    };

    for (const input of graphic.text_inputs || []) {
      const val = fields[input.action_id] || '';
      if (input.action_id === 'Line_One') {
        request['Line_One*'] = val;
      } else {
        request[input.action_id] = val;
      }
    }

    for (const cb of graphic.checkbox_inputs || []) {
      request[cb.action_id] = fields[cb.action_id] || 0;
    }

    const isL3rd = graphic.button.name.toLowerCase().includes('l3rd');
    if (isL3rd) {
      request.outputExt = 'mov';
      request.outputModule = request.Chroma === 1 ? 'ProRes422' : 'ProRes+Alpha';
    } else {
      request.outputExt = 'jpg';
      request.outputModule = 'JPG';
    }

    try {
      const job = jobStore.enqueue(request);
      processor.nudge();

      return new Promise((resolve) => {
        const onComplete = (completedData) => {
          if (completedData.id === job.id) {
            processor.removeListener('job:completed', onComplete);
            processor.removeListener('job:failed', onFail);
            resolve({ success: true, file: completedData.localPath || completedData.fileLink });
          }
        };
        const onFail = (failedData) => {
          if (failedData.id === job.id) {
            processor.removeListener('job:completed', onComplete);
            processor.removeListener('job:failed', onFail);
            resolve({ success: false, error: failedData.errorMessage });
          }
        };
        processor.on('job:completed', onComplete);
        processor.on('job:failed', onFail);
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-ae-status', () => {
    const aerenderPath = config.aerenderPath;
    if (!fs.existsSync(aerenderPath)) {
      return { status: 'not-found', version: null };
    }
    return new Promise((resolve) => {
      execFile(aerenderPath, ['-help'], { timeout: 5000 }, (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');
        const match = output.match(/aerender version (\S+)/);
        resolve({
          status: 'ready',
          version: match ? match[1] : 'installed',
        });
      });
    });
  });

  ipcMain.handle('clear-jobs', () => {
    jobStore.clearAll();
    return jobStore.getAll();
  });

  ipcMain.handle('pick-aepx-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Select .aepx package',
      filters: [{ name: 'After Effects Project', extensions: ['aepx'] }],
      properties: ['openFile'],
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle('load-package', async (_, filePath) => {
    const dest = path.join(config.watchFolder, path.basename(filePath));
    fs.copyFileSync(filePath, dest);
    await templateParser.addPackage(dest); // starts not-live
    return templateParser.getCurrentInfo();
  });

  ipcMain.handle('set-package-live', (_, { filePath, isLive }) => {
    templateParser.setLive(filePath, isLive);
    const liveGraphics = templateParser.getLiveGraphics();
    socketClient.emit('updateSlackAppUI', liveGraphics);
    return templateParser.getCurrentInfo();
  });

  ipcMain.handle('remove-package', (_, filePath) => {
    templateParser.removePackage(filePath);

    // Move file to _PastBrandings/<YYYY-MM-DD>/ inside the watch folder
    if (fs.existsSync(filePath)) {
      const dateStr = new Date().toISOString().slice(0, 10);
      const archiveDir = path.join(config.watchFolder, '_PastBrandings', dateStr);
      fs.mkdirSync(archiveDir, { recursive: true });
      const dest = path.join(archiveDir, path.basename(filePath));
      fs.renameSync(filePath, dest);
    }

    const liveGraphics = templateParser.getLiveGraphics();
    socketClient.emit('updateSlackAppUI', liveGraphics);
    return templateParser.getCurrentInfo();
  });

  ipcMain.handle('move-package', (_, { filePath, direction }) => {
    templateParser.movePackage(filePath, direction);
    return templateParser.getCurrentInfo();
  });

  ipcMain.handle('refire-job', (_, jobId) => {
    const job = jobStore.getById(jobId);
    if (!job) return null;

    if (job.status === 'failed') {
      jobStore.resetJob(jobId);
      processor.nudge();
    } else if (job.status === 'completed') {
      const request = typeof job.request === 'string' ? JSON.parse(job.request) : job.request;
      socketClient.emit('finalDone', [request, job.local_path, job.result_link]);
    }

    return jobStore.getAll();
  });

  ipcMain.handle('open-file', (_, filePath) => {
    shell.openPath(filePath);
  });

  ipcMain.handle('show-in-folder', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('get-video-poster', (_, filePath) => {
    const tmpDir = path.join(os.tmpdir(), 'gfx-video-posters');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const fileName = path.basename(filePath);
    const posterPath = path.join(tmpDir, `${fileName}.png`);

    if (fs.existsSync(posterPath)) return posterPath;

    return new Promise((resolve) => {
      execFile('qlmanage', ['-t', '-s', '800', '-o', tmpDir, filePath], { timeout: 15000 }, (err) => {
        resolve(fs.existsSync(posterPath) ? posterPath : null);
      });
    });
  });

  ipcMain.handle('get-video-preview', (_, filePath) => {
    const ffmpegPaths = [
      '/opt/homebrew/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      'ffmpeg',
    ];
    const ffmpeg = ffmpegPaths.find((p) => {
      try { return p === 'ffmpeg' || fs.existsSync(p); } catch { return false; }
    });
    if (!ffmpeg) return null;

    const tmpDir = path.join(os.tmpdir(), 'gfx-video-previews');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const previewPath = path.join(tmpDir, `${path.basename(filePath, path.extname(filePath))}_preview.mp4`);
    if (fs.existsSync(previewPath)) return previewPath;

    return new Promise((resolve) => {
      execFile(ffmpeg, [
        '-i', filePath,
        '-vf', 'scale=1280:-2',
        '-c:v', 'libx264',
        '-crf', '22',
        '-preset', 'fast',
        '-an',           // no audio — these are graphics
        '-y',
        previewPath,
      ], { timeout: 120000 }, (err) => {
        resolve(!err && fs.existsSync(previewPath) ? previewPath : null);
      });
    });
  });
}

module.exports = { registerIpcHandlers };
