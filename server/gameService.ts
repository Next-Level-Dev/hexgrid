/**
 * Game Service: Manages game lifecycle, database persistence, UTC cycle scheduling, and atomic round processing.
 */
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { GameEngine } from './engine';
import {
  GameRecord,
  GameStateRecord,
  GameStateData,
  Player,
  Phase,
  BuildingType,
} from '../src/types/game';
import {
  GAME_RULES,
  ALL_BUILDING_TYPES,
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_HEALTH,
  DEFAULT_REWARD_POOL,
  DEFAULT_MINE_LIMIT,
  DEFAULT_MINE_LIMIT_INCREASE_DAYS,
  DEFAULT_ASSASSINATION_COST,
  ASSASSINATION_COST_MIN,
  ASSASSINATION_COST_MAX,
  createDefaultBuildingConfig,
  isValidMapSize,
  isValidPlayerHealth,
  isValidRewardPool,
  isValidMineLimit,
  isValidMineLimitIncreaseDays,
  isValidAssassinationCost,
  getRewardPerWinner,
  deterministicShuffle,
  generateSafeSpawnPosition,
} from '../src/game/rules';
import { backupDatabaseIfDue } from './backup';
import { ensureSingleAdmin } from './admin';

export interface StartGameOptions {
  mapSize?: number;
  playerHealth?: number;
  rewardPool?: number;
  enabledBuildings?: Partial<Record<BuildingType, boolean>>;
  mineLimit?: number;
  mineLimitIncreaseDays?: number;
  assassinationCost?: number;
}

export class GameService {
  private static instance: GameService;
  private intervalTimer: NodeJS.Timeout | null = null;
  public auditLogs: Array<{ timestamp: string; level: 'info' | 'error'; message: string }> = [];

