const fs = require('fs');
const path = require('path');

const YEAR_GUESSES = [2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020];

function candidatePaths(preferred) {
  const out = [];
  const seen = new Set();

  function add(p) {
    const value = (p || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  }

  add(preferred);
  add(process.env.AERENDER_PATH);

  for (const year of YEAR_GUESSES) {
    add(`/Applications/Adobe After Effects ${year}/aerender`);
  }
  add('/Applications/Adobe After Effects (Beta)/aerender');

  try {
    for (const entry of fs.readdirSync('/Applications')) {
      if (!/^Adobe After Effects/i.test(entry)) continue;
      add(path.join('/Applications', entry, 'aerender'));
    }
  } catch (_) {
    // /Applications may be unreadable in unusual environments
  }

  return out;
}

function resolveAerenderPath(preferred) {
  for (const candidate of candidatePaths(preferred)) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_) {
      // keep looking
    }
  }
  return null;
}

module.exports = {
  candidatePaths,
  resolveAerenderPath,
};
