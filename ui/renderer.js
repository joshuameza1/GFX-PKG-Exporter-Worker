const MAX_LOG = 200;
let currentFilter = 'all';
let allJobs = [];
let logEntries = [];
let selectedComp = null;
let testRenderState = null; // null | { status: 'rendering', percent, elapsed } | { status: 'done', file } | { status: 'failed', error }

// Cache of localPath -> posterPath (or null if failed)
const videoPosterCache = new Map();

async function getVideoPoster(localPath, onReady) {
  if (videoPosterCache.has(localPath)) {
    const cached = videoPosterCache.get(localPath);
    if (cached) onReady(cached);
    return;
  }
  videoPosterCache.set(localPath, 'loading');
  const posterPath = await window.api.getVideoPoster(localPath);
  videoPosterCache.set(localPath, posterPath || null);
  if (posterPath) onReady(posterPath);
}

// ===== Page navigation =====
document.querySelectorAll('[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.add('active');
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
  });
});

// ===== Filter bar =====
document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderJobs();
  });
});

// ===== Clear log =====
document.getElementById('clear-log-btn')?.addEventListener('click', () => {
  logEntries = [];
  renderFullLog();
});

// ===== Add package =====
document.getElementById('add-package-btn')?.addEventListener('click', async () => {
  const filePath = await window.api.pickAepxFile();
  if (filePath) {
    const info = await window.api.loadPackage(filePath);
    if (info) renderPackageTree(info);
  }
});

// ===== Clear jobs =====
document.getElementById('clear-jobs-btn')?.addEventListener('click', async () => {
  allJobs = await window.api.clearJobs();
  renderJobs();
});

// ===== Helpers =====
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getFieldsFromRequest(request) {
  const meta = new Set([
    'timestamp', 'job_status', 'request_id', 'user_id', 'display_name',
    'campus', 'gfxpkg', 'type', 'preview', 'preview_frame', 'final_frames',
    'outputModule', 'outputExt',
  ]);
  const fields = [];
  for (const [key, value] of Object.entries(request)) {
    if (!meta.has(key)) {
      fields.push({ key, value });
    }
  }
  return fields;
}

