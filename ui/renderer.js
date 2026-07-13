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
  try {
    const filePath = await window.api.pickAepxFile();
    if (!filePath) return;
    const info = await window.api.loadPackage(filePath);
    if (info) renderPackageTree(info);
  } catch (err) {
    alert(err.message || 'Failed to add package');
  }
});

// ===== Add folder =====
document.getElementById('add-folder-btn')?.addEventListener('click', async () => {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;
  const info = await window.api.createFolder(name.trim());
  if (info) renderPackageTree(info);
});

// ===== Sidebar resize =====
(function setupSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  const sidebar = document.querySelector('.template-sidebar');
  if (!handle || !sidebar) return;
  let isResizing = false, startX = 0, startWidth = 0;
  const MIN = 140, MAX = 400;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const w = Math.max(MIN, Math.min(MAX, startWidth + (e.clientX - startX)));
    sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

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

function packageLayoutId(pkg) {
  return pkg.packageId || pkg.name || (pkg.filePath || '').split('/').pop();
}

function buildLayoutFromInfo(info) {
  if (info && info.layout) {
    return {
      folders: (info.layout.folders || []).map((f) => ({
        name: f.name,
        packages: [...(f.packages || [])],
      })),
      ungrouped: [...(info.layout.ungrouped || [])],
    };
  }

  const { packages, folders } = info;
  return {
    folders: (folders || []).map((name) => ({
      name,
      packages: packages.filter((p) => p.folder === name).map(packageLayoutId),
    })),
    ungrouped: packages.filter((p) => !p.folder).map(packageLayoutId),
  };
}

function renderPackageTree(templateInfo) {
  const tree = document.getElementById('package-tree');
  const packages = templateInfo && templateInfo.packages;
  const folders = (templateInfo && templateInfo.folders) || [];

  if (!packages || packages.length === 0) {
    tree.innerHTML = '<div class="empty-state" style="padding:20px; font-size:12px;">No packages loaded</div>';
    return;
  }

  // Flat index for comp selection
  const allGraphics = [];
  packages.forEach((pkg) => allGraphics.push(...pkg.graphics));

  // Group by folder
  const folderMap = {};
  const ungrouped = [];
  for (const pkg of packages) {
    if (pkg.folder) { (folderMap[pkg.folder] = folderMap[pkg.folder] || []).push(pkg); }
    else { ungrouped.push(pkg); }
  }

  let pkgIdx = 0;
  function pkgRowHtml(pkg) {
    const idx = pkgIdx++;
    const compsHtml = pkg.graphics.map((g) => {
      const gi = allGraphics.indexOf(g);
      const active = selectedComp && selectedComp.globalIndex === gi ? 'active' : '';
      return `<div class="comp-item ${active}" data-global-index="${gi}">${escapeHtml(g.button.name)}</div>`;
    }).join('');
    const liveBtn = pkg.isLive
      ? `<span class="pkg-live-badge" data-file-path="${escapeHtml(pkg.filePath)}" data-live="true">Live</span>`
      : `<button class="pkg-make-live-btn" data-file-path="${escapeHtml(pkg.filePath)}" data-live="false">Make live</button>`;
    const kindLabel = pkg.kind === 'folder' ? 'folder' : 'file';
    return `
      <div class="pkg-row" draggable="true" data-drag-type="package" data-package-id="${escapeHtml(packageLayoutId(pkg))}" data-file-path="${escapeHtml(pkg.filePath)}" data-folder="${escapeHtml(pkg.folder || '')}" data-pkg="${idx}" title="${escapeHtml(kindLabel)} package">
        <div class="pkg-header">
          <span class="drag-handle" title="Drag to reorder">⠿</span>
          <svg class="pkg-chevron expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <span class="pkg-name">${escapeHtml(pkg.name)}</span>
          ${liveBtn}
          <button class="pkg-delete-btn" data-file-path="${escapeHtml(pkg.filePath)}" data-package-name="${escapeHtml(pkg.name)}" title="Archive package">×</button>
        </div>
        <div class="comp-list" data-pkg="${idx}">${compsHtml}</div>
      </div>`;
  }

  let html = '';
  for (const folderName of folders) {
    const pkgs = folderMap[folderName] || [];
    html += `
      <div class="folder-group">
        <div class="folder-row" draggable="true" data-drag-type="folder" data-folder-name="${escapeHtml(folderName)}">
          <span class="drag-handle" title="Drag to reorder folders">⠿</span>
          <svg class="folder-chevron expanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          <svg class="folder-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>
          <span class="folder-label">${escapeHtml(folderName)}</span>
          <div class="folder-controls">
            <button class="folder-rename-btn" data-folder="${escapeHtml(folderName)}" title="Rename">✎</button>
            <button class="folder-delete-btn" data-folder="${escapeHtml(folderName)}" title="Delete folder">×</button>
          </div>
        </div>
        <div class="folder-contents" data-drop-folder="${escapeHtml(folderName)}">
          ${pkgs.map(pkgRowHtml).join('')}
          ${pkgs.length === 0 ? '<div class="folder-empty-hint">Drop packages here</div>' : ''}
        </div>
      </div>`;
  }
  html += `<div class="ungrouped-section" data-drop-folder="">${ungrouped.map(pkgRowHtml).join('')}</div>`;
  tree.innerHTML = html;

  // ── Chevron: folders ──
  tree.querySelectorAll('.folder-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.folder-controls, .drag-handle')) return;
      const chevron = row.querySelector('.folder-chevron');
      const contents = row.closest('.folder-group').querySelector('.folder-contents');
      chevron.classList.toggle('expanded');
      if (contents) contents.style.display = chevron.classList.contains('expanded') ? '' : 'none';
    });
  });

  // ── Chevron: packages ──
  tree.querySelectorAll('.pkg-header').forEach((hdr) => {
    hdr.addEventListener('click', (e) => {
      if (e.target.closest('.pkg-live-badge, .pkg-make-live-btn, .pkg-delete-btn, .drag-handle')) return;
      const row = hdr.closest('.pkg-row');
      const chevron = hdr.querySelector('.pkg-chevron');
      const compList = row && row.querySelector('.comp-list');
      chevron.classList.toggle('expanded');
      if (compList) compList.style.display = chevron.classList.contains('expanded') ? '' : 'none';
    });
  });

  // ── Live toggle ──
  tree.querySelectorAll('.pkg-live-badge[data-live], .pkg-make-live-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await window.api.setPackageLive(btn.dataset.filePath, btn.dataset.live !== 'true');
      if (updated) renderPackageTree(updated);
    });
  });

  // ── Archive package ──
  tree.querySelectorAll('.pkg-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = btn.dataset.packageName || btn.dataset.filePath.split('/').pop().replace(/\.aepx$/i, '');
      if (!confirm(`Archive "${name}"?\n\nThe package will be moved to _PastBrandings in your watch folder.`)) return;
      const updated = await window.api.removePackage(btn.dataset.filePath);
      if (updated) renderPackageTree(updated);
    });
  });

  // ── Folder rename ──
  tree.querySelectorAll('.folder-rename-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = prompt('Rename folder:', btn.dataset.folder);
      if (!newName || newName === btn.dataset.folder) return;
      const updated = await window.api.renameFolder(btn.dataset.folder, newName.trim());
      if (updated) renderPackageTree(updated);
    });
  });

  // ── Folder delete ──
  tree.querySelectorAll('.folder-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete folder "${btn.dataset.folder}"?\n\nPackages will move to the top level.`)) return;
      const updated = await window.api.deleteFolder(btn.dataset.folder);
      if (updated) renderPackageTree(updated);
    });
  });

  // ── Comp selection ──
  tree.querySelectorAll('.comp-item').forEach((item) => {
    item.addEventListener('click', () => {
      const gi = parseInt(item.dataset.globalIndex);
      selectComp(gi, allGraphics[gi]);
      tree.querySelectorAll('.comp-item').forEach((c) => c.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // ── Drag-and-drop ──
  wireDragAndDrop(tree, templateInfo);
}

function wireDragAndDrop(tree, templateInfo) {
  let dragging = null; // { type:'package'|'folder', id:packageId|folderName }

  function clearHighlights() {
    tree.querySelectorAll('.drop-before, .drop-after, .drop-into, .dragging').forEach((el) => {
      el.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging');
    });
  }

  function rowPackageId(el) {
    return el?.dataset.packageId || el?.dataset.filePath;
  }

  tree.querySelectorAll('[data-drag-type]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      const type = el.dataset.dragType;
      const id = type === 'package' ? rowPackageId(el) : el.dataset.folderName;
      dragging = { type, id };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => { clearHighlights(); dragging = null; });
  });

  tree.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragging) return;
    clearHighlights();

    const pkgRow = e.target.closest('.pkg-row');
    const folderRow = e.target.closest('.folder-row');
    const dropSection = e.target.closest('[data-drop-folder]');

    if (dragging.type === 'package') {
      if (pkgRow && rowPackageId(pkgRow) !== dragging.id) {
        const mid = pkgRow.getBoundingClientRect().top + pkgRow.getBoundingClientRect().height / 2;
        pkgRow.classList.add(e.clientY < mid ? 'drop-before' : 'drop-after');
      } else if (folderRow && !pkgRow) {
        folderRow.classList.add('drop-into');
      } else if (dropSection && !pkgRow && !folderRow) {
        dropSection.classList.add('drop-into');
      }
    } else if (dragging.type === 'folder') {
      if (folderRow && folderRow.dataset.folderName !== dragging.id && !pkgRow) {
        const mid = folderRow.getBoundingClientRect().top + folderRow.getBoundingClientRect().height / 2;
        folderRow.classList.add(e.clientY < mid ? 'drop-before' : 'drop-after');
      }
    }
  });

  tree.addEventListener('dragleave', (e) => {
    if (!tree.contains(e.relatedTarget)) clearHighlights();
  });

  tree.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragging) return;
    const layout = buildLayoutFromInfo(templateInfo);
    const pkgRow = e.target.closest('.pkg-row');
    const folderRow = e.target.closest('.folder-row');
    const dropSection = e.target.closest('[data-drop-folder]');
    const dragId = dragging.id;

    if (dragging.type === 'package') {
      layout.ungrouped = layout.ungrouped.filter((id) => id !== dragId);
      for (const f of layout.folders) f.packages = f.packages.filter((id) => id !== dragId);

      if (pkgRow && rowPackageId(pkgRow) !== dragId) {
        const targetId = rowPackageId(pkgRow);
        const targetFolder = pkgRow.dataset.folder;
        const rect = pkgRow.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        if (targetFolder) {
          const f = layout.folders.find((folder) => folder.name === targetFolder);
          if (f) {
            const i = Math.max(0, f.packages.indexOf(targetId));
            f.packages.splice(before ? i : i + 1, 0, dragId);
          }
        } else {
          const i = Math.max(0, layout.ungrouped.indexOf(targetId));
          layout.ungrouped.splice(before ? i : i + 1, 0, dragId);
        }
      } else if (folderRow && !pkgRow) {
        const f = layout.folders.find((folder) => folder.name === folderRow.dataset.folderName);
        if (f) f.packages.push(dragId);
      } else if (dropSection && !pkgRow && !folderRow) {
        const targetFolder = dropSection.dataset.dropFolder;
        if (targetFolder) {
          const f = layout.folders.find((folder) => folder.name === targetFolder);
          if (f) f.packages.push(dragId);
        } else {
          layout.ungrouped.push(dragId);
        }
      } else {
        clearHighlights();
        dragging = null;
        return;
      }
    } else if (dragging.type === 'folder') {
      if (folderRow && folderRow.dataset.folderName !== dragging.id && !pkgRow) {
        const dragFolder = layout.folders.find((f) => f.name === dragging.id);
        if (dragFolder) {
          layout.folders = layout.folders.filter((f) => f.name !== dragging.id);
          const i = layout.folders.findIndex((f) => f.name === folderRow.dataset.folderName);
          layout.folders.splice(e.clientY < folderRow.getBoundingClientRect().top + folderRow.getBoundingClientRect().height / 2 ? i : i + 1, 0, dragFolder);
        }
      } else {
        clearHighlights();
        dragging = null;
        return;
      }
    }

    clearHighlights();
    dragging = null;
    const updated = await window.api.setLayout(layout);
    if (updated) renderPackageTree(updated);
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

