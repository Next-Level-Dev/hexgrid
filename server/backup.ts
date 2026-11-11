/**
 * Database backup helper.
 * Keeps a rolling set of consistent SQLite snapshots in database/backups.
 */
import fs from 'fs';
import path from 'path';
import { db, DB_DIR } from './db';

const BACKUP_DIR = path.join(DB_DIR, 'backups');
const BACKUP_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // every few days
const MAX_BACKUPS = 10;

function listBackups(): Array<{ file: string; mtimeMs: number }> {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => /^hexgrid-.*\.db$/.test(file))
    .map((file) => {
      const fullPath = path.join(BACKUP_DIR, file);
      return { file, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Creates a backup if the newest one is older than the interval.
 * Returns the destination path when a backup was created, otherwise null.
 */
export function backupDatabaseIfDue(): string | null {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const backups = listBackups();
    if (backups.length > 0 && Date.now() - backups[0].mtimeMs < BACKUP_INTERVAL_MS) {
      return null;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(BACKUP_DIR, `hexgrid-${stamp}.db`);
    db.createBackup(destination);

    const updated = listBackups();
    for (const old of updated.slice(MAX_BACKUPS)) {
      try {
        fs.unlinkSync(path.join(BACKUP_DIR, old.file));
      } catch {
        // Non-critical: a stale backup will be retried on the next run.
      }
    }

    console.log(`[Backup] Database snapshot created: ${destination}`);
    return destination;
  } catch (err) {
    console.error('[Backup] Failed to create database backup:', err);
    return null;
  }
}