// ===== Render jobs =====
function renderJobs() {
  const list = document.getElementById('job-list');
  const countEl = document.getElementById('job-count');

  const filtered = currentFilter === 'all'
    ? allJobs
    : allJobs.filter((j) => j.status === currentFilter);

  countEl.textContent = `${filtered.length} job${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">No jobs yet</div>';
    return;
  }

  const videoJobs = [];
  list.innerHTML = filtered.map((job) => {
    const req = typeof job.request === 'string' ? JSON.parse(job.request) : job.request;
    const progress = job.status === 'completed' ? 100 : (job.progress || 0);
    const badgeClass = `badge-${job.status}`;
    const statusLabel = job.status === 'pending' ? 'Queued' : job.status.charAt(0).toUpperCase() + job.status.slice(1);

    const fields = getFieldsFromRequest(req);
    const fieldSummary = fields
      .filter(f => typeof f.value === 'string' && f.value)
      .slice(0, 3)
      .map(f => `${f.key.replace(/_/g, ' ')}: "${escapeHtml(f.value)}"`)
      .join(' · ');

    let extra = '';

    if (job.status === 'rendering') {
      extra = `
        <div class="progress-bg"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="job-meta">
          <span>${fieldSummary}</span>
          <span>${progress}%</span>
        </div>`;
    } else if (job.status === 'failed') {
      extra = `
        <div class="job-error">⚠ ${escapeHtml(job.error_message || 'Unknown error')}</div>
        <div class="job-refire-row">
          <button class="refire-btn" data-action="refire-job" data-job-id="${job.id}">↺ Retry render</button>
        </div>`;
    } else if (job.status === 'completed') {
      const localPath = job.local_path || '';
      const cdnLink = job.result_link || '';
      const fileName = localPath ? localPath.split('/').pop() : cdnLink.split('/').pop();
      const isImage = fileName.endsWith('.jpg') || fileName.endsWith('.png');
      const isVideo = fileName.endsWith('.mov') || fileName.endsWith('.mp4');
      const thumbId = `thumb-${job.id}`;
      const thumbHtml = localPath && isImage
        ? `<div class="result-thumb" id="${thumbId}"><img src="file://${escapeHtml(localPath)}"></div>`
        : localPath && isVideo
        ? `<div class="result-thumb video-thumb" id="${thumbId}"><span class="video-thumb-icon">▶</span></div>`
        : '';
      if (localPath && isVideo) videoJobs.push({ id: job.id, localPath });

      let actionsHtml = '';
      if (localPath) {
        actionsHtml += `<button class="link-btn" data-action="open-file" data-path="${escapeHtml(localPath)}">Open file</button>`;
        actionsHtml += `<button class="link-btn" data-action="show-in-folder" data-path="${escapeHtml(localPath)}">Show in Finder</button>`;
      }
      if (cdnLink) {
        actionsHtml += `<button class="link-btn" data-action="copy-cdn" data-url="${escapeHtml(cdnLink)}">Copy CDN link</button>`;
      }
      actionsHtml += `<button class="link-btn resend-btn" data-action="refire-job" data-job-id="${job.id}" title="Re-deliver result to user's Slack App Home">↑ Resend to Slack</button>`;

      extra = `
        <div class="job-result">
          ${thumbHtml}
          <div class="result-info">
            <div class="result-file">${escapeHtml(fileName)}</div>
            <div class="result-actions">${actionsHtml}</div>
          </div>
        </div>`;
    } else if (job.status === 'pending') {
      extra = fieldSummary ? `<div class="job-meta"><span>${fieldSummary}</span></div>` : '';
    }

    return `
      <div class="job-card" data-status="${job.status}" data-id="${job.id}">
        <div class="job-top">
          <div>
            <span class="job-name">${escapeHtml(req.type || 'Unknown')}</span>
            <span class="job-user">${escapeHtml(req.display_name || req.user_id || '')}</span>
          </div>
          <span class="badge ${badgeClass}">${statusLabel}</span>
        </div>
        ${extra}
      </div>`;
  }).join('');

  // Async: fill video thumbnails once qlmanage generates posters
  for (const { id, localPath } of videoJobs) {
    getVideoPoster(localPath, (posterPath) => {
      const el = document.getElementById(`thumb-${id}`);
      if (el) el.innerHTML = `<img src="file://${escapeHtml(posterPath)}" style="width:100%;height:100%;object-fit:cover">`;
    });
  }
}

// ===== Log rendering =====
function renderLogRow(entry) {
  const level = entry.level || 'info';
  let icon = '·';
  if (level === 'error') icon = '✕';
  else if (level === 'warn') icon = '!';
  else if (entry.message.includes('ompleted')) icon = '✓';
  else if (entry.message.includes('onnected')) icon = '⚡';
  else if (entry.message.includes('tarted') || entry.message.includes('queued')) icon = '→';

  return `<div class="log-row ${level}">
    <span class="log-time">${formatTime(entry.timestamp)}</span>
    <span class="log-icon">${icon}</span>
    <span>${escapeHtml(entry.message)}</span>
  </div>`;
}

function renderFullLog() {
  const el = document.getElementById('full-log');
  el.innerHTML = logEntries.map(renderLogRow).join('');
  el.scrollTop = el.scrollHeight;
}

function addLog(entry) {
  logEntries.push(entry);
  if (logEntries.length > MAX_LOG) logEntries.shift();
  renderFullLog();
}

// ===== Template tree =====
function renderPackageTree(templateInfo) {
  const tree = document.getElementById('package-tree');
  const packages = templateInfo && templateInfo.packages;

  if (!packages || packages.length === 0) {
    tree.innerHTML = '<div class="empty-state" style="padding:20px; font-size:12px;">No packages loaded</div>';
    return;
  }

  // Build a flat index of all graphics across all packages for selectComp
  const allGraphics = [];
  packages.forEach((pkg) => allGraphics.push(...pkg.graphics));

  const total = packages.length;

  tree.innerHTML = packages.map((pkg, pkgIdx) => {
    const compsHtml = pkg.graphics.map((g) => {
      const globalIdx = allGraphics.indexOf(g);
      const active = selectedComp && selectedComp.globalIndex === globalIdx ? 'active' : '';
      return `<div class="comp-item ${active}" data-global-index="${globalIdx}">${escapeHtml(g.button.name)}</div>`;
    }).join('');

    const liveBtn = pkg.isLive
      ? `<span class="pkg-live-badge" data-file-path="${escapeHtml(pkg.filePath)}" data-live="true">Live</span>`
      : `<button class="pkg-make-live-btn" data-file-path="${escapeHtml(pkg.filePath)}" data-live="false">Make live</button>`;

    const upDisabled = pkgIdx === 0 ? 'disabled' : '';
    const downDisabled = pkgIdx === total - 1 ? 'disabled' : '';

    return `
      <div class="pkg-header" data-pkg="${pkgIdx}" data-file-path="${escapeHtml(pkg.filePath)}">
        <svg class="pkg-chevron expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <span class="pkg-name">${escapeHtml(pkg.name)}</span>
        ${liveBtn}
        <div class="pkg-order-controls">
          <button class="pkg-order-btn pkg-move-up" data-file-path="${escapeHtml(pkg.filePath)}" ${upDisabled} title="Move up">↑</button>
          <button class="pkg-order-btn pkg-move-down" data-file-path="${escapeHtml(pkg.filePath)}" ${downDisabled} title="Move down">↓</button>
          <button class="pkg-delete-btn" data-file-path="${escapeHtml(pkg.filePath)}" title="Remove package">×</button>
        </div>
      </div>
      <div class="comp-list" data-pkg="${pkgIdx}">${compsHtml}</div>
    `;
  }).join('');

  // Chevron collapse
  tree.querySelectorAll('.pkg-header').forEach((hdr) => {
    hdr.addEventListener('click', (e) => {
      if (e.target.closest('.pkg-live-badge, .pkg-make-live-btn, .pkg-order-controls')) return;
      const chevron = hdr.querySelector('.pkg-chevron');
      const compList = tree.querySelector(`.comp-list[data-pkg="${hdr.dataset.pkg}"]`);
      chevron.classList.toggle('expanded');
      if (compList) compList.style.display = chevron.classList.contains('expanded') ? '' : 'none';
    });
  });

  // Live toggle
  tree.querySelectorAll('.pkg-live-badge[data-live], .pkg-make-live-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filePath = btn.dataset.filePath;
      const isCurrentlyLive = btn.dataset.live === 'true';
      const updated = await window.api.setPackageLive(filePath, !isCurrentlyLive);
      if (updated) renderPackageTree(updated);
    });
  });

  // Move up / move down
  tree.querySelectorAll('.pkg-move-up, .pkg-move-down').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const direction = btn.classList.contains('pkg-move-up') ? 'up' : 'down';
      const updated = await window.api.movePackage(btn.dataset.filePath, direction);
      if (updated) renderPackageTree(updated);
    });
  });

  // Delete package
  tree.querySelectorAll('.pkg-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filePath = btn.dataset.filePath;
      const name = filePath.split('/').pop().replace('.aepx', '');
      if (!confirm(`Archive "${name}"?\n\nThe file will be moved to _PastBrandings in your watch folder.`)) return;
      const updated = await window.api.removePackage(filePath);
      if (updated) renderPackageTree(updated);
    });
  });

  // Comp selection
  tree.querySelectorAll('.comp-item').forEach((item) => {
    item.addEventListener('click', () => {
      const globalIdx = parseInt(item.dataset.globalIndex);
      selectComp(globalIdx, allGraphics[globalIdx]);
      tree.querySelectorAll('.comp-item').forEach((c) => c.classList.remove('active'));
      item.classList.add('active');
    });
  });
}

// ===== Composition detail =====
function selectComp(globalIndex, graphic) {
  selectedComp = { globalIndex, graphic };
  testRenderState = null;
  renderCompDetail();
}

function renderCompDetail() {
  const detail = document.getElementById('template-detail');
  if (!selectedComp) {
    detail.innerHTML = '<div class="empty-state">Select a composition to view details</div>';
    return;
  }

  const g = selectedComp.graphic;
  const fieldsHtml = (g.text_inputs || []).map((input) => `
    <div class="field-group">
      <div class="field-label">
        <span class="field-dot text"></span>
        ${escapeHtml(input.name.replace(/\*$/, ''))}${input.required ? ' *' : ''}
      </div>
      <input type="text" class="field-input" data-field="${escapeHtml(input.action_id)}" placeholder="Enter text...">
    </div>
  `).join('');

  const checksHtml = (g.checkbox_inputs || []).map((cb) => `
    <div class="field-group">
      <div class="check-row">
        <input type="checkbox" id="check-${escapeHtml(cb.action_id)}" data-field="${escapeHtml(cb.action_id)}">
        <label for="check-${escapeHtml(cb.action_id)}">${escapeHtml(cb.name)}</label>
      </div>
    </div>
  `).join('');

  const frames = g.comp_settings.final_frames;
  const frameInfo = frames.length === 1
    ? `${frames[0].start_frame} – ${frames[0].end_frame}${frames[0].start_frame === frames[0].end_frame ? ' (single)' : ''}`
    : `${frames.length} segments`;

  const isL3rd = g.button.name.toLowerCase().includes('l3rd');
  const format = isL3rd ? 'MOV (ProRes)' : 'JPG';
  const resolution = '1920 × 1080';

  let renderPanelHtml;

  if (testRenderState && testRenderState.status === 'rendering') {
    renderPanelHtml = `
      <div class="render-progress">
        <div class="spinner"></div>
        <div class="render-progress-text">
          <div class="render-progress-label">Rendering...</div>
          <div class="render-progress-detail">${testRenderState.percent || 0}%</div>
        </div>
        <div style="width:100%">
          <div class="progress-bg"><div class="progress-fill" style="width:${testRenderState.percent || 0}%"></div></div>
        </div>
      </div>`;
  } else if (testRenderState && testRenderState.status === 'done') {
    const file = testRenderState.file || '';
    const isImage = file.endsWith('.jpg') || file.endsWith('.png');
    const isVideo = file.endsWith('.mov') || file.endsWith('.mp4');
    const previewHtml = isImage
      ? `<div class="render-result-preview"><img src="file://${escapeHtml(file)}" alt="Render result"></div>`
      : isVideo
      ? `<div class="render-result-preview" id="test-render-poster"><div class="video-poster-loading">Transcoding preview…</div></div>`
      : '';

    renderPanelHtml = `
      <div class="render-result">
        <div class="render-result-status">✓ Completed</div>
        ${previewHtml}
        <div class="render-result-actions">
          <button class="result-action-btn" data-action="open-file" data-path="${escapeHtml(file)}">Open</button>
          <button class="result-action-btn" data-action="show-in-folder" data-path="${escapeHtml(file)}">Finder</button>
        </div>
      </div>`;
  } else if (testRenderState && testRenderState.status === 'failed') {
    renderPanelHtml = `
      <div class="render-result">
        <div class="render-result-status failed">✕ Failed</div>
        <div style="font-size:12px; color:var(--red); margin-bottom:12px;">${escapeHtml(testRenderState.error)}</div>
      </div>`;
  } else {
    renderPanelHtml = `
      <div class="render-info">
        <div class="render-info-row"><span class="render-info-key">Format</span><span class="render-info-val">${format}</span></div>
        <div class="render-info-row"><span class="render-info-key">Resolution</span><span class="render-info-val">${resolution}</span></div>
        <div class="render-info-row"><span class="render-info-key">Frames</span><span class="render-info-val">${frameInfo}</span></div>
        <div class="render-info-row"><span class="render-info-key">Renders</span><span class="render-info-val">${frames.length} output${frames.length > 1 ? 's' : ''}</span></div>
      </div>`;
  }

  const btnLabel = testRenderState && testRenderState.status === 'done' ? 'Re-render' : 'Test render';
  const btnIcon = testRenderState && testRenderState.status === 'done' ? '↻' : '▶';
  const btnDisabled = testRenderState && testRenderState.status === 'rendering' ? 'disabled' : '';

  detail.innerHTML = `
    <div class="detail-header">
      <span class="detail-title">${escapeHtml(g.button.name)}</span>
    </div>
    <div class="detail-panel">
      <div class="detail-grid">
        <div class="detail-fields">
          ${fieldsHtml}
          ${checksHtml}
          <button class="test-render-btn" id="test-render-btn" ${btnDisabled}>
            ${btnIcon} ${btnLabel}
          </button>
        </div>
        <div class="detail-render">
          ${renderPanelHtml}
        </div>
      </div>
    </div>
  `;

  document.getElementById('test-render-btn')?.addEventListener('click', handleTestRender);

  // If a video result is shown, transcode to H.264 for in-app playback
  if (testRenderState && testRenderState.status === 'done') {
    const file = testRenderState.file || '';
    const isVideo = file.endsWith('.mov') || file.endsWith('.mp4');
    if (isVideo) {
      loadVideoPreview(file);
    }
  }
}

async function loadVideoPreview(file) {
  const el = document.getElementById('test-render-poster');
  if (!el) return;

  // Try H.264 transcode first (enables actual playback)
  const previewPath = await window.api.getVideoPreview(file);
  if (previewPath) {
    const posterEl = document.getElementById('test-render-poster');
    if (posterEl) {
      posterEl.innerHTML = `<video src="file://${escapeHtml(previewPath)}" controls style="width:100%;display:block;background:#000;max-height:300px;"></video>`;
    }
    return;
  }

  // Fall back to qlmanage still frame
  getVideoPoster(file, (posterPath) => {
    const posterEl = document.getElementById('test-render-poster');
    if (posterEl) posterEl.innerHTML = `<img src="file://${escapeHtml(posterPath)}" style="width:100%;display:block;border-radius:6px;">`;
  });
}

async function handleTestRender() {
  if (!selectedComp) return;

  const g = selectedComp.graphic;
  const fields = {};

  document.querySelectorAll('.detail-fields .field-input').forEach((input) => {
    fields[input.dataset.field] = input.value;
  });

  document.querySelectorAll('.detail-fields input[type="checkbox"]').forEach((cb) => {
    fields[cb.dataset.field] = cb.checked ? 1 : 0;
  });

  testRenderState = { status: 'rendering', percent: 0 };
  renderCompDetail();

  try {
    const result = await window.api.testRender({
      graphic: g,
      fields,
    });

    if (result.success) {
      testRenderState = { status: 'done', file: result.file };
    } else {
      testRenderState = { status: 'failed', error: result.error };
    }
  } catch (err) {
    testRenderState = { status: 'failed', error: err.message };
  }

  renderCompDetail();
}

// ===== Status updates =====
function updateServerStatus(status) {
  const dot = document.getElementById('server-dot');
  const text = document.getElementById('server-status');
  dot.className = 'dot';

  const networkDot = document.getElementById('network-dot');
  const workerStatus = document.getElementById('network-worker-status');

  if (status === 'connected') {
    dot.classList.add('green');
    text.textContent = 'Connected';
    if (networkDot) { networkDot.className = 'dot green'; }
    if (workerStatus) workerStatus.textContent = 'Online';
  } else if (status === 'connecting') {
    dot.classList.add('yellow');
    text.textContent = 'Connecting';
    if (networkDot) { networkDot.className = 'dot yellow'; }
    if (workerStatus) workerStatus.textContent = 'Connecting';
  } else {
    dot.classList.add('red');
    text.textContent = 'Disconnected';
    if (networkDot) { networkDot.className = 'dot red'; }
    if (workerStatus) workerStatus.textContent = 'Offline';
  }
}

// ===== IPC event listeners =====
window.api.onSocketStatus((status) => {
  updateServerStatus(status);
});

window.api.onQueueUpdated(() => refreshJobs());

window.api.onJobProgress((data) => {
  const card = document.querySelector(`.job-card[data-id="${data.id}"]`);
  if (card) {
    const fill = card.querySelector('.progress-fill');
    if (fill) fill.style.width = `${data.percent}%`;
    const meta = card.querySelector('.job-meta span:last-child');
    if (meta) meta.textContent = `${data.percent}%`;
  }

  if (testRenderState && testRenderState.status === 'rendering') {
    testRenderState.percent = data.percent;
    const spinner = document.querySelector('.render-progress');
    if (spinner) {
      const pct = spinner.querySelector('.render-progress-detail');
      if (pct) pct.textContent = `${data.percent}%`;
      const fill = spinner.querySelector('.progress-fill');
      if (fill) fill.style.width = `${data.percent}%`;
    }
  }
});

window.api.onLog((entry) => addLog(entry));

window.api.onTemplateUpdated((info) => {
  if (info) {
    const pkgCount = info.packages ? info.packages.length : 0;
    const liveCount = info.packages ? info.packages.filter((p) => p.isLive).length : 0;
    document.getElementById('template-comp-count').textContent = `${info.compositionCount} comp${info.compositionCount !== 1 ? 's' : ''}`;
    document.getElementById('template-name').textContent =
      pkgCount === 0 ? 'No packages' :
      pkgCount === 1 ? info.packages[0].name :
      `${liveCount} of ${pkgCount} live`;
    renderPackageTree(info);
  }
});

window.api.onTestRenderComplete((result) => {
  if (result.success) {
    testRenderState = { status: 'done', file: result.file };
  } else {
    testRenderState = { status: 'failed', error: result.error };
  }
  renderCompDetail();
});

// ===== Refresh jobs =====
async function refreshJobs() {
  allJobs = await window.api.getJobs();
  renderJobs();
}

// ===== Initial load =====
async function init() {
  refreshJobs();

  const status = await window.api.getSocketStatus();
  updateServerStatus(status || 'disconnected');

  const templateInfo = await window.api.getTemplateInfo();
  if (templateInfo) {
    const pkgCount = templateInfo.packages ? templateInfo.packages.length : 0;
    const liveCount = templateInfo.packages ? templateInfo.packages.filter((p) => p.isLive).length : 0;
    document.getElementById('template-comp-count').textContent =
      `${templateInfo.compositionCount} comp${templateInfo.compositionCount !== 1 ? 's' : ''}`;
    document.getElementById('template-name').textContent =
      pkgCount === 0 ? 'No packages' :
      pkgCount === 1 ? templateInfo.packages[0].name :
      `${liveCount} of ${pkgCount} live`;
    renderPackageTree(templateInfo);
  }

  const config = await window.api.getConfig();
  if (config) {
    document.getElementById('server-url').textContent = config.socketIoUrl || '—';
    document.getElementById('setting-watch-folder').textContent = config.watchFolder || '—';
    document.getElementById('setting-render-folder').textContent = config.renderFolder || '—';
    document.getElementById('setting-cdn-url').textContent = config.cdnUrl || '—';
    document.getElementById('network-url').textContent = config.socketIoUrl || '—';
    if (config.hostname) {
      const workerHostname = document.getElementById('worker-hostname');
      if (workerHostname) workerHostname.textContent = config.hostname;
      const networkWorkerName = document.getElementById('network-worker-name');
      if (networkWorkerName) networkWorkerName.textContent = config.hostname;
    }
  }

  const ae = await window.api.getAeStatus();
  const aeDot = document.getElementById('ae-dot');
  const aeStatus = document.getElementById('ae-status');
  const aeVersion = document.getElementById('ae-version');
  if (ae && ae.status === 'ready') {
    aeDot.className = 'dot green';
    aeStatus.textContent = 'Ready';
    aeVersion.textContent = ae.version ? `AE ${ae.version}` : 'Installed';
    const workerAeInfo = document.getElementById('worker-ae-info');
    if (workerAeInfo) workerAeInfo.innerHTML = `<span class="dot green" style="width:6px;height:6px;display:inline-block;border-radius:50%;flex-shrink:0"></span> ${ae.version ? `AE ${ae.version}` : 'Installed'}`;
  } else {
    aeDot.className = 'dot red';
    aeStatus.textContent = 'Not found';
    aeVersion.textContent = '—';
    const workerAeInfo = document.getElementById('worker-ae-info');
    if (workerAeInfo) workerAeInfo.innerHTML = `<span class="dot red" style="width:6px;height:6px;display:inline-block;border-radius:50%;flex-shrink:0"></span> Not found`;
  }

}

// ===== File action delegation =====
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'open-file') {
    window.api.openFile(btn.dataset.path);
  } else if (action === 'show-in-folder') {
    window.api.showInFolder(btn.dataset.path);
  } else if (action === 'copy-cdn') {
    try {
      await navigator.clipboard.writeText(btn.dataset.url);
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch (_) {}
  } else if (action === 'refire-job') {
    const orig = btn.textContent;
    btn.textContent = 'Firing…';
    btn.disabled = true;
    const updatedJobs = await window.api.refireJob(btn.dataset.jobId);
    if (updatedJobs) {
      allJobs = updatedJobs.map((j) => ({ ...j, request: typeof j.request === 'string' ? JSON.parse(j.request) : j.request }));
      renderJobs();
    } else {
      btn.textContent = orig;
      btn.disabled = false;
    }
  }
});

init();