// ===== App updates =====
let pendingUpdateVersion = null;

function setUpdateUi(state) {
  const statusText = document.getElementById('update-status-text');
  const checkBtn = document.getElementById('check-update-btn');
  const downloadBtn = document.getElementById('download-update-btn');
  const installBtn = document.getElementById('install-update-btn');
  const progressWrap = document.getElementById('update-progress');
  const progressFill = document.getElementById('update-progress-fill');
  const progressLabel = document.getElementById('update-progress-label');

  if (!statusText) return;

  checkBtn.disabled = false;
  downloadBtn.style.display = 'none';
  installBtn.style.display = 'none';
  progressWrap.style.display = 'none';

  switch (state.status) {
    case 'checking':
      statusText.textContent = 'Checking for updates...';
      checkBtn.disabled = true;
      break;
    case 'available':
      pendingUpdateVersion = state.version;
      statusText.textContent = `v${state.version} available`;
      downloadBtn.style.display = 'inline-block';
      break;
    case 'downloading':
      statusText.textContent = `Downloading v${pendingUpdateVersion || ''}`.trim();
      progressWrap.style.display = 'flex';
      progressFill.style.width = `${state.percent || 0}%`;
      progressLabel.textContent = `${state.percent || 0}%`;
      checkBtn.disabled = true;
      break;
    case 'ready':
      statusText.textContent = `v${state.version || pendingUpdateVersion} ready to install`;
      installBtn.style.display = 'inline-block';
      break;
    case 'current':
      statusText.textContent = 'Up to date';
      break;
    case 'error':
      statusText.textContent = state.message || 'Update check failed';
      break;
    case 'dev-mode':
      statusText.textContent = 'Dev mode — updates disabled';
      break;
    default:
      statusText.textContent = 'Ready';
  }
}

