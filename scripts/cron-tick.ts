#!/usr/bin/env tsx
/**
 * Cron Job Tick Script for HexGrid Tactics
 * Executed via system crontab (e.g. every 5 minutes: * /5 * * * *)
 * 
 * Inspects database state:
 * - If current phase is OPEN and window expired:
 *     Transitions to CLOSED, atomically calculates Day N actions into Day N+1,
 *     and sets 4-hour countdown window.
 * - If current phase is CLOSED and window expired:
 *     Transitions to OPEN and sets 20-hour countdown window.
 */
import { db } from '../server/db';
import { gameService } from '../server/gameService';

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[CronTick ${ts}] ${msg}`);
}

async function main() {
  log('Starting cron tick check...');

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
  const expectedUtcPhase = gameService.getExpectedUtcPhase(now);

  log(`Current state: Day ${game.currentDay}, Phase: ${game.phase.toUpperCase()}, EndsAt: ${game.phaseEndsAt}`);
  log(`Time expired: ${isTimeExpired}, Expected UTC Phase: ${expectedUtcPhase.toUpperCase()}`);

  if (game.phase === 'open' && (isTimeExpired || expectedUtcPhase === 'closed')) {
    log(`Open phase has concluded. Transitioning to CLOSED phase and calculating Day ${game.currentDay} actions...`);
    const result = gameService.processRound(game.id, 'closed');
    if (result.success) {
      const updated = db.getCurrentGame();
      if (updated && updated.phase === 'closed') {
        const { phaseStartedAt, phaseEndsAt } = gameService.getUtcPhaseWindow(now, 'closed');
        updated.phaseStartedAt = phaseStartedAt.toISOString();
        updated.phaseEndsAt = phaseEndsAt.toISOString();
        db.updateGame(updated);
        log(`Day ${game.currentDay} actions processed. Now in CLOSED phase for Day ${updated.currentDay} until ${updated.phaseEndsAt}.`);
      }
    } else {
      log(`ERROR: Failed to process round: ${result.error}`);
      process.exit(1);
    }
  } else if (game.phase === 'closed' && (isTimeExpired || expectedUtcPhase === 'open')) {
    log(`Closed phase has concluded. Transitioning to OPEN phase for Day ${game.currentDay}...`);
    const { phaseStartedAt, phaseEndsAt } = gameService.getUtcPhaseWindow(now, 'open');
    game.phase = 'open';
    game.phaseStartedAt = phaseStartedAt.toISOString();
    game.phaseEndsAt = phaseEndsAt.toISOString();
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
