/**
 * Database storage layer using node:sqlite DatabaseSync with WAL mode
 * Implements logical tables defined in Section 13:
 * games, game_states, actions, players, session_cookies, invitations
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import {
  GameRecord,
  GameStateRecord,
  Player,
  ActionSubmission,
  GameStateData,
  BuildingType
} from '../src/types/game';
import {
  ALL_BUILDING_TYPES,
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_HEALTH,
  DEFAULT_REWARD_POOL,
  DEFAULT_MINE_LIMIT,
  DEFAULT_MINE_LIMIT_INCREASE_DAYS,
  DEFAULT_ASSASSINATION_COST,
  createDefaultBuildingConfig
} from '../src/game/rules';

export const DB_DIR = path.resolve(process.cwd(), 'database');
export const DB_PATH = path.join(DB_DIR, 'hexgrid.db');

class GameDatabase {
  private db: DatabaseSync;

  constructor() {
    fs.mkdirSync(DB_DIR, { recursive: true });
    this.db = new DatabaseSync(DB_PATH);
    this.init();
  }

  private init() {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    // Table: games
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        current_day INTEGER NOT NULL,
        phase TEXT NOT NULL,
        phase_started_at TEXT NOT NULL,
        phase_ends_at TEXT NOT NULL,
        locked INTEGER NOT NULL DEFAULT 0,
        end_reason TEXT,
        map_size INTEGER NOT NULL DEFAULT 25,
        player_health INTEGER NOT NULL DEFAULT 3,
        reward_pool INTEGER NOT NULL DEFAULT ${DEFAULT_REWARD_POOL},
        enabled_buildings TEXT,
        mine_limit INTEGER NOT NULL DEFAULT ${DEFAULT_MINE_LIMIT},
        mine_limit_increase_days INTEGER NOT NULL DEFAULT ${DEFAULT_MINE_LIMIT_INCREASE_DAYS},
        assassination_cost INTEGER NOT NULL DEFAULT ${DEFAULT_ASSASSINATION_COST},
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // Migrate databases created before per-game settings existed
    this.ensureColumn('games', 'map_size', 'INTEGER NOT NULL DEFAULT 25');
    this.ensureColumn('games', 'player_health', 'INTEGER NOT NULL DEFAULT 3');
    this.ensureColumn('games', 'reward_pool', `INTEGER NOT NULL DEFAULT ${DEFAULT_REWARD_POOL}`);
    this.ensureColumn('games', 'enabled_buildings', 'TEXT');
    this.ensureColumn(
      'games',
      'mine_limit',
      `INTEGER NOT NULL DEFAULT ${DEFAULT_MINE_LIMIT}`
    );
    this.ensureColumn(
      'games',
      'mine_limit_increase_days',
      `INTEGER NOT NULL DEFAULT ${DEFAULT_MINE_LIMIT_INCREASE_DAYS}`
    );
    this.ensureColumn(
      'games',
      'assassination_cost',
      `INTEGER NOT NULL DEFAULT ${DEFAULT_ASSASSINATION_COST}`
    );
    this.ensureColumn('games', 'revision', 'INTEGER NOT NULL DEFAULT 0');

    // Table: game_states
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_states (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        data TEXT NOT NULL,
        locked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(game_id, day)
      );
    `);

    // Table: actions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        day INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Table: players
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        avatar_url TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        games TEXT NOT NULL,
        stats TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn('players', 'tokens', 'INTEGER NOT NULL DEFAULT 0');

    // Table: session_cookies
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_cookies (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // Table: invitations
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        username TEXT NOT NULL,
        created_by TEXT,
        used INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn('invitations', 'player_id', 'TEXT');

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_game_states_game_day ON game_states(game_id, day);
      CREATE INDEX IF NOT EXISTS idx_actions_game_day_player ON actions(game_id, day, player_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_hash ON session_cookies(token_hash);
      CREATE INDEX IF NOT EXISTS idx_invitations_hash ON invitations(token_hash);
    `);
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!columns.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  }

  /**
   * Normalizes the enabled-buildings map for a game.
   * - Legacy games without a stored map get every current building enabled.
   * - Buildings added after the game started are stored as disabled.
   */
  private normalizeBuildingConfig(raw: string | null): {
    config: Record<BuildingType, boolean>;
    changed: boolean;
  } {
    if (raw === null || raw === undefined) {
      return { config: createDefaultBuildingConfig(), changed: true };
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const config = {} as Record<BuildingType, boolean>;
    let changed = false;
    for (const type of ALL_BUILDING_TYPES) {
      if (Object.prototype.hasOwnProperty.call(parsed, type)) {
        config[type] = parsed[type] === true;
      } else {
        // A building that did not exist when the game started is disabled.
        config[type] = false;
        changed = true;
      }
    }

    return { config, changed };
  }

  private mapGameRow(row: any): GameRecord {
    const { config, changed } = this.normalizeBuildingConfig(row.enabled_buildings);
    if (changed) {
      const stmt = this.db.prepare(
        'UPDATE games SET enabled_buildings = ?, revision = revision + 1 WHERE id = ?'
      );
      stmt.run(JSON.stringify(config), row.id);
      row.revision = Number(row.revision) + 1;
    }

    return {
      id: row.id,
      revision: Number(row.revision) || 0,
      currentDay: row.current_day,
      phase: row.phase,
      phaseStartedAt: row.phase_started_at,
      phaseEndsAt: row.phase_ends_at,
      locked: Boolean(row.locked),
      endReason: row.end_reason,
      mapSize: Number(row.map_size) || DEFAULT_MAP_SIZE,
      playerHealth: Number(row.player_health) || DEFAULT_PLAYER_HEALTH,
      rewardPool: Number(row.reward_pool) || 0,
      enabledBuildings: config,
      mineLimit: Number.isFinite(Number(row.mine_limit))
        ? Math.max(0, Number(row.mine_limit))
        : DEFAULT_MINE_LIMIT,
      mineLimitIncreaseDays: Number.isFinite(Number(row.mine_limit_increase_days))
        ? Math.max(1, Number(row.mine_limit_increase_days))
        : DEFAULT_MINE_LIMIT_INCREASE_DAYS,
      assassinationCost: Number.isFinite(Number(row.assassination_cost))
        ? Math.max(0, Number(row.assassination_cost))
        : DEFAULT_ASSASSINATION_COST,
    };
  }

  // --- Games ---

  getGame(id: string): GameRecord | null {
    const stmt = this.db.prepare('SELECT * FROM games WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapGameRow(row);
  }

  getCurrentGame(): GameRecord | null {
    // Current single active or latest game
    const stmt = this.db.prepare('SELECT * FROM games ORDER BY created_at DESC LIMIT 1');
    const row = stmt.get() as any;
    if (!row) return null;
    return this.mapGameRow(row);
  }

  createGame(game: GameRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO games (id, current_day, phase, phase_started_at, phase_ends_at, locked, end_reason, map_size, player_health, reward_pool, enabled_buildings, mine_limit, mine_limit_increase_days, assassination_cost, revision, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      game.id,
      game.currentDay,
      game.phase,
      game.phaseStartedAt,
      game.phaseEndsAt,
      game.locked ? 1 : 0,
      game.endReason || null,
      game.mapSize,
      game.playerHealth,
      game.rewardPool,
      JSON.stringify(game.enabledBuildings),
      game.mineLimit,
      game.mineLimitIncreaseDays,
      game.assassinationCost,
      game.revision,
      new Date().toISOString()
    );
  }

  updateGame(game: GameRecord) {
    const stmt = this.db.prepare(`
      UPDATE games SET
        current_day = ?,
        phase = ?,
        phase_started_at = ?,
        phase_ends_at = ?,
        locked = ?,
        end_reason = ?,
        map_size = ?,
        player_health = ?,
        reward_pool = ?,
        enabled_buildings = ?,
        mine_limit = ?,
        mine_limit_increase_days = ?,
        assassination_cost = ?,
        revision = revision + 1
      WHERE id = ?
    `);
    stmt.run(
      game.currentDay,
      game.phase,
      game.phaseStartedAt,
      game.phaseEndsAt,
      game.locked ? 1 : 0,
      game.endReason || null,
      game.mapSize,
      game.playerHealth,
      game.rewardPool,
      JSON.stringify(game.enabledBuildings),
      game.mineLimit,
      game.mineLimitIncreaseDays,
      game.assassinationCost,
      game.id
    );
  }

  lockGame(id: string): boolean {
    const stmt = this.db.prepare(
      'UPDATE games SET locked = 1, revision = revision + 1 WHERE id = ? AND locked = 0'
    );
    const result = stmt.run(id) as any;
    return result.changes > 0;
  }

  unlockGame(id: string) {
    const stmt = this.db.prepare('UPDATE games SET locked = 0, revision = revision + 1 WHERE id = ?');
    stmt.run(id);
  }

  // --- Game States ---

  getGameState(gameId: string, day: number): GameStateRecord | null {
    const stmt = this.db.prepare('SELECT * FROM game_states WHERE game_id = ? AND day = ?');
    const row = stmt.get(gameId, day) as any;
    if (!row) return null;
    return {
      id: row.id,
      gameId: row.game_id,
      day: row.day,
      locked: Boolean(row.locked),
      data: JSON.parse(row.data) as GameStateData,
    };
  }

  getGameStatesUpTo(gameId: string, day: number): GameStateRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM game_states WHERE game_id = ? AND day <= ? ORDER BY day ASC'
    );
    return (stmt.all(gameId, day) as any[]).map((row) => ({
      id: row.id,
      gameId: row.game_id,
      day: row.day,
      locked: Boolean(row.locked),
      data: JSON.parse(row.data) as GameStateData,
    }));
  }

  saveGameState(state: GameStateRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO game_states (id, game_id, day, data, locked, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id, day) DO UPDATE SET
        data = excluded.data,
        locked = excluded.locked
    `);
    stmt.run(
      state.id,
      state.gameId,
      state.day,
      JSON.stringify(state.data),
      state.locked ? 1 : 0,
      new Date().toISOString()
    );
  }

  // --- Actions ---

  getActionsForDay(gameId: string, day: number): ActionSubmission[] {
    const stmt = this.db.prepare(`
      SELECT * FROM actions WHERE game_id = ? AND day = ? ORDER BY created_at ASC
    `);
    const rows = stmt.all(gameId, day) as any[];
    return rows.map((r) => {
      const parsed = JSON.parse(r.data);
      return {
        id: r.id,
        gameId: r.game_id,
        day: r.day,
        playerId: r.player_id,
        priorityGroup: parsed.priorityGroup,
        data: parsed.data,
      };
    });
  }

  getPlayerActionsForDay(gameId: string, day: number, playerId: string): ActionSubmission[] {
    const stmt = this.db.prepare(`
      SELECT * FROM actions WHERE game_id = ? AND day = ? AND player_id = ? ORDER BY created_at ASC
    `);
    const rows = stmt.all(gameId, day, playerId) as any[];
    return rows.map((r) => {
      const parsed = JSON.parse(r.data);
      return {
        id: r.id,
        gameId: r.game_id,
        day: r.day,
        playerId: r.player_id,
        priorityGroup: parsed.priorityGroup,
        data: parsed.data,
      };
    });
  }

  setPlayerActionsForDay(gameId: string, day: number, playerId: string, actions: ActionSubmission[]) {
    // Delete existing actions for player on that day, then insert new ones
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const deleteStmt = this.db.prepare('DELETE FROM actions WHERE game_id = ? AND day = ? AND player_id = ?');
      deleteStmt.run(gameId, day, playerId);

      const insertStmt = this.db.prepare(`
        INSERT INTO actions (id, game_id, day, player_id, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const act of actions) {
        insertStmt.run(
          act.id,
          gameId,
          day,
          playerId,
          JSON.stringify({
            priorityGroup: act.priorityGroup,
            data: act.data,
          }),
          new Date().toISOString()
        );
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  // --- Players ---

  getPlayer(id: string): Player | null {
    const stmt = this.db.prepare('SELECT * FROM players WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapPlayerRow(row);
  }

  getAllPlayers(): Player[] {
    const stmt = this.db.prepare('SELECT * FROM players ORDER BY username ASC');
    const rows = stmt.all() as any[];
    return rows.map((r) => this.mapPlayerRow(r));
  }

  savePlayer(player: Player) {
    const stmt = this.db.prepare(`
      INSERT INTO players (id, username, avatar_url, is_admin, tokens, games, stats, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        avatar_url = excluded.avatar_url,
        is_admin = excluded.is_admin,
        tokens = excluded.tokens,
        games = excluded.games,
        stats = excluded.stats
    `);
    stmt.run(
      player.id,
      player.username,
      player.avatarUrl,
      player.isAdmin ? 1 : 0,
      Math.max(0, Math.floor(player.tokens || 0)),
      JSON.stringify(player.games || {}),
      JSON.stringify(player.stats || { gamesPlayed: 0, worldPeaces: 0, lastOneStandings: 0, deaths: 0 }),
      new Date().toISOString()
    );
  }

  /**
   * Permanently removes a player and the identity-bound records that would
   * otherwise keep their sessions or invites alive. Stored game snapshots keep
   * their historical copy of the player.
   */
  deletePlayer(playerId: string) {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      this.db.prepare('DELETE FROM session_cookies WHERE player_id = ?').run(playerId);
      this.db.prepare('DELETE FROM invitations WHERE player_id = ?').run(playerId);
      this.db.prepare('DELETE FROM actions WHERE player_id = ?').run(playerId);
      this.db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  private mapPlayerRow(row: any): Player {
    return {
      id: row.id,
      username: row.username,
      avatarUrl: row.avatar_url,
      isAdmin: Boolean(row.is_admin),
      health: 3, // live health comes from active game state
      points: 1, // live points come from active game state
      tokens: Math.max(0, Number(row.tokens) || 0),
      x: 0,
      y: 0,
      isAlive: true,
      peaceVote: 'no',
      games: JSON.parse(row.games || '{}'),
      stats: JSON.parse(row.stats || '{"gamesPlayed":0,"worldPeaces":0,"lastOneStandings":0,"deaths":0}'),
    };
  }

  /**
   * Creates a consistent single-file snapshot of the database using VACUUM INTO.
   */
  createBackup(destinationPath: string) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const normalized = destinationPath.replace(/\\/g, '/').replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${normalized}';`);
  }

  // --- Sessions & Auth ---

  createSession(id: string, playerId: string, tokenHash: string, expiresAt: string) {
    const stmt = this.db.prepare(`
      INSERT INTO session_cookies (id, player_id, token_hash, expires_at, revoked, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `);
    stmt.run(id, playerId, tokenHash, expiresAt, new Date().toISOString());
  }

  getSessionByTokenHash(tokenHash: string) {
    const stmt = this.db.prepare(`
      SELECT s.*, p.username, p.avatar_url, p.is_admin
      FROM session_cookies s
      JOIN players p ON s.player_id = p.id
      WHERE s.token_hash = ? AND s.revoked = 0
    `);
    return stmt.get(tokenHash) as any;
  }

  touchSession(sessionId: string, expiresAt: string) {
    const stmt = this.db.prepare(
      'UPDATE session_cookies SET expires_at = ? WHERE id = ? AND revoked = 0'
    );
    stmt.run(expiresAt, sessionId);
  }

  revokeSession(sessionId: string) {
    const stmt = this.db.prepare('UPDATE session_cookies SET revoked = 1 WHERE id = ?');
    stmt.run(sessionId);
  }

  revokePlayerSessions(playerId: string) {
    const stmt = this.db.prepare('UPDATE session_cookies SET revoked = 1 WHERE player_id = ?');
    stmt.run(playerId);
  }

  // --- Invitations ---

  createInvitation(
    id: string,
    tokenHash: string,
    playerId: string | null,
    username: string,
    createdBy: string | null,
    expiresAt: string
  ) {
    const stmt = this.db.prepare(`
      INSERT INTO invitations (id, token_hash, player_id, username, created_by, used, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `);
    stmt.run(id, tokenHash, playerId, username, createdBy, expiresAt, new Date().toISOString());
  }

  getInvitationByHash(tokenHash: string) {
    const stmt = this.db.prepare('SELECT * FROM invitations WHERE token_hash = ? AND used = 0');
    return stmt.get(tokenHash) as any;
  }

  markInvitationUsed(id: string) {
    const stmt = this.db.prepare('UPDATE invitations SET used = 1 WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Invalidates legacy (pre player_id) invitations for a username. Used to
   * retire admin invite links that were created before admin links became
   * console-only.
   */
  invalidateLegacyInvitationsForUsername(username: string) {
    const stmt = this.db.prepare(
      'UPDATE invitations SET used = 1 WHERE used = 0 AND player_id IS NULL AND lower(username) = lower(?)'
    );
    stmt.run(username);
  }
}

export const db = new GameDatabase();
