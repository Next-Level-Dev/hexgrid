#!/usr/bin/env tsx
/**
 * Cron Job Tick Script for HexGrid Tactics
 * Executed via system crontab (e.g. every 5 minutes: * /5 * * * *)
 * 
 * Inspects database state:
 * - If current phase is OPEN and window expired:
 *     Transitions to CLOSED, atomically calculates Day N actions into Day N+1,
 *     and sets the closed-phase countdown window.
 * - If current phase is CLOSED and window expired:
 *     Transitions to OPEN and sets the open-phase countdown window.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { gameService } from '../server/gameService';
import { backupDatabaseIfDue } from '../server/backup';

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[CronTick ${ts}] ${msg}`);
}

async function main() {
  log('Starting cron tick check...');
  backupDatabaseIfDue();

  const game = db.getCurrentGame();
  if (!game) {
    log('No game found in database. Exiting.');
    process.exit(0);
  }

  if (game.phase === 'over') {
    log(`Game ${game.id} has ended (${game.endReason}). No phase advancement required.`);
    process.exit(0);
  }

  if (game.currentDay === 0 || game.endReason === 'waiting_to_start') {
    log(`Game ${game.id} is in waiting state (unstarted). Awaiting admin launch.`);
    process.exit(0);
  }

  const now = new Date();
  const endsAt = new Date(game.phaseEndsAt);
  const isTimeExpired = now.getTime() >= endsAt.getTime();

  log(`Current state: Day ${game.currentDay}, Phase: ${game.phase.toUpperCase()}, EndsAt: ${game.phaseEndsAt}`);
  log(`Time expired: ${isTimeExpired}`);

  // Phase transitions follow the stored phaseEndsAt timestamps so manual
  // admin phase control is never overridden by the wall-clock UTC schedule.
  if (game.phase === 'open' && isTimeExpired) {
    log(`Open phase has concluded. Transitioning to CLOSED phase and calculating Day ${game.currentDay} actions...`);
    const result = gameService.processRound(game.id, 'closed');
    if (result.success) {
      const updated = db.getCurrentGame();
      log(`Day ${game.currentDay} actions processed. Now in CLOSED phase for Day ${updated?.currentDay} until ${updated?.phaseEndsAt}.`);
    } else {
      log(`ERROR: Failed to process round: ${result.error}`);
      process.exit(1);
    }
  } else if (game.phase === 'closed' && isTimeExpired) {
    log(`Closed phase has concluded. Transitioning to OPEN phase for Day ${game.currentDay}...`);
    game.phase = 'open';
    game.phaseStartedAt = now.toISOString();
    game.phaseEndsAt = gameService.getNextOpenPhaseEnd(now).toISOString();
    db.updateGame(game);
    log(`Game is now OPEN for Day ${game.currentDay} until ${game.phaseEndsAt}.`);
  } else {
    const secondsLeft = Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 1000));
    log(`Phase ${game.phase.toUpperCase()} is active with ${secondsLeft}s remaining. No transition needed.`);
  }

  log('Cron tick check complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[CronTick ERROR]', err);
  process.exit(1);
});