document.getElementById('check-update-btn')?.addEventListener('click', async () => {
  setUpdateUi({ status: 'checking' });
  await window.api.checkForUpdates();
});

document.getElementById('download-update-btn')?.addEventListener('click', async () => {
  setUpdateUi({ status: 'downloading', percent: 0 });
  await window.api.downloadUpdate();
});

document.getElementById('install-update-btn')?.addEventListener('click', async () => {
  await window.api.installUpdate();
});

window.api.onUpdateStatus((state) => {
  setUpdateUi(state);
});

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
    applyConfigToUi(config);
    if (config.needsSetup) {
      showSetupOverlay(config.socketIoUrl || '');
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

function applyConfigToUi(config) {
  const serverUrlEl = document.getElementById('server-url');
  if (serverUrlEl) serverUrlEl.textContent = config.socketIoUrl || '—';

  const settingServer = document.getElementById('setting-server-url');
  if (settingServer && document.activeElement !== settingServer) {
    settingServer.value = config.socketIoUrl || '';
  }

  const watch = document.getElementById('setting-watch-folder');
  if (watch && document.activeElement !== watch) watch.value = config.watchFolder || '';

  const renders = document.getElementById('setting-render-folder');
  if (renders && document.activeElement !== renders) renders.value = config.renderFolder || '';

  const cdn = document.getElementById('setting-cdn-url');
  if (cdn && document.activeElement !== cdn) cdn.value = config.cdnUrl || '';

  const envPath = document.getElementById('setting-env-path');
  if (envPath) envPath.textContent = config.settingsPath || config.envPath || '—';

  const networkUrl = document.getElementById('network-url');
  if (networkUrl) networkUrl.textContent = config.socketIoUrl || '';

  document.getElementById('app-version').textContent = config.appVersion ? `v${config.appVersion}` : '—';
  if (!config.isPackaged) {
    setUpdateUi({ status: 'dev-mode' });
  }
  if (config.hostname) {
    const workerHostname = document.getElementById('worker-hostname');
    if (workerHostname) workerHostname.textContent = config.hostname;
  }
}

function setSaveStatus(id, message, kind = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `settings-save-status${kind ? ` ${kind}` : ''}`;
}

function showSetupOverlay(prefill = '') {
  const overlay = document.getElementById('setup-overlay');
  const input = document.getElementById('setup-server-url');
  const error = document.getElementById('setup-error');
  if (!overlay || !input) return;
  input.value = prefill && !prefill.includes('localhost') ? prefill : '';
  if (error) error.textContent = '';
  overlay.hidden = false;
}

function hideSetupOverlay() {
  const overlay = document.getElementById('setup-overlay');
  if (overlay) overlay.hidden = true;
}

document.getElementById('setup-continue-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('setup-server-url');
  const error = document.getElementById('setup-error');
  const btn = document.getElementById('setup-continue-btn');
  const url = (input?.value || '').trim();
  if (!url) {
    if (error) error.textContent = 'Server URL is required.';
    return;
  }
  btn.disabled = true;
  const result = await window.api.saveSettings({ socketIoUrl: url });
  btn.disabled = false;
  if (result?.error) {
    if (error) error.textContent = result.error;
    return;
  }
  hideSetupOverlay();
  applyConfigToUi({
    ...(await window.api.getConfig()),
    socketIoUrl: result.settings.socketIoUrl,
  });
});

