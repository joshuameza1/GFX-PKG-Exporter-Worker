const fs = require('fs');
const path = require('path');

function listCandidateOutputs(workpath, preferExt) {
  let entries = [];
  try {
    entries = fs.readdirSync(workpath);
  } catch (_) {
    return [];
  }

  const files = entries
    .map((name) => path.join(workpath, name))
    .filter((full) => {
      try {
        return fs.statSync(full).isFile();
      } catch (_) {
        return false;
      }
    })
    .filter((full) => {
      const base = path.basename(full).toLowerCase();
      if (base.endsWith('.jsx') || base.endsWith('.log') || base.endsWith('.txt')) return false;
      return true;
    });

  const resultNamed = files.filter((full) => /^result/i.test(path.basename(full)));
  const pool = resultNamed.length ? resultNamed : files;

  if (preferExt) {
    const ext = `.${String(preferExt).replace(/^\./, '').toLowerCase()}`;
    const preferred = pool.filter((full) => full.toLowerCase().endsWith(ext));
    if (preferred.length) return preferred.sort();
  }

  return pool.sort();
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * nexrender postrender action: find aerender output even when the exact
 * result_00000.jpg name is missing, then copy it to the destination.
 */
module.exports = (job, settings, params = {}, type) => {
  if (type !== 'postrender') {
    throw new Error(`action-copy-output can only run in postrender (got ${type})`);
  }

  const workpath = job.workpath;
  const preferExt = params.preferExt || job.template?.outputExt || 'jpg';
  let output = params.output;
  if (!output) {
    throw new Error('action-copy-output requires an output path');
  }
  if (!path.isAbsolute(output)) {
    output = path.join(workpath, output);
  }

  const explicit = params.input
    ? (path.isAbsolute(params.input) ? params.input : path.join(workpath, params.input))
    : null;

  let source = null;
  if (explicit && fs.existsSync(explicit)) {
    source = explicit;
  } else {
    const candidates = listCandidateOutputs(workpath, preferExt);
    source = candidates[0] || null;
  }

  if (!source) {
    let listing = '(unreadable)';
    try {
      listing = fs.readdirSync(workpath).join(', ') || '(empty)';
    } catch (_) {}
    throw new Error(
      `No render output found in ${workpath}. ` +
      `Expected result_*.${preferExt} (or similar). Files present: ${listing}`
    );
  }

  settings.logger.log(`[${job.uid}] copying output ${source} → ${output}`);
  copyFile(source, output);
  job.output = output;
  return Promise.resolve(job);
};
