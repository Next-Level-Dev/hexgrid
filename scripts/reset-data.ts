#!/usr/bin/env tsx
/**
 * Nukes the current HexGrid database for a fresh start.
 *
 * - Moves database/hexgrid.db (plus its -wal/-shm sidecars) into a
 *   timestamped folder under nuked_databases/. Nothing is deleted, so the
 *   old database stays recoverable.
 * - Resets all rolling backups by moving database/backups/* into the same
 *   nuked_databases folder. Stale backups would otherwise suppress new
 *   automatic backups (the helper skips when a recent snapshot exists) and
 *   could be restored over the fresh start.
 * - Leaves database/ empty; the app recreates a fresh hexgrid.db on next start.
 *
 * Usage:
 *   npm run resetdata             (asks for confirmation)
 *   npm run resetdata -- --yes    (skips the confirmation prompt)
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const DB_DIR = path.resolve(process.cwd(), 'database');
const NUKE_DIR = path.resolve(process.cwd(), 'nuked_databases');
const BACKUP_DIR = path.join(DB_DIR, 'backups');

const DB_FILES = ['hexgrid.db', 'hexgrid.db-wal', 'hexgrid.db-shm'] as const;

function askConfirm(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('This moves the live database and all backups into nuked_databases/. Continue? [y/N] ', (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}

async function main() {
  const skipConfirm = process.argv.includes('--yes') || process.argv.includes('-y');

  const existingDbFiles = DB_FILES.filter((f) => fs.existsSync(path.join(DB_DIR, f)));
  const backupFiles =
    fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter((f) => /^hexgrid-.*\.db$/.test(f))
      : [];

  if (existingDbFiles.length === 0 && backupFiles.length === 0) {
    console.log('[ResetData] Nothing to nuke: no database or backups found.');
    process.exit(0);
  }

  console.log(`[ResetData] Found ${existingDbFiles.length} database file(s) and ${backupFiles.length} backup(s).`);

  if (!skipConfirm && !(await askConfirm())) {
    console.log('[ResetData] Aborted.');
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.join(NUKE_DIR, `hexgrid-${stamp}`);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of existingDbFiles) {
    fs.renameSync(path.join(DB_DIR, file), path.join(targetDir, file));
  }

  if (backupFiles.length > 0) {
    for (const file of backupFiles) {
      fs.unlinkSync(path.join(BACKUP_DIR, file));
    }
  }

  // Keep database/ ready for the app to create a fresh hexgrid.db on start.
  fs.mkdirSync(DB_DIR, { recursive: true });

  console.log(`[ResetData] Moved ${existingDbFiles.length} database file(s) to ${targetDir}`);
  console.log(`[ResetData] Reset ${backupFiles.length} backup(s)`);
  console.log('[ResetData] database/ is now empty. A fresh database will be created when the app starts.');
  process.exit(0);
}

main();