document.getElementById('setup-server-url')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('setup-continue-btn')?.click();
});

document.getElementById('save-server-url-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('setting-server-url');
  const btn = document.getElementById('save-server-url-btn');
  btn.disabled = true;
  setSaveStatus('server-url-save-status', 'Saving...');
  const result = await window.api.saveSettings({ socketIoUrl: (input?.value || '').trim() });
  btn.disabled = false;
  if (result?.error) {
    setSaveStatus('server-url-save-status', result.error, 'err');
    return;
  }
  setSaveStatus('server-url-save-status', 'Saved — reconnecting…', 'ok');
  applyConfigToUi(await window.api.getConfig());
});

document.getElementById('save-paths-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('save-paths-btn');
  btn.disabled = true;
  setSaveStatus('paths-save-status', 'Saving...');
  const result = await window.api.saveSettings({
    watchFolder: document.getElementById('setting-watch-folder')?.value.trim() || '',
    renderFolder: document.getElementById('setting-render-folder')?.value.trim() || '',
    cdnUrl: document.getElementById('setting-cdn-url')?.value.trim() || '',
  });
  btn.disabled = false;
  if (result?.error) {
    setSaveStatus('paths-save-status', result.error, 'err');
    return;
  }
  setSaveStatus('paths-save-status', 'Saved', 'ok');
  applyConfigToUi(await window.api.getConfig());
});

window.api.onConfigUpdated?.((config) => {
  applyConfigToUi(config);
  if (config.needsSetup) showSetupOverlay(config.socketIoUrl || '');
  else hideSetupOverlay();
});

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