  private constructor() {
    this.ensureInitialized();
    backupDatabaseIfDue();
    this.startScheduler();
    setInterval(() => backupDatabaseIfDue(), 60 * 60 * 1000);
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
    // 1. Ensure exactly one Admin exists (and demote any legacy extra admins)
    const admin = ensureSingleAdmin();
    this.log('info', `Admin account ensured: ${admin.username} (${admin.id}).`);

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
      mapSize: DEFAULT_MAP_SIZE,
      playerHealth: DEFAULT_PLAYER_HEALTH,
      rewardPool: DEFAULT_REWARD_POOL,
      enabledBuildings: createDefaultBuildingConfig(),
      mineLimit: DEFAULT_MINE_LIMIT,
      mineLimitIncreaseDays: DEFAULT_MINE_LIMIT_INCREASE_DAYS,
      assassinationCost: DEFAULT_ASSASSINATION_COST,
    };
    db.createGame(game);
    this.log('info', `Game ${gameId} initialized in closed state (waiting to be started).`);
  }

  /**
   * Starts a brand new game, spawning ALL currently registered players.
   * New players created during a running game will be included in the NEXT game!
   */
  startNewGame(options: StartGameOptions = {}): GameRecord {
    const gameId = uuidv4();
    const allPlayers = db.getAllPlayers();
    const spawnPositions: Array<{ x: number; y: number }> = [];

    const mapSize =
      options.mapSize !== undefined && isValidMapSize(options.mapSize)
        ? options.mapSize
        : DEFAULT_MAP_SIZE;
    const playerHealth =
      options.playerHealth !== undefined && isValidPlayerHealth(options.playerHealth)
        ? options.playerHealth
        : DEFAULT_PLAYER_HEALTH;
    const rewardPool =
      options.rewardPool !== undefined && isValidRewardPool(options.rewardPool)
        ? options.rewardPool
        : DEFAULT_REWARD_POOL;
    const enabledBuildings = createDefaultBuildingConfig();
    for (const type of ALL_BUILDING_TYPES) {
      if (typeof options.enabledBuildings?.[type] === 'boolean') {
        enabledBuildings[type] = options.enabledBuildings[type]!;
      }
    }
    const mineLimit =
      options.mineLimit !== undefined && isValidMineLimit(options.mineLimit)
        ? options.mineLimit
        : DEFAULT_MINE_LIMIT;
    const mineLimitIncreaseDays =
      options.mineLimitIncreaseDays !== undefined &&
      isValidMineLimitIncreaseDays(options.mineLimitIncreaseDays)
        ? options.mineLimitIncreaseDays
        : DEFAULT_MINE_LIMIT_INCREASE_DAYS;
    const assassinationCost =
      options.assassinationCost !== undefined &&
      isValidAssassinationCost(options.assassinationCost)
        ? options.assassinationCost
        : DEFAULT_ASSASSINATION_COST;

    const playersSnapshot: Record<string, any> = {};
    for (const p of allPlayers) {
      const pos = generateSafeSpawnPosition(spawnPositions, mapSize);
      spawnPositions.push(pos);

      p.x = pos.x;
      p.y = pos.y;
      p.health = playerHealth;
      p.points = 1;
      p.isAlive = true;
      p.peaceVote = 'no';
      p.games[gameId] = { lastDayViewed: 1, peaceVote: 'no' };
      db.savePlayer(p);

      playersSnapshot[p.id] = {
        id: p.id,
        username: p.username,
        avatarUrl: p.avatarUrl,
        health: playerHealth,
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
      mapSize,
      playerHealth,
      rewardPool,
      enabledBuildings,
      mineLimit,
      mineLimitIncreaseDays,
      assassinationCost,
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
        minesPlaced: {},
        events: [],
      },
    };
    db.saveGameState(day1State);

    this.log('info', `New game ${gameId} launched on Day 1 with ${allPlayers.length} players!`);
    return game;
  }

  /**
   * Awards the current game's reward pool to surviving winners. The pool is
   * split equally with any remainder discarded (100 / 3 = 33 per winner).
   */
  private awardRewardTokens(
    game: GameRecord,
    winnerIds: string[],
    reason: NonNullable<GameRecord['endReason']>
  ): { pool: number; distributed: number; perWinner: number; winnerCount: number } {
    const uniqueWinnerIds = Array.from(new Set(winnerIds));
    const pool = Math.max(0, Math.floor(game.rewardPool || 0));
    const perWinner = getRewardPerWinner(pool, uniqueWinnerIds.length);
    let distributed = 0;

    if (perWinner > 0) {
      for (const playerId of uniqueWinnerIds) {
        const player = db.getPlayer(playerId);
        if (!player) continue;
        player.tokens = Math.max(0, Math.floor(player.tokens || 0)) + perWinner;
        db.savePlayer(player);
        distributed += perWinner;
      }
    }

    this.log(
      'info',
      `Game ${game.id} ended (${reason}). Awarded ${perWinner} token(s) to ${uniqueWinnerIds.length} winner(s) from a ${pool}-token pool (${distributed} distributed).`
    );

    return { pool, distributed, perWinner, winnerCount: uniqueWinnerIds.length };
  }

  /**
   * Calculates current UTC cycle phase ('open' or 'closed')
   */
  getExpectedUtcPhase(now: Date = new Date()): Phase {
    const hour = now.getUTCHours();
    const start = GAME_RULES.SCHEDULE.CLOSED_PHASE_START_HOUR_UTC;
    const end = (start + GAME_RULES.SCHEDULE.CLOSED_PHASE_DURATION_HOURS) % 24;
    // Closed window within one calendar day (e.g. 00:00–02:00) or wrapping
    // past midnight (e.g. 22:00–02:00).
    const isClosed = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    return isClosed ? 'closed' : 'open';
  }

  /**
   * Calculates start and end timestamps for the current UTC phase window.
   * If today's window has already elapsed, the next daily occurrence is
   * returned so the window is always forward-looking.
   */
  getUtcPhaseWindow(now: Date, phase: Phase): { phaseStartedAt: Date; phaseEndsAt: Date } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();

    let startHour: number;
    let durationHours: number;
    if (phase === 'open') {
      startHour = GAME_RULES.SCHEDULE.OPEN_PHASE_START_HOUR_UTC;
      durationHours = GAME_RULES.SCHEDULE.OPEN_PHASE_DURATION_HOURS;
    } else {
      startHour = GAME_RULES.SCHEDULE.CLOSED_PHASE_START_HOUR_UTC;
      durationHours = GAME_RULES.SCHEDULE.CLOSED_PHASE_DURATION_HOURS;
    }

    let start = new Date(Date.UTC(y, m, d, startHour, 0, 0));
    let end = new Date(
      Date.UTC(y, m, d + Math.floor((startHour + durationHours) / 24), (startHour + durationHours) % 24, 0, 0)
    );

    // Roll forward to the next daily occurrence once this one has passed.
    if (end.getTime() <= now.getTime()) {
      start = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    return { phaseStartedAt: start, phaseEndsAt: end };
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
    // end time) instead of prematurely resolving the round.
    if (game.phase === 'open' && expectedUtcPhase === 'open' && phaseExpired) {
      const { phaseStartedAt, phaseEndsAt } = this.getUtcPhaseWindow(now, 'open');
      game.phaseStartedAt = phaseStartedAt.toISOString();
      game.phaseEndsAt = phaseEndsAt.toISOString();
      db.updateGame(game);
      this.log('info', `Repaired OPEN phase window for game ${game.id} (ends ${game.phaseEndsAt}).`);
      return;
    }

    // Phase transitions follow the stored phaseEndsAt timestamps so manual
    // admin phase control is never overridden by the wall-clock UTC schedule.
    // If current phase has expired by timestamp, transition to the next phase:
    if (game.phase === 'open' && phaseExpired) {
      this.log('info', `Open phase expired. Transitioning to closed phase and processing round ${game.currentDay}...`);
      this.processRound(game.id, 'closed');
    } else if (game.phase === 'closed' && phaseExpired) {
      game.phase = 'open';
      game.phaseStartedAt = now.toISOString();
      game.phaseEndsAt = this.getNextOpenPhaseEnd(now).toISOString();
      db.updateGame(game);
      this.log('info', `Closed phase expired. Game ${game.id} is now OPEN for Day ${game.currentDay}`);
    }
  }

  /**
   * End timestamp of the next natural OPEN phase window: the next
   * closed-phase start boundary (e.g. 24:00/00:00 UTC) from now.
   */
  getNextOpenPhaseEnd(now: Date = new Date()): Date {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    const closeHour = GAME_RULES.SCHEDULE.CLOSED_PHASE_START_HOUR_UTC;
    const todayEnd = new Date(Date.UTC(y, m, d, closeHour, 0, 0));
    return now.getTime() < todayEnd.getTime()
      ? todayEnd
      : new Date(Date.UTC(y, m, d + 1, closeHour, 0, 0));
  }

  /**
   * Admin trigger: instantly resolve the current day.
   * Calculates all planned actions for the current day and advances the game
   * to the next day in the OPEN phase, while keeping the timer untouched: the
   * new day still ends at the same scheduled UTC boundary (the daily cycle
   * moves exactly 24 hours), so early resolutions never drift the schedule
   * off its planned route.
   */
  resolveCurrentDay(): { success: boolean; error?: string; game?: GameRecord } {
    const game = db.getCurrentGame();
    if (!game) return { success: false, error: 'No active game found' };

    if (game.phase === 'over') {
      return { success: false, error: 'Current game has concluded. Launch a new game to restart.' };
    }
    if (game.currentDay === 0 || game.endReason === 'waiting_to_start') {
      return { success: false, error: 'Game has not started yet. Use Launch Game to start Day 1.' };
    }
    if (game.phase !== 'open') {
      return { success: false, error: 'The current day can only be resolved during the open phase.' };
    }

    const now = new Date();
    // The timer end is carried over to the next day so the countdown (and the
    // 24h UTC cycle it belongs to) stays exactly on its planned route.
    let nextPhaseEndsAt = new Date(game.phaseEndsAt);
    if (nextPhaseEndsAt.getTime() <= now.getTime()) {
      // Already-expired edge case: fall back to the next natural boundary.
      nextPhaseEndsAt = this.getNextOpenPhaseEnd(now);
    }

    this.log(
      'info',
      `Admin resolving Day ${game.currentDay}: calculating planned actions and advancing to the next day...`
    );
    const result = this.processRound(game.id, 'open');
    if (!result.success) return result;

    const updated = db.getCurrentGame()!;
    if (updated.phase === 'open') {
      updated.phaseStartedAt = now.toISOString();
      updated.phaseEndsAt = nextPhaseEndsAt.toISOString();
      db.updateGame(updated);
    }

    this.log(
      'info',
      `Game advanced to Day ${updated.currentDay} (OPEN). Timer unchanged — phase ends ${updated.phaseEndsAt}.`
    );
    return { success: true, game: updated };
  }

  /**
   * Reconstructs lifetime mine placements from every stored round. This keeps
   * mines that were later triggered or destroyed included in the player's
   * limit, and backfills games created before mine counts were persisted.
   */
  private getMineCountsUpTo(
    gameId: string,
    upToDay: number,
    currentState: GameStateData
  ): Record<string, number> {
    const stored = currentState.minesPlaced ?? {};
    const history: Record<string, number> = {};
    const seenMineIds = new Set<string>();

    for (const record of db.getGameStatesUpTo(gameId, upToDay)) {
      for (const event of record.data.events ?? []) {
        if (
          event.type !== 'build' ||
          event.buildingType !== 'mine' ||
          !event.playerId
        ) {
          continue;
        }
        const key =
          event.buildingId ??
          `${event.playerId}:${event.toX ?? '?'},${event.toY ?? '?'}:${event.id}`;
        if (seenMineIds.has(key)) continue;
        seenMineIds.add(key);
        history[event.playerId] = (history[event.playerId] ?? 0) + 1;
      }
    }

    const stillOnMap: Record<string, number> = {};
    for (const building of currentState.buildings) {
      if (building.type === 'mine') {
        stillOnMap[building.ownerId] = (stillOnMap[building.ownerId] ?? 0) + 1;
      }
    }

    const counts: Record<string, number> = {};
    const playerIds = new Set([
      ...Object.keys(stored),
      ...Object.keys(history),
      ...Object.keys(stillOnMap),
    ]);
    for (const playerId of playerIds) {
      counts[playerId] = Math.max(
        stored[playerId] ?? 0,
        history[playerId] ?? 0,
        stillOnMap[playerId] ?? 0
      );
    }
    return counts;
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

      currentState.data.minesPlaced = this.getMineCountsUpTo(
        gameId,
        day,
        currentState.data
      );

      this.log('info', `Resolving Day ${day} actions (${actions.length} action(s))...`);
      const { nextStateData, events, endReason } = GameEngine.resolveRound(
        currentState.data,
        actions,
        nextSeed,
        game.mapSize,
        game.enabledBuildings,
        game.playerHealth,
        game.mineLimit,
        game.mineLimitIncreaseDays,
        day,
        game.assassinationCost
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

      // Persistently award tokens to the game's surviving winners.
      if (endReason) {
        const winnerIds = Object.values(nextStateData.players)
          .filter((p) => p.isAlive)
          .map((p) => p.id);
        this.awardRewardTokens(game, winnerIds, endReason);
      }

      // Update game record
      const now = new Date();
      const { phaseEndsAt: utcPhaseEndsAt } = this.getUtcPhaseWindow(now, targetPhase);
      const naturalDurationMs =
        (targetPhase === 'closed'
          ? GAME_RULES.SCHEDULE.CLOSED_PHASE_DURATION_HOURS
          : GAME_RULES.SCHEDULE.OPEN_PHASE_DURATION_HOURS) *
        60 *
        60 *
        1000;

      game.currentDay = nextDay;
      if (endReason) {
        game.phase = 'over';
        game.endReason = endReason;
      } else {
        game.phase = targetPhase;
      }
      // Realign with the natural UTC window when it is close at hand, but
      // never run the phase longer than its normal duration when the round
      // is resolved off-grid (e.g. an admin ending the phase early).
      game.phaseStartedAt = now.toISOString();
      game.phaseEndsAt = new Date(
        Math.min(now.getTime() + naturalDurationMs, utcPhaseEndsAt.getTime())
      ).toISOString();
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

  /**
   * Enables or disables a building type for the current game.
   * Existing buildings remain on the map, but their interactions are rejected.
   */
  setBuildingEnabled(
    buildingType: BuildingType,
    enabled: boolean
  ): { success: boolean; error?: string; game?: GameRecord } {
    if (!ALL_BUILDING_TYPES.includes(buildingType)) {
      return { success: false, error: `Unknown building type: ${buildingType}` };
    }

    const game = db.getCurrentGame();
    if (!game) return { success: false, error: 'No active game found' };

    game.enabledBuildings = {
      ...game.enabledBuildings,
      [buildingType]: enabled,
    };
    db.updateGame(game);

    this.log(
      'info',
      `${buildingType.toUpperCase()} ${enabled ? 'enabled' : 'disabled'} for game ${game.id}.`
    );
    return { success: true, game };
  }

  /**
   * Updates the reward pool for the currently active game.
   */
  updateRewardPool(rewardPool: number): {
    success: boolean;
    error?: string;
    game?: GameRecord;
  } {
    if (!isValidRewardPool(rewardPool)) {
      return { success: false, error: 'Reward pool must be a whole number of 0 or greater' };
    }

    const game = db.getCurrentGame();
    if (!game) return { success: false, error: 'No active game found' };
    if (game.currentDay === 0 || game.endReason === 'waiting_to_start') {
      return { success: false, error: 'The game has not started yet.' };
    }
    if (game.phase === 'over') {
      return { success: false, error: 'The game has already concluded.' };
    }

    game.rewardPool = rewardPool;
    db.updateGame(game);

    this.log('info', `Reward pool updated to ${rewardPool} tokens for game ${game.id}.`);
    return { success: true, game };
  }

  /**
   * Updates the per-player mine limit and how often it increases. The new
   * rules apply immediately to the current day and all future rounds.
   */
  updateMineRules(
    mineLimit: number,
    mineLimitIncreaseDays: number
  ): { success: boolean; error?: string; game?: GameRecord } {
    if (!isValidMineLimit(mineLimit)) {
      return {
        success: false,
        error: `Mine limit must be a whole number between 0 and 99`,
      };
    }
    if (!isValidMineLimitIncreaseDays(mineLimitIncreaseDays)) {
      return {
        success: false,
        error: 'Mine limit increase interval must be between 1 and 999 days',
      };
    }

    const game = db.getCurrentGame();
    if (!game) return { success: false, error: 'No active game found' };
    if (game.currentDay === 0 || game.endReason === 'waiting_to_start') {
      return { success: false, error: 'The game has not started yet.' };
    }
    if (game.phase === 'over') {
      return { success: false, error: 'The game has already concluded.' };
    }

    game.mineLimit = mineLimit;
    game.mineLimitIncreaseDays = mineLimitIncreaseDays;
    db.updateGame(game);

    this.log(
      'info',
      `Mine limit updated to ${mineLimit} per player (+1 every ${mineLimitIncreaseDays} day(s)) for game ${game.id}.`
    );
    return { success: true, game };
  }

  /**
   * Updates the fixed point cost of assassination. 0 disables the action.
   */
  updateAssassinationCost(
    assassinationCost: number
  ): { success: boolean; error?: string; game?: GameRecord } {
    if (!isValidAssassinationCost(assassinationCost)) {
      return {
        success: false,
        error: `Assassination cost must be a whole number between ${ASSASSINATION_COST_MIN} and ${ASSASSINATION_COST_MAX}`,
      };
    }

    const game = db.getCurrentGame();
    if (!game) return { success: false, error: 'No active game found' };
    if (game.currentDay === 0 || game.endReason === 'waiting_to_start') {
      return { success: false, error: 'The game has not started yet.' };
    }
    if (game.phase === 'over') {
      return { success: false, error: 'The game has already concluded.' };
    }

    game.assassinationCost = assassinationCost;
    db.updateGame(game);

    this.log(
      'info',
      assassinationCost === 0
        ? `Assassination disabled for game ${game.id}.`
        : `Assassination cost updated to ${assassinationCost} pt(s) for game ${game.id}.`
    );
    return { success: true, game };
  }

  /**
   * Admin trigger: end the game immediately as World Peace.
   * The configured reward pool is split equally across surviving winners,
   * the game is marked over, and stats are updated.
   */
  endGameEarly(): {
    success: boolean;
    error?: string;
    game?: GameRecord;
    distributed?: number;
    perPlayer?: number;
  } {
    const game = db.getCurrentGame();
    if (!game) return { success: false, error: 'No active game found' };
    if (game.phase === 'over') {
      return { success: false, error: 'Current game has already concluded.' };
    }
    if (game.currentDay === 0 || game.endReason === 'waiting_to_start') {
      return { success: false, error: 'The game has not started yet.' };
    }

    const locked = db.lockGame(game.id);
    if (!locked) {
      return { success: false, error: 'Game is currently locked for processing' };
    }

    try {
      const state = db.getGameState(game.id, game.currentDay);
      if (!state) {
        throw new Error(`State for Day ${game.currentDay} does not exist`);
      }

      const participants = Object.values(state.data.players);
      const winnerIds = participants.filter((p) => p.isAlive).map((p) => p.id);

      // Mirror the same stat bookkeeping used by a naturally resolved
      // World Peace round.
      const allPlayers = db.getAllPlayers();
      for (const p of allPlayers) {
        const snap = state.data.players[p.id];
        if (snap) {
          p.stats.gamesPlayed += 1;
          if (snap.isAlive) p.stats.worldPeaces += 1;
          db.savePlayer(p);
        }
      }

      const reward = this.awardRewardTokens(game, winnerIds, 'world_peace');

      if (reward.pool > 0) {
        state.data.events = [
          ...(state.data.events ?? []),
          {
            id: uuidv4(),
            type: 'world_peace',
            description:
              reward.winnerCount > 0
                ? `World Peace declared. The ${reward.pool}-token reward pool was split equally among ${reward.winnerCount} surviving winner(s): ${reward.perWinner} token(s) each.`
                : `World Peace declared. No surviving winners were available for the ${reward.pool}-token reward pool.`,
          },
        ];
      }
      db.saveGameState(state);

      const now = new Date();
      game.phase = 'over';
      game.endReason = 'world_peace';
      game.phaseStartedAt = now.toISOString();
      game.phaseEndsAt = now.toISOString();
      game.locked = false;
      db.updateGame(game);

      this.log(
        'info',
        `Admin ended Game ${game.id} early with World Peace. ${reward.distributed} of ${reward.pool} token(s) distributed across ${reward.winnerCount} winner(s).`
      );

      return {
        success: true,
        game,
        distributed: reward.distributed,
        perPlayer: reward.perWinner,
      };
    } catch (err: any) {
      this.log(
        'error',
        `Failed to end game ${game.id} early: ${err?.message || err}`
      );
      db.unlockGame(game.id);
      return { success: false, error: err?.message || 'Failed to end game' };
    }
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
