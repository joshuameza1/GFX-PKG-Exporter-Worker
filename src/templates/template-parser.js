const fs = require('fs');
const path = require('path');
const aepx = require('aepx');

function parseProjectToJSON(filePath) {
  try {
    const projectJson = aepx.parseFileSync(filePath);
    return projectJson.fold.items;
  } catch (error) {
    console.error('[template-parser] Failed to parse .aepx:', error);
    return null;
  }
}

function findTemplateComps(items, results = []) {
  for (const entry of items) {
    const entryType = entry.idta.entry_type;
    if (entryType === 4 && entry.string.includes('^')) {
      results.push(entry);
    } else if (entryType === 1 && entry.sfdr && entry.sfdr.items.length > 0) {
      findTemplateComps(entry.sfdr.items, results);
    }
  }
  return results;
}

function extractGraphics(project) {
  const items = parseProjectToJSON(project.path);
  if (!items) return null;

  const comps = findTemplateComps(items);
  const graphics = [];

  for (const comp of comps) {
    const name = comp.string.replace('^', '').split('_').join(' ');
    const compSettings = {
      preview_frame: Math.round(
        ((comp.cdta.duration - 1) - comp.cdta.startFrame) / 2
      ),
    };

    const pkgToken = project.name.replace('.aepx', '').replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '_');
    const button = {
      name,
      action_id: `Create_${pkgToken}_${name.split(' ').join('_')}`,
    };

    const finalFrames = [];
    let multipleRenders = false;
    const textInputs = [];
    const checkboxInputs = [];

    for (const layer of comp.layr) {
      if (layer.ldta.asset_type === 3 && layer.string[0] === '^') {
        textInputs.push({
          name: layer.string.replace('^', ''),
          action_id: layer.string.replace('^', '').replace('*', '').replace(' ', '_'),
          required: layer.string.includes('*'),
        });
      }
      if (layer.ldta.asset_type === 0 && layer.string[0] === '^') {
        checkboxInputs.push({
          name: layer.string.replace('^', '').replace('*', ''),
          action_id: layer.string.replace('^', '').replace('*', '').replace(' ', '_'),
        });
      }
      if (layer.ldta.asset_type === 0 && layer.string[0] === '#') {
        multipleRenders = true;
        finalFrames.push({
          suffix: `_${layer.string.replace('#', '')}`,
          start_frame: Math.round(
            (layer.ldta.startTimeline + layer.ldta.startFrame) * comp.cdta.frameRate
          ),
          end_frame: Math.round(
            (layer.ldta.startTimeline + layer.ldta.duration) * comp.cdta.frameRate
          ) - 1,
        });
      }
    }

    if (!multipleRenders) {
      finalFrames.push({
        suffix: '',
        start_frame: comp.cdta.startFrame,
        end_frame: comp.cdta.startFrame + comp.cdta.duration - 1,
      });
    }

    compSettings.final_frames = finalFrames;

    graphics.push({
      gfxpkg: project.name.replace('.aepx', ''),
      comp_settings: compSettings,
      button,
      text_inputs: textInputs,
      checkbox_inputs: checkboxInputs,
    });
  }

  return graphics;
}

const LAYOUT_FILE = '.gfx-layout.json';

class TemplateParser {
  constructor(watchFolder) {
    this.watchFolder = watchFolder;
    // filePath → { name, graphics, isLive }
    this.packages = new Map();
    // { folders: [{name, packages:[basename]}], ungrouped:[basename] }
    this.layout = { folders: [], ungrouped: [] };
  }

  // ── Layout persistence ────────────────────────────────────────────
  _layoutPath() {
    return path.join(this.watchFolder, LAYOUT_FILE);
  }

  _loadLayout() {
    try {
      const raw = fs.readFileSync(this._layoutPath(), 'utf8');
      const p = JSON.parse(raw);
      this.layout = { folders: p.folders || [], ungrouped: p.ungrouped || [] };
    } catch {
      this.layout = { folders: [], ungrouped: [] };
    }
  }

  _saveLayout() {
    if (!this.watchFolder || !fs.existsSync(this.watchFolder)) return;
    try {
      fs.writeFileSync(this._layoutPath(), JSON.stringify(this.layout, null, 2));
    } catch (err) {
      console.error('[template-parser] Failed to save layout:', err);
    }
  }

  _addToLayoutIfMissing(basename) {
    const inFolder = this.layout.folders.some((f) => f.packages.includes(basename));
    if (!inFolder && !this.layout.ungrouped.includes(basename)) {
      this.layout.ungrouped.push(basename);
    }
  }

  _removeFromLayout(basename) {
    this.layout.ungrouped = this.layout.ungrouped.filter((b) => b !== basename);
    for (const f of this.layout.folders) {
      f.packages = f.packages.filter((b) => b !== basename);
    }
  }

  _pruneLayout() {
    const loaded = new Set(Array.from(this.packages.keys()).map((fp) => path.basename(fp)));
    this.layout.ungrouped = this.layout.ungrouped.filter((b) => loaded.has(b));
    for (const f of this.layout.folders) {
      f.packages = f.packages.filter((b) => loaded.has(b));
    }
  }

