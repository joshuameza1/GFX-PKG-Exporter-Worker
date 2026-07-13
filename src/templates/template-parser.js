const fs = require('fs');
const path = require('path');
const aepx = require('aepx');
const {
  discoverPackages,
  packageIdFromAepxPath,
  resolveTemplatePath,
} = require('./package-paths');

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
  const gfxpkg = project.gfxpkg || project.name.replace(/\.aepx$/i, '');

  for (const comp of comps) {
    const name = comp.string.replace('^', '').split('_').join(' ');
    const compSettings = {
      preview_frame: Math.round(
        ((comp.cdta.duration - 1) - comp.cdta.startFrame) / 2
      ),
    };

    const pkgToken = gfxpkg.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '_');
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
      gfxpkg,
      packageId: project.packageId || gfxpkg,
      aepxPath: project.path,
      rootPath: project.rootPath || path.dirname(project.path),
      kind: project.kind || 'file',
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
    // packageId → { name, graphics, isLive, aepxPath, rootPath, kind }
    this.packages = new Map();
    // { folders: [{name, packages:[packageId]}], ungrouped:[packageId] }
    this.layout = { folders: [], ungrouped: [] };
  }

  _layoutPath() {
    return path.join(this.watchFolder, LAYOUT_FILE);
  }

  _loadLayout() {
    try {
      const raw = fs.readFileSync(this._layoutPath(), 'utf8');
      const parsed = JSON.parse(raw);
      this.layout = {
        folders: parsed.folders || [],
        ungrouped: parsed.ungrouped || [],
      };
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

  _normalizeLayoutIds(discovered) {
    const byName = new Map();
    for (const pkg of discovered) {
      byName.set(pkg.name, pkg.id);
      byName.set(pkg.id, pkg.id);
      byName.set(`${pkg.name}.aepx`, pkg.id);
    }

    const remap = (id) => byName.get(id) || byName.get(id.replace(/\.aepx$/i, '')) || id;

    this.layout.ungrouped = this.layout.ungrouped.map(remap);
    for (const folder of this.layout.folders) {
      folder.packages = (folder.packages || []).map(remap);
    }
  }

  _addToLayoutIfMissing(packageId) {
    const inFolder = this.layout.folders.some((f) => f.packages.includes(packageId));
    if (!inFolder && !this.layout.ungrouped.includes(packageId)) {
      this.layout.ungrouped.push(packageId);
    }
  }

  _removeFromLayout(packageId) {
    this.layout.ungrouped = this.layout.ungrouped.filter((id) => id !== packageId);
    for (const folder of this.layout.folders) {
      folder.packages = folder.packages.filter((id) => id !== packageId);
    }
  }

  _pruneLayout() {
    const loaded = new Set(this.packages.keys());
    this.layout.ungrouped = this.layout.ungrouped.filter((id) => loaded.has(id));
    for (const folder of this.layout.folders) {
      folder.packages = folder.packages.filter((id) => loaded.has(id));
    }
  }

  async parseAllTemplates() {
    if (!this.watchFolder || !fs.existsSync(this.watchFolder)) return [];
    this._loadLayout();
    this.packages.clear();

    const discovered = discoverPackages(this.watchFolder);
    this._normalizeLayoutIds(discovered);

    for (const pkg of discovered) {
      await this._parsePackage(pkg, true);
      this._addToLayoutIfMissing(pkg.id);
    }

    this._pruneLayout();
    this._saveLayout();
    return this.getLiveGraphics();
  }

  async addPackage(aepxPath, meta = {}) {
    const discovered = discoverPackages(this.watchFolder);
    const packageId = meta.packageId
      || packageIdFromAepxPath(this.watchFolder, aepxPath)
      || path.basename(aepxPath);
    const match = discovered.find((p) => p.id === packageId || p.aepxPath === aepxPath);

    await this._parsePackage(match || {
      id: packageId,
      name: meta.name || packageId.replace(/\.aepx$/i, ''),
      kind: meta.kind || (packageId.toLowerCase().endsWith('.aepx') ? 'file' : 'folder'),
      rootPath: meta.rootPath || (match ? match.rootPath : path.dirname(aepxPath)),
      aepxPath,
    }, false);

    this._addToLayoutIfMissing(packageId);
    this._saveLayout();
  }

  async updatePackage(aepxPath) {
    const packageId = packageIdFromAepxPath(this.watchFolder, aepxPath);
    if (!packageId) return;

    const existing = this.packages.get(packageId);
    const wasLive = existing ? existing.isLive : true;
    const discovered = discoverPackages(this.watchFolder);
    const match = discovered.find((p) => p.id === packageId);
    if (!match) return;
    await this._parsePackage(match, wasLive);
  }

  setLive(filePathOrId, isLive) {
    const pkg = this._getPackage(filePathOrId);
    if (pkg) pkg.isLive = isLive;
  }

  removePackage(filePathOrId) {
    const packageId = this._resolvePackageId(filePathOrId);
    if (!packageId) return null;
    const pkg = this.packages.get(packageId);
    this.packages.delete(packageId);
    this._removeFromLayout(packageId);
    this._saveLayout();
    return pkg || null;
  }

  setPackageFolder(filePathOrId, folderName) {
    const packageId = this._resolvePackageId(filePathOrId);
    if (!packageId) return;
    this._removeFromLayout(packageId);
    if (folderName) {
      let folder = this.layout.folders.find((f) => f.name === folderName);
      if (!folder) {
        folder = { name: folderName, packages: [] };
        this.layout.folders.push(folder);
      }
      folder.packages.push(packageId);
    } else {
      this.layout.ungrouped.push(packageId);
    }
    this._saveLayout();
  }

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

  getLiveGraphics() {
    const all = [];
    for (const pkg of this.getAllPackages()) {
      if (pkg.isLive) all.push(...pkg.graphics);
    }
    return all;
  }

  getAllPackages() {
    const result = [];
    const addPkg = (packageId, folderName) => {
      const pkg = this.packages.get(packageId);
      if (!pkg) return;
      result.push({
        packageId,
        filePath: pkg.aepxPath,
        rootPath: pkg.rootPath,
        kind: pkg.kind,
        name: pkg.name,
        graphics: pkg.graphics,
        isLive: pkg.isLive,
        compositionCount: pkg.graphics.length,
        folder: folderName || null,
      });
    };

    for (const folder of this.layout.folders) {
      for (const packageId of folder.packages) addPkg(packageId, folder.name);
    }
    for (const packageId of this.layout.ungrouped) addPkg(packageId, null);

    const inResult = new Set(result.map((p) => p.packageId));
    for (const [packageId, pkg] of this.packages.entries()) {
      if (!inResult.has(packageId)) {
        result.push({
          packageId,
          filePath: pkg.aepxPath,
          rootPath: pkg.rootPath,
          kind: pkg.kind,
          name: pkg.name,
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
      layout: this.layout,
      graphics: liveGraphics,
      compositionCount: liveGraphics.length,
      template: packages.length > 0 ? { name: packages[0].name } : null,
    };
  }

  get lastGraphics() {
    return this.getLiveGraphics();
  }

  findTemplatePath(gfxpkg) {
    return resolveTemplatePath(this.watchFolder, gfxpkg);
  }

  _resolvePackageId(filePathOrId) {
    if (!filePathOrId) return null;
    if (this.packages.has(filePathOrId)) return filePathOrId;
    const fromPath = packageIdFromAepxPath(this.watchFolder, filePathOrId);
    if (fromPath && this.packages.has(fromPath)) return fromPath;
    for (const [id, pkg] of this.packages.entries()) {
      if (pkg.aepxPath === filePathOrId || pkg.rootPath === filePathOrId) return id;
    }
    return filePathOrId;
  }

  _getPackage(filePathOrId) {
    const id = this._resolvePackageId(filePathOrId);
    return id ? this.packages.get(id) : null;
  }

  async _parsePackage(pkgMeta, isLive) {
    const project = {
      name: path.basename(pkgMeta.aepxPath),
      path: pkgMeta.aepxPath,
      gfxpkg: pkgMeta.name,
      packageId: pkgMeta.id,
      rootPath: pkgMeta.rootPath,
      kind: pkgMeta.kind,
    };
    const graphics = extractGraphics(project);
    if (!graphics) return null;

    this.packages.set(pkgMeta.id, {
      name: pkgMeta.name,
      graphics,
      isLive,
      aepxPath: pkgMeta.aepxPath,
      rootPath: pkgMeta.rootPath,
      kind: pkgMeta.kind,
    });
    return graphics;
  }
}

module.exports = { TemplateParser, extractGraphics };
