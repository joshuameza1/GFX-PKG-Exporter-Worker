const fs = require('fs');
const path = require('path');

const RESERVED_NAMES = new Set(['_PastBrandings', 'Adobe After Effects Auto-Save']);

function isIgnoredName(name) {
  return !name
    || name.startsWith('.')
    || name.startsWith('~')
    || RESERVED_NAMES.has(name)
    || name.includes('Auto-Save');
}

function findAepxFiles(dir, { recursive = true, maxDepth = 3 } = {}) {
  if (!dir || !fs.existsSync(dir)) return [];

  const results = [];

  function walk(current, depth) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (isIgnoredName(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.aepx')) {
        results.push(fullPath);
      } else if (recursive && entry.isDirectory() && depth < maxDepth) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(dir, 0);
  return results.sort((a, b) => a.localeCompare(b));
}

function preferMainAepx(packageDir, aepxFiles) {
  if (!aepxFiles.length) return null;
  const base = path.basename(packageDir);
  const exact = aepxFiles.find((f) => path.basename(f, '.aepx') === base);
  if (exact) return exact;
  const topLevel = aepxFiles.find((f) => path.dirname(f) === packageDir);
  return topLevel || aepxFiles[0];
}

/**
 * Discover packages in the watch folder.
 * Supports:
 *  - Collect Files folders: Watch/<PackageName>/**.aepx
 *  - Legacy flat files: Watch/<PackageName>.aepx
 */
function discoverPackages(watchFolder) {
  if (!watchFolder || !fs.existsSync(watchFolder)) return [];

  const packages = [];
  let entries;
  try {
    entries = fs.readdirSync(watchFolder, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    const fullPath = path.join(watchFolder, entry.name);

    if (entry.isDirectory()) {
      const aepxFiles = findAepxFiles(fullPath, { recursive: true, maxDepth: 4 });
      const aepxPath = preferMainAepx(fullPath, aepxFiles);
      if (!aepxPath) continue;
      packages.push({
        id: entry.name,
        name: entry.name,
        kind: 'folder',
        rootPath: fullPath,
        aepxPath,
      });
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.aepx')) {
      const name = entry.name.replace(/\.aepx$/i, '');
      packages.push({
        id: entry.name,
        name,
        kind: 'file',
        rootPath: fullPath,
        aepxPath: fullPath,
      });
    }
  }

  return packages;
}

function resolveTemplatePath(watchFolder, gfxpkg) {
  if (!watchFolder || !gfxpkg) return null;

  const folderExact = path.join(watchFolder, gfxpkg, `${gfxpkg}.aepx`);
  if (fs.existsSync(folderExact)) return folderExact;

  const folderDir = path.join(watchFolder, gfxpkg);
  if (fs.existsSync(folderDir) && fs.statSync(folderDir).isDirectory()) {
    const found = preferMainAepx(folderDir, findAepxFiles(folderDir));
    if (found) return found;
  }

  const flat = path.join(watchFolder, `${gfxpkg}.aepx`);
  if (fs.existsSync(flat)) return flat;

  // Layout may still store legacy "Name.aepx" ids
  if (gfxpkg.toLowerCase().endsWith('.aepx')) {
    const legacyFlat = path.join(watchFolder, gfxpkg);
    if (fs.existsSync(legacyFlat)) return legacyFlat;
    const asFolder = gfxpkg.replace(/\.aepx$/i, '');
    return resolveTemplatePath(watchFolder, asFolder);
  }

  return null;
}

function packageIdFromAepxPath(watchFolder, aepxPath) {
  if (!watchFolder || !aepxPath) return null;
  const rel = path.relative(watchFolder, aepxPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0]; // flat .aepx
  return parts[0]; // package folder name
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (isIgnoredName(entry) && entry !== path.basename(src)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function moveRecursive(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (_) {
    copyRecursive(src, dest);
    fs.rmSync(src, { recursive: true, force: true });
  }
}

/**
 * If user picks an .aepx whose parent looks like a Collect Files folder,
 * import the whole parent. Otherwise import the single file.
 */
function resolveImportSource(selectedPath) {
  const stat = fs.statSync(selectedPath);
  if (stat.isDirectory()) {
    const aepxFiles = findAepxFiles(selectedPath);
    if (!aepxFiles.length) {
      throw new Error('Selected folder does not contain an .aepx project');
    }
    return {
      kind: 'folder',
      sourcePath: selectedPath,
      importName: path.basename(selectedPath),
      aepxPath: preferMainAepx(selectedPath, aepxFiles),
    };
  }

  if (!selectedPath.toLowerCase().endsWith('.aepx')) {
    throw new Error('Select an .aepx file or a Collect Files folder');
  }

  const parent = path.dirname(selectedPath);
  const siblings = fs.readdirSync(parent).filter((n) => !isIgnoredName(n) && n !== path.basename(selectedPath));
  const looksCollected = siblings.some((n) => {
    const lower = n.toLowerCase();
    return lower === 'footage'
      || lower === '(footage)'
      || lower === 'assets'
      || lower.endsWith(' folder')
      || fs.statSync(path.join(parent, n)).isDirectory();
  });

  if (looksCollected) {
    return {
      kind: 'folder',
      sourcePath: parent,
      importName: path.basename(parent),
      aepxPath: selectedPath,
    };
  }

  return {
    kind: 'file',
    sourcePath: selectedPath,
    importName: path.basename(selectedPath),
    aepxPath: selectedPath,
  };
}

module.exports = {
  discoverPackages,
  resolveTemplatePath,
  packageIdFromAepxPath,
  findAepxFiles,
  preferMainAepx,
  copyRecursive,
  moveRecursive,
  resolveImportSource,
  isIgnoredName,
};