  // ── Core parsing ──────────────────────────────────────────────────
  async parseAllTemplates() {
    if (!this.watchFolder || !fs.existsSync(this.watchFolder)) return [];
    this._loadLayout();
    const files = fs.readdirSync(this.watchFolder).filter(
      (f) => f.endsWith('.aepx') && !f.startsWith('.') && !f.startsWith('~')
    );
    for (const fileName of files) {
      const filePath = path.join(this.watchFolder, fileName);
      await this._parseFile(filePath, true);
      this._addToLayoutIfMissing(fileName);
    }
    this._pruneLayout();
    this._saveLayout();
    return this.getLiveGraphics();
  }

  async addPackage(filePath) {
    await this._parseFile(filePath, false);
    this._addToLayoutIfMissing(path.basename(filePath));
    this._saveLayout();
  }

  async updatePackage(filePath) {
    const existing = this.packages.get(filePath);
    const wasLive = existing ? existing.isLive : true;
    await this._parseFile(filePath, wasLive);
  }

  // ── Package operations ────────────────────────────────────────────
  setLive(filePath, isLive) {
    const pkg = this.packages.get(filePath);
    if (pkg) pkg.isLive = isLive;
  }

  removePackage(filePath) {
    this.packages.delete(filePath);
    this._removeFromLayout(path.basename(filePath));
    this._saveLayout();
  }

  setPackageFolder(filePath, folderName) {
    const basename = path.basename(filePath);
    this._removeFromLayout(basename);
    if (folderName) {
      let folder = this.layout.folders.find((f) => f.name === folderName);
      if (!folder) {
        folder = { name: folderName, packages: [] };
        this.layout.folders.push(folder);
      }
      folder.packages.push(basename);
    } else {
      this.layout.ungrouped.push(basename);
    }
    this._saveLayout();
  }

  // ── Layout operations ─────────────────────────────────────────────
  setLayout(newLayout) {
    this.layout = {
      folders: (newLayout.folders || []).map((f) => ({
        name: f.name,
        packages: f.packages || [],
      })),
      ungrouped: newLayout.ungrouped || [],
    };
    this._saveLayout();
  }

  createFolder(name) {
    if (!this.layout.folders.find((f) => f.name === name)) {
      this.layout.folders.push({ name, packages: [] });
      this._saveLayout();
    }
  }

  renameFolder(oldName, newName) {
    const folder = this.layout.folders.find((f) => f.name === oldName);
    if (folder && !this.layout.folders.find((f) => f.name === newName)) {
      folder.name = newName;
      this._saveLayout();
    }
  }

  deleteFolder(name) {
    const idx = this.layout.folders.findIndex((f) => f.name === name);
    if (idx >= 0) {
      this.layout.ungrouped.push(...this.layout.folders[idx].packages);
      this.layout.folders.splice(idx, 1);
      this._saveLayout();
    }
  }

  // ── Data access ───────────────────────────────────────────────────
  getLiveGraphics() {
    const all = [];
    for (const pkg of this.packages.values()) {
      if (pkg.isLive) all.push(...pkg.graphics);
    }
    return all;
  }

  getAllPackages() {
    const result = [];
    const addPkg = (basename, folderName) => {
      const filePath = path.join(this.watchFolder, basename);
      const pkg = this.packages.get(filePath);
      if (pkg) {
        result.push({
          filePath,
          name: pkg.name.replace('.aepx', ''),
          graphics: pkg.graphics,
          isLive: pkg.isLive,
          compositionCount: pkg.graphics.length,
          folder: folderName || null,
        });
      }
    };
    for (const f of this.layout.folders) {
      for (const b of f.packages) addPkg(b, f.name);
    }
    for (const b of this.layout.ungrouped) addPkg(b, null);
    // Safety net: anything not yet in layout
    const inResult = new Set(result.map((p) => p.filePath));
    for (const [filePath, pkg] of this.packages.entries()) {
      if (!inResult.has(filePath)) {
        result.push({
          filePath,
          name: pkg.name.replace('.aepx', ''),
          graphics: pkg.graphics,
          isLive: pkg.isLive,
          compositionCount: pkg.graphics.length,
          folder: null,
        });
      }
    }
    return result;
  }

  getCurrentInfo() {
    const packages = this.getAllPackages();
    const liveGraphics = this.getLiveGraphics();
    return {
      packages,
      folders: this.layout.folders.map((f) => f.name),
      graphics: liveGraphics,
      compositionCount: liveGraphics.length,
      template: packages.length > 0 ? { name: packages[0].name } : null,
    };
  }

  get lastGraphics() {
    return this.getLiveGraphics();
  }

  async _parseFile(filePath, isLive) {
    const project = { name: path.basename(filePath), path: filePath };
    const graphics = extractGraphics(project);
    if (graphics) {
      this.packages.set(filePath, { name: project.name, graphics, isLive });
    }
    return graphics;
  }
}

module.exports = { TemplateParser, extractGraphics };
