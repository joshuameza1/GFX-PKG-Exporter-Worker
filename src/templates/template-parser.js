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

class TemplateParser {
  constructor(watchFolder) {
    this.watchFolder = watchFolder;
    // filePath → { name, graphics, isLive }
    this.packages = new Map();
  }

  // Called on connect — loads every .aepx in the watch folder, all start live
  async parseAllTemplates() {
    if (!this.watchFolder || !fs.existsSync(this.watchFolder)) return [];
    const files = fs.readdirSync(this.watchFolder).filter(
      (f) => f.endsWith('.aepx') && !f.startsWith('.') && !f.startsWith('~')
    );
    for (const fileName of files) {
      const filePath = path.join(this.watchFolder, fileName);
      await this._parseFile(filePath, true);
    }
    return this.getLiveGraphics();
  }

  // Called when a file is added via the + button — starts NOT live
  async addPackage(filePath) {
    await this._parseFile(filePath, false);
  }

  // Called when a file on disk changes — preserves live state
  async updatePackage(filePath) {
    const existing = this.packages.get(filePath);
    const wasLive = existing ? existing.isLive : true;
    await this._parseFile(filePath, wasLive);
  }

  setLive(filePath, isLive) {
    const pkg = this.packages.get(filePath);
    if (pkg) pkg.isLive = isLive;
  }

  removePackage(filePath) {
    this.packages.delete(filePath);
  }

  movePackage(filePath, direction) {
    const entries = Array.from(this.packages.entries());
    const idx = entries.findIndex(([fp]) => fp === filePath);
    if (direction === 'up' && idx > 0) {
      [entries[idx - 1], entries[idx]] = [entries[idx], entries[idx - 1]];
    } else if (direction === 'down' && idx < entries.length - 1) {
      [entries[idx], entries[idx + 1]] = [entries[idx + 1], entries[idx]];
    } else {
      return; // nothing to do
    }
    this.packages = new Map(entries);
  }

  getLiveGraphics() {
    const all = [];
    for (const pkg of this.packages.values()) {
      if (pkg.isLive) all.push(...pkg.graphics);
    }
    return all;
  }

  getAllPackages() {
    return Array.from(this.packages.entries()).map(([filePath, pkg]) => ({
      filePath,
      name: pkg.name.replace('.aepx', ''),
      graphics: pkg.graphics,
      isLive: pkg.isLive,
      compositionCount: pkg.graphics.length,
    }));
  }

  getCurrentInfo() {
    const packages = this.getAllPackages();
    const liveGraphics = this.getLiveGraphics();
    return {
      packages,
      graphics: liveGraphics,
      compositionCount: liveGraphics.length,
      // backwards compat for dashboard card
      template: packages.length > 0 ? { name: packages[0].name } : null,
    };
  }

  // Keep for ipc-handlers compatibility
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
