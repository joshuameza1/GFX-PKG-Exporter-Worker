const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getJobs: () => ipcRenderer.invoke('get-jobs'),
  getSocketStatus: () => ipcRenderer.invoke('get-socket-status'),
  getTemplateInfo: () => ipcRenderer.invoke('get-template-info'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  testRender: (data) => ipcRenderer.invoke('test-render', data),
  getAeStatus: () => ipcRenderer.invoke('get-ae-status'),
  clearJobs: () => ipcRenderer.invoke('clear-jobs'),
  refireJob: (jobId) => ipcRenderer.invoke('refire-job', jobId),
  pickAepxFile: () => ipcRenderer.invoke('pick-aepx-file'),
  loadPackage: (filePath) => ipcRenderer.invoke('load-package', filePath),
  setPackageLive: (filePath, isLive) => ipcRenderer.invoke('set-package-live', { filePath, isLive }),
  removePackage: (filePath) => ipcRenderer.invoke('remove-package', filePath),
  setLayout: (layout) => ipcRenderer.invoke('set-layout', layout),
  createFolder: (name) => ipcRenderer.invoke('create-folder', name),
  renameFolder: (oldName, newName) => ipcRenderer.invoke('rename-folder', { oldName, newName }),
  deleteFolder: (name) => ipcRenderer.invoke('delete-folder', name),
  setPackageFolder: (filePath, folderName) => ipcRenderer.invoke('set-package-folder', { filePath, folderName }),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  getVideoPoster: (filePath) => ipcRenderer.invoke('get-video-poster', filePath),
  getVideoPreview: (filePath) => ipcRenderer.invoke('get-video-preview', filePath),

  onQueueUpdated: (cb) => {
    ipcRenderer.on('queue:updated', () => cb());
    return () => ipcRenderer.removeAllListeners('queue:updated');
  },
  onJobProgress: (cb) => {
    ipcRenderer.on('job:progress', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('job:progress');
  },
  onSocketStatus: (cb) => {
    ipcRenderer.on('socket:status', (_, status) => cb(status));
    return () => ipcRenderer.removeAllListeners('socket:status');
  },
  onLog: (cb) => {
    ipcRenderer.on('log', (_, entry) => cb(entry));
    return () => ipcRenderer.removeAllListeners('log');
  },
  onTemplateUpdated: (cb) => {
    ipcRenderer.on('template:updated', (_, info) => cb(info));
    return () => ipcRenderer.removeAllListeners('template:updated');
  },
  onUpdateStatus: (cb) => {
    ipcRenderer.on('update:status', (_, status) => cb(status));
    return () => ipcRenderer.removeAllListeners('update:status');
  },
  onConfigUpdated: (cb) => {
    ipcRenderer.on('config:updated', (_, config) => cb(config));
    return () => ipcRenderer.removeAllListeners('config:updated');
  },
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  openLatestDownload: () => ipcRenderer.invoke('open-latest-download'),
  getLatestUpdate: () => ipcRenderer.invoke('get-latest-update'),
  onTestRenderComplete: (cb) => {
    ipcRenderer.on('test-render:complete', (_, result) => cb(result));
    return () => ipcRenderer.removeAllListeners('test-render:complete');
  },
});
