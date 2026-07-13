const fs = require('fs');
const Database = require('better-sqlite3');

class JobStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = this._openDatabase(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._migrate();
    this._recoverCrashedJobs();
  }

  _openDatabase(dbPath) {
    try {
      return new Database(dbPath);
    } catch (err) {
      console.error('[job-store] Database open failed, recreating:', err.message);
      for (const suffix of ['', '-shm', '-wal']) {
        try {
          fs.unlinkSync(`${dbPath}${suffix}`);
        } catch (_) {
          // ignore missing files
        }
      }
      return new Database(dbPath);
    }
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id          TEXT PRIMARY KEY,
        status      TEXT NOT NULL DEFAULT 'pending',
        request     TEXT NOT NULL,
        result_link TEXT,
        local_path  TEXT,
        error_message TEXT,
        progress    INTEGER DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )
    `);
    try {
      this.db.exec('ALTER TABLE jobs ADD COLUMN local_path TEXT');
    } catch (e) {
      // column already exists
    }
  }

  _recoverCrashedJobs() {
    // Do NOT put interrupted jobs back on the pending queue — that crash-loops the
    // app on launch when aerender/nexrender hard-crashes the process.
    const result = this.db
      .prepare(`
        UPDATE jobs
        SET status = 'failed',
            error_message = ?,
            progress = 0,
            updated_at = ?
        WHERE status = 'rendering'
      `)
      .run(
        'Interrupted by app crash — retry from Queue if needed',
        new Date().toISOString()
      );
    if (result.changes > 0) {
      console.log(`[job-store] Marked ${result.changes} interrupted job(s) as failed`);
    }
  }

  enqueue(request) {
    const now = new Date().toISOString();
    const id = request.request_id;
    this.db.prepare(`
      INSERT INTO jobs (id, status, request, created_at, updated_at)
      VALUES (?, 'pending', ?, ?, ?)
    `).run(id, JSON.stringify(request), now, now);
    return this.getById(id);
  }

  claimNext() {
    const job = this.db.prepare(`
      SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1
    `).get();
    if (!job) return null;

    this.db.prepare(`
      UPDATE jobs SET status = 'rendering', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), job.id);

    job.status = 'rendering';
    job.request = JSON.parse(job.request);
    return job;
  }

  markCompleted(id, resultLink, localPath) {
    this.db.prepare(`
      UPDATE jobs SET status = 'completed', result_link = ?, local_path = ?, progress = 100, updated_at = ? WHERE id = ?
    `).run(resultLink, localPath || null, new Date().toISOString(), id);
  }

  markFailed(id, errorMessage) {
    this.db.prepare(`
      UPDATE jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?
    `).run(errorMessage, new Date().toISOString(), id);
  }

  updateProgress(id, percent) {
    this.db.prepare(`
      UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?
    `).run(Math.round(percent), new Date().toISOString(), id);
  }

  getById(id) {
    const job = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
    if (job) job.request = JSON.parse(job.request);
    return job;
  }

  getAll() {
    return this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100').all();
  }

  getPendingCount() {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'`).get();
    return row.count;
  }

  clearAll() {
    this.db.prepare('DELETE FROM jobs').run();
  }

  failActiveJobs(message = 'Cleared after previous app crash') {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE jobs
      SET status = 'failed', error_message = ?, progress = 0, updated_at = ?
      WHERE status IN ('pending', 'rendering')
    `).run(message, now);
    return result.changes;
  }

  resetJob(id) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE jobs SET status = 'pending', error_message = NULL, progress = 0, updated_at = ? WHERE id = ?
    `).run(now, id);
    return this.getById(id);
  }

  cleanup(olderThanDays = 7) {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const result = this.db.prepare(`
      DELETE FROM jobs WHERE status IN ('completed', 'failed') AND created_at < ?
    `).run(cutoff);
    return result.changes;
  }
}

module.exports = { JobStore };
