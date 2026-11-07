/**
 * Game Service: Manages game lifecycle, database persistence, UTC cycle scheduling, and atomic round processing.
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { GameEngine } from './engine';
import {
  GameRecord,
  GameStateRecord,
  Player,
  Phase,
} from '../src/types/game';
import { GAME_RULES, deterministicShuffle, generateSafeSpawnPosition } from '../src/game/rules';

export class GameService {
  private static instance: GameService;
  private intervalTimer: NodeJS.Timeout | null = null;
  public auditLogs: Array<{ timestamp: string; level: 'info' | 'error'; message: string }> = [];

  private constructor() {
    this.ensureInitialized();
    this.startScheduler();
  }

  static getInstance(): GameService {
    if (!GameService.instance) {
      GameService.instance = new GameService();
    }
    return GameService.instance;
  }

  log(level: 'info' | 'error', message: string) {
    const entry = { timestamp: new Date().toISOString(), level, message };
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 200) this.auditLogs.pop();
    console.log(`[GameService ${level.toUpperCase()}] ${message}`);
  }

  /**
   * Initializes initial admin and closed waiting game state if empty.
   */
  ensureInitialized() {
    // 1. Ensure Admin exists
    const allPlayers = db.getAllPlayers();
    let admin = allPlayers.find((p) => p.isAdmin);
    if (!admin) {
      const adminId = 'a0000000-0000-0000-0000-000000000001';
      admin = {
        id: adminId,
        username: 'Admin',
        avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=Admin',
        health: 3,
        points: 1,
        x: 13,
        y: 13,
        isAlive: true,
        isAdmin: true,
        peaceVote: 'no',
        stats: { gamesPlayed: 0, worldPeaces: 0, lastOneStandings: 0, deaths: 0 },
        games: {},
      };
      db.savePlayer(admin);
      this.log('info', 'Admin account initialized.');
    }

    // 2. Ensure initial game exists in closed state waiting for admin to start
    let game = db.getCurrentGame();
    if (!game) {
      this.log('info', 'No active game found. Bootstrapping closed game waiting to be started...');
      this.bootstrapInitialGame();
    }
  }

  bootstrapInitialGame() {
    const gameId = uuidv4();
    const now = new Date();
    const { phaseStartedAt, phaseEndsAt } = this.getUtcPhaseWindow(now, 'closed');

    const game: GameRecord = {
      id: gameId,
      currentDay: 0,
      phase: 'closed',
      phaseStartedAt: phaseStartedAt.toISOString(),
      phaseEndsAt: phaseEndsAt.toISOString(),
      locked: false,
      endReason: 'waiting_to_start',
    };
    db.createGame(game);
    this.log('info', `Game ${gameId} initialized in closed state (waiting to be started).`);
  }

  /**
   * Starts a brand new game, spawning ALL currently registered players.
   * New players created during a running game will be included in the NEXT game!
   */
  startNewGame(): GameRecord {
    const gameId = uuidv4();
    const allPlayers = db.getAllPlayers();
    const spawnPositions: Array<{ x: number; y: number }> = [];

    const playersSnapshot: Record<string, any> = {};
    for (const p of allPlayers) {
      const pos = generateSafeSpawnPosition(spawnPositions);
      spawnPositions.push(pos);

      p.x = pos.x;
      p.y = pos.y;
      p.health = 3;
      p.points = 1;
      p.isAlive = true;
      p.peaceVote = 'no';
      p.games[gameId] = { lastDayViewed: 1, peaceVote: 'no' };
      db.savePlayer(p);

      playersSnapshot[p.id] = {
        id: p.id,
        username: p.username,
        avatarUrl: p.avatarUrl,
        health: 3,
        points: 1,
        x: pos.x,
        y: pos.y,
        isAlive: true,
        peaceVote: 'no',
      };
    }

    const now = new Date();
    const startingPhase = this.getExpectedUtcPhase(now);
    const { phaseStartedAt, phaseEndsAt } = this.getUtcPhaseWindow(now, startingPhase);

    const game: GameRecord = {
      id: gameId,
      currentDay: 1,
      phase: startingPhase,
      phaseStartedAt: phaseStartedAt.toISOString(),
      phaseEndsAt: phaseEndsAt.toISOString(),
      locked: false,
      endReason: null,
    };
    db.createGame(game);

    const seed = Math.floor(Math.random() * 900000) + 100000;
    const priorityOrder = deterministicShuffle(allPlayers.map((p) => p.id), seed);

    const day1State: GameStateRecord = {
      id: uuidv4(),
      gameId,
      day: 1,
      locked: false,
      data: {
        prioritySeed: seed,
        playerPriorityOrder: priorityOrder,
        players: playersSnapshot,
        buildings: [],
        events: [],
      },
    };
    db.saveGameState(day1State);

    this.log('info', `New game ${gameId} launched on Day 1 with ${allPlayers.length} players!`);
    return game;
  }

  /**
   * Calculates current UTC cycle phase ('open' or 'closed')
   */
  getExpectedUtcPhase(now: Date = new Date()): Phase {
    const hour = now.getUTCHours();
    if (hour >= GAME_RULES.SCHEDULE.CLOSED_PHASE_START_HOUR_UTC) {
      return 'closed';
    }
    return 'open';
  }

  /**
   * Calculates start and end timestamps for the current UTC phase window
   */
  getUtcPhaseWindow(now: Date, phase: Phase): { phaseStartedAt: Date; phaseEndsAt: Date } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();

    if (phase === 'open') {
      const start = new Date(Date.UTC(y, m, d, 0, 0, 0));
      const end = new Date(Date.UTC(y, m, d, 20, 0, 0));
      return { phaseStartedAt: start, phaseEndsAt: end };
    } else {
      const start = new Date(Date.UTC(y, m, d, 20, 0, 0));
      const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
      return { phaseStartedAt: start, phaseEndsAt: end };
    }
  }

  /**
   * Starts background scheduler tick checking UTC cycle
   */
  private startScheduler() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = setInterval(() => {
      this.checkSchedulerTick();
    }, 15000); // Check every 15 seconds
  }

  checkSchedulerTick() {
    const game = db.getCurrentGame();
    if (!game || game.phase === 'over' || game.currentDay === 0 || game.endReason === 'waiting_to_start') {
      return; // Do not auto-advance if no game started or game is over
    }

    const now = new Date();
    const phaseExpired = now.getTime() >= new Date(game.phaseEndsAt).getTime();
    const expectedUtcPhase = this.getExpectedUtcPhase(now);

    // Repair a stale open-phase window (e.g. legacy games started with a past
    // 20:00 end time) instead of prematurely resolving the round.
    if (game.phase === 'open' && expectedUtcPhase === 'open' && phaseExpired) {
      const { phaseStartedAt, phaseEndsAt } = this.getUtcPhaseWindow(now, 'open');
      game.phaseStartedAt = phaseStartedAt.toISOString();
      game.phaseEndsAt = phaseEndsAt.toISOString();
      db.updateGame(game);
      this.log('info', `Repaired OPEN phase window for game ${game.id} (ends ${game.phaseEndsAt}).`);
      return;
    }

    // If current phase has expired by timestamp OR scheduled UTC window transitioned:
    if (game.phase === 'open' && (phaseExpired || expectedUtcPhase === 'closed')) {
      this.log('info', `Open phase expired. Transitioning to closed phase and processing round ${game.currentDay}...`);
      this.processRound(game.id, 'closed');
      const updated = db.getCurrentGame();
      if (updated && updated.phase === 'closed') {
        const { phaseStartedAt, phaseEndsAt } = this.getUtcPhaseWindow(now, 'closed');
        updated.phaseStartedAt = phaseStartedAt.toISOString();
        updated.phaseEndsAt = phaseEndsAt.toISOString();
        db.updateGame(updated);
      }
    } else if (game.phase === 'closed' && (phaseExpired || expectedUtcPhase === 'open')) {
      const { phaseStartedAt, phaseEndsAt } = this.getUtcPhaseWindow(now, 'open');
      game.phase = 'open';
      game.phaseStartedAt = phaseStartedAt.toISOString();
      game.phaseEndsAt = phaseEndsAt.toISOString();
      db.updateGame(game);
      this.log('info', `Closed phase expired. Game ${game.id} is now OPEN for Day ${game.currentDay}`);
    }
  }

  /**
   * Admin trigger: Immediately jump to the next phase.
   * Sets current phase timer to 0, transitions immediately,
   * and initializes the next phase with a full 20-hour (if Open) or 4-hour (if Closed) countdown.
   */
  jumpToNextPhase(): { success: boolean; error?: string; game?: GameRecord } {
    const game = db.getCurrentGame();
    if (!game) return { success: false, error: 'No active game found' };

    if (game.phase === 'over') {
      return { success: false, error: 'Current game has concluded. Launch a new game to restart.' };
    }

    const now = new Date();

    if (game.currentDay === 0 || game.endReason === 'waiting_to_start') {
      const newGame = this.startNewGame();
      this.log('info', `Admin jumped phase: Staged game launched on Day 1 ${newGame.phase.toUpperCase()} following the UTC schedule.`);
      return { success: true, game: newGame };
    }

    if (game.phase === 'open') {
      // Open -> Closed:
      // Expires current 20h timer, atomically resolves actions for Day N,
      // and starts Closed Phase with a fresh 4-hour calculation timer.
      this.log('info', `Admin jumped phase: ending OPEN phase (timer set to 0), resolving Day ${game.currentDay} and switching to CLOSED phase...`);
      const result = this.processRound(game.id, 'closed');
      if (!result.success) return result;

      const updated = db.getCurrentGame()!;
      updated.phaseStartedAt = now.toISOString();
      updated.phaseEndsAt = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
      db.updateGame(updated);
      this.log('info', `Game is now in CLOSED phase for Day ${updated.currentDay} with 4-hour calculation timer.`);
      return { success: true, game: updated };
    } else {
      // Closed -> Open:
      // Expires current 4h timer, begins Open Phase with a fresh 20-hour timer.
      this.log('info', `Admin jumped phase: ending CLOSED phase (timer set to 0), opening Day ${game.currentDay} for player actions...`);
      game.phase = 'open';
      game.phaseStartedAt = now.toISOString();
      game.phaseEndsAt = new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString();
      db.updateGame(game);
      this.log('info', `Game is now in OPEN phase for Day ${game.currentDay} with 20-hour action timer.`);
      return { success: true, game };
    }
  }

  /**
   * Authoritative, atomic round processing from Day N to Day N+1
   */
  processRound(gameId: string, targetPhase: Phase = 'open'): { success: boolean; error?: string } {
    const locked = db.lockGame(gameId);
    if (!locked) {
      this.log('error', `Cannot process round for game ${gameId}: already locked by another process.`);
      return { success: false, error: 'Game is currently locked for processing' };
    }

    try {
      const game = db.getGame(gameId);
      if (!game) {
        throw new Error(`Game ${gameId} not found`);
      }
      if (game.phase === 'over' || game.currentDay === 0) {
        throw new Error(`Game ${gameId} cannot be processed (status: ${game.phase}, day: ${game.currentDay})`);
      }

      const day = game.currentDay;
      const currentState = db.getGameState(gameId, day);
      if (!currentState) {
        throw new Error(`State for Day ${day} does not exist in game ${gameId}`);
      }

      const actions = db.getActionsForDay(gameId, day);
      const nextSeed = Math.floor(Math.random() * 900000) + 100000;

      this.log('info', `Resolving Day ${day} actions (${actions.length} action(s))...`);
      const { nextStateData, events, endReason } = GameEngine.resolveRound(
        currentState.data,
        actions,
        nextSeed
      );

      // Save next Day N+1 state
      const nextDay = day + 1;
      const nextStateRecord: GameStateRecord = {
        id: uuidv4(),
        gameId,
        day: nextDay,
        locked: false,
        data: nextStateData,
      };
      db.saveGameState(nextStateRecord);

      // Update player statistics
      const allPlayers = db.getAllPlayers();
      for (const p of allPlayers) {
        const snap = nextStateData.players[p.id];
        if (snap) {
          const prevSnap = currentState.data.players[p.id];
          if (prevSnap && prevSnap.isAlive && !snap.isAlive) {
            p.stats.deaths += 1;
          }
          if (endReason === 'world_peace') {
            p.stats.gamesPlayed += 1;
            if (snap.isAlive) p.stats.worldPeaces += 1;
          } else if (endReason === 'last_player_standing') {
            p.stats.gamesPlayed += 1;
            if (snap.isAlive) p.stats.lastOneStandings += 1;
          }
          db.savePlayer(p);
        }
      }

      // Update game record
      const now = new Date();
      const { phaseStartedAt, phaseEndsAt } = this.getUtcPhaseWindow(now, targetPhase);

      game.currentDay = nextDay;
      if (endReason) {
        game.phase = 'over';
        game.endReason = endReason;
      } else {
        game.phase = targetPhase;
      }
      game.phaseStartedAt = phaseStartedAt.toISOString();
      game.phaseEndsAt = phaseEndsAt.toISOString();
      game.locked = false;
      db.updateGame(game);

      this.log(
        'info',
        `Successfully advanced Game ${gameId} to Day ${nextDay}. Generated ${events.length} event(s). End condition: ${endReason || 'none'}`
      );

      return { success: true };
    } catch (err: any) {
      this.log('error', `Failed processing round for game ${gameId}: ${err?.message || err}`);
      db.unlockGame(gameId);
      return { success: false, error: err?.message || 'Processing failed' };
    }
  }

  adminAdvanceRound(): { success: boolean; error?: string } {
    const game = db.getCurrentGame();
    if (!game || game.currentDay === 0) return { success: false, error: 'No active game started' };
    return this.processRound(game.id, 'open');
  }

  /**
   * Resets game back to closed waiting state
   */
  resetToWaiting(): GameRecord {
    this.bootstrapInitialGame();
    return db.getCurrentGame()!;
  }
}

export const gameService = GameService.getInstance();
