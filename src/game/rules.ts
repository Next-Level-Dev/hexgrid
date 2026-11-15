/**
 * Centralized Game Rules & Constants
 * Reference: RULE_DECISIONS.md & Master Prompt
 */
import { ActionType, BuildingType } from '../types/game';

/**
 * The first coordinate is always 1. Map size is chosen per-game by an admin.
 */
export const MIN_COORD = 1;
export const DEFAULT_MAP_SIZE = 25;
export const MAP_SIZE_MIN = 10;
export const MAP_SIZE_MAX = 50;
export const MAP_SIZE_STEP = 5;
export const MAP_SIZE_OPTIONS: number[] = Array.from(
  { length: (MAP_SIZE_MAX - MAP_SIZE_MIN) / MAP_SIZE_STEP + 1 },
  (_, i) => MAP_SIZE_MIN + i * MAP_SIZE_STEP
);

/**
 * Player health is chosen per-game by an admin, just like map size.
 */
export const DEFAULT_PLAYER_HEALTH = 3;
export const PLAYER_HEALTH_MIN = 1;
export const PLAYER_HEALTH_MAX = 10;
export const PLAYER_HEALTH_STEP = 1;
export const PLAYER_HEALTH_OPTIONS: number[] = Array.from(
  { length: (PLAYER_HEALTH_MAX - PLAYER_HEALTH_MIN) / PLAYER_HEALTH_STEP + 1 },
  (_, i) => PLAYER_HEALTH_MIN + i * PLAYER_HEALTH_STEP
);

export const DEFAULT_REWARD_POOL = 100;

/**
 * Each player may place this many mines over the lifetime of a game. Mines
 * that detonate or are destroyed still count toward the total.
 */
export const DEFAULT_MINE_LIMIT = 2;
export const MINE_LIMIT_MIN = 0;
export const MINE_LIMIT_MAX = 99;

/** The mine limit grows by +1 every N days. */
export const DEFAULT_MINE_LIMIT_INCREASE_DAYS = 10;
export const MINE_LIMIT_INCREASE_DAYS_MIN = 1;
export const MINE_LIMIT_INCREASE_DAYS_MAX = 999;

/**
 * Assassination is a range-free attack that costs a fixed number of points
 * for 1 guaranteed damage. Admins can change the cost per game; 0 disables it.
 */
export const DEFAULT_ASSASSINATION_COST = 3;
export const ASSASSINATION_COST_MIN = 0;
export const ASSASSINATION_COST_MAX = 99;
export const ASSASSINATION_DAMAGE = 1;

export const ALL_BUILDING_TYPES: BuildingType[] = ['mine', 'outpost', 'silo', 'bank'];

export function createDefaultBuildingConfig(): Record<BuildingType, boolean> {
  return { mine: true, outpost: true, silo: true, bank: true };
}

export function isValidMapSize(size: number): boolean {
  return (
    Number.isInteger(size) &&
    size >= MAP_SIZE_MIN &&
    size <= MAP_SIZE_MAX &&
    size % MAP_SIZE_STEP === 0
  );
}

export function isValidPlayerHealth(health: number): boolean {
  return (
    Number.isInteger(health) &&
    health >= PLAYER_HEALTH_MIN &&
    health <= PLAYER_HEALTH_MAX &&
    health % PLAYER_HEALTH_STEP === 0
  );
}

export function isValidRewardPool(pool: number): boolean {
  return Number.isSafeInteger(pool) && pool >= 0;
}

export function isValidMineLimit(limit: number): boolean {
  return (
    Number.isInteger(limit) &&
    limit >= MINE_LIMIT_MIN &&
    limit <= MINE_LIMIT_MAX
  );
}

export function isValidMineLimitIncreaseDays(days: number): boolean {
  return (
    Number.isInteger(days) &&
    days >= MINE_LIMIT_INCREASE_DAYS_MIN &&
    days <= MINE_LIMIT_INCREASE_DAYS_MAX
  );
}

export function isValidAssassinationCost(cost: number): boolean {
  return (
    Number.isInteger(cost) &&
    cost >= ASSASSINATION_COST_MIN &&
    cost <= ASSASSINATION_COST_MAX
  );
}

/**
 * Base mine limit plus one extra mine for every completed interval. The limit
 * increases on day 10, 20, 30, ... when the interval is 10.
 */
export function getMineLimitForDay(
  baseLimit: number,
  day: number,
  increaseEveryDays: number
): number {
  const base = Math.max(0, Math.floor(Number.isFinite(baseLimit) ? baseLimit : 0));
  const interval = Math.floor(
    Number.isFinite(increaseEveryDays) ? increaseEveryDays : 0
  );
  if (interval <= 0) return base;
  const safeDay = Math.max(0, Math.floor(Number.isFinite(day) ? day : 0));
  return base + Math.floor(safeDay / interval);
}

/**
 * The next day on which the mine limit will be higher, or null when the
 * increase interval is disabled.
 */
export function getNextMineLimitIncreaseDay(
  day: number,
  increaseEveryDays: number
): number | null {
  const interval = Math.floor(
    Number.isFinite(increaseEveryDays) ? increaseEveryDays : 0
  );
  if (interval <= 0) return null;
  const safeDay = Math.max(1, Math.floor(Number.isFinite(day) ? day : 1));
  return Math.ceil((safeDay + 1) / interval) * interval;
}

/**
 * The reward pool is split equally among winners. Remainders are intentionally
 * discarded, so a 100-token pool split by 3 awards 33 tokens to each winner.
 */
export function getRewardPerWinner(pool: number, winnerCount: number): number {
  const safePool = Math.max(0, Math.floor(Number.isFinite(pool) ? pool : 0));
  const safeCount = Math.floor(Number.isFinite(winnerCount) ? winnerCount : 0);
  if (safeCount <= 0) return 0;
  return Math.floor(safePool / safeCount);
}

export const GAME_RULES = {
  // Player bounds (defaults; the live cap is the game's playerHealth)
  INITIAL_HEALTH: DEFAULT_PLAYER_HEALTH,
  MAX_HEALTH: DEFAULT_PLAYER_HEALTH,
  POINTS_PER_ROUND: 1,
  INITIAL_POINTS: 1,

  // Conversion rates
  POINTS_PER_HEALTH: 1, // 1 point = 1 health restored
  DAMAGE_PER_POINT: 1,  // 1 point = 1 damage dealt

  // Ranges (Chebyshev distance: max(|x1 - x2|, |y1 - y2|))
  SEND_POINTS_RANGE: 4,
  BUILD_RANGE: 2,
  ATTACK_RANGE: 3,
  MOVE_STEP: 1,

  // Building costs and initial health
  BUILDINGS: {
    mine: {
      cost: 1,
      health: 1,
      blocksMovement: false,
      ownerOnlyVisible: true,
      damageOnTrigger: 1,
    },
    outpost: {
      cost: 1,
      health: 2,
      blocksMovement: true,
      ownerOnlyVisible: false,
    },
    silo: {
      cost: 2,
      health: 1,
      blocksMovement: true,
      ownerOnlyVisible: false,
      launchCost: 1,
      centerDamage: 3,
      surroundDamage: 2,
      outerDamage: 1,
    },
    bank: {
      cost: 1,
      health: 1,
      blocksMovement: true,
      ownerOnlyVisible: false,
      initialValue: 1,
      valueIncreasePerDay: 1,
      maxValue: 5,
      claimCost: 1,
    },
  } as const,

  // Daily cycle schedule (UTC)
  SCHEDULE: {
    OPEN_PHASE_START_HOUR_UTC: 2,
    OPEN_PHASE_DURATION_HOURS: 22, // 02:00 to 24:00 UTC
    CLOSED_PHASE_START_HOUR_UTC: 0,
    CLOSED_PHASE_DURATION_HOURS: 2, // 00:00 to 02:00 UTC
  },
};

/**
 * 13-tile nuclear blast: 3x3 core plus one extra tile at each cardinal end.
 * Center deals 3, the surrounding 8 deal 2, and the four outer tips deal 1.
 */
export const NUKE_BLAST_OFFSETS: ReadonlyArray<{
  dx: number;
  dy: number;
  damage: number;
}> = [
  { dx: 0, dy: 0, damage: GAME_RULES.BUILDINGS.silo.centerDamage },
  { dx: -1, dy: -1, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: 0, dy: -1, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: 1, dy: -1, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: -1, dy: 0, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: 1, dy: 0, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: -1, dy: 1, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: 0, dy: 1, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: 1, dy: 1, damage: GAME_RULES.BUILDINGS.silo.surroundDamage },
  { dx: 0, dy: -2, damage: GAME_RULES.BUILDINGS.silo.outerDamage },
  { dx: 0, dy: 2, damage: GAME_RULES.BUILDINGS.silo.outerDamage },
  { dx: -2, dy: 0, damage: GAME_RULES.BUILDINGS.silo.outerDamage },
  { dx: 2, dy: 0, damage: GAME_RULES.BUILDINGS.silo.outerDamage },
];

/**
 * Returns the global action priority group (1-5) for a given action type.
 * Priority 1: Sending points
 * Priority 2: Healing
 * Priority 3: Building (and Claiming Bank)
 * Priority 4: Moving
 * Priority 5: Attacking (and Nuclear launch / Assassination)
 */
export function getActionPriorityGroup(actionType: ActionType): 1 | 2 | 3 | 4 | 5 {
  switch (actionType) {
    case 'send_points':
      return 1;
    case 'heal':
      return 2;
    case 'build':
    case 'claim_bank':
      return 3;
    case 'move':
      return 4;
    case 'attack':
    case 'assassinate':
    case 'launch_nuke':
      return 5;
  }
}

/**
 * Fixed cost for fixed-cost actions. Returns null for amount-based variable actions.
 */
export function getFixedActionCost(
  actionType: ActionType,
  buildingType?: BuildingType,
  assassinationCost: number = DEFAULT_ASSASSINATION_COST
): number | null {
  if (actionType === 'move') return 1;
  if (actionType === 'claim_bank') return GAME_RULES.BUILDINGS.bank.claimCost;
  if (actionType === 'launch_nuke') return GAME_RULES.BUILDINGS.silo.launchCost;
  if (actionType === 'assassinate') return assassinationCost;
  if (actionType === 'build') {
    if (!buildingType) return 1;
    return GAME_RULES.BUILDINGS[buildingType].cost;
  }
  return null; // send_points, heal, attack are variable amount
}

/**
 * Computes whether a target tile (toX, toY) falls within a player's circular 5x5 action range.
 * Specification:
 * - 5x5 bounding box centered on player (|dx| <= 2, |dy| <= 2)
 * - Cannot reach corners: (|dx| === 2 && |dy| === 2) excluded
 * - Cannot act on own square: (dx === 0 && dy === 0) excluded
 * - Total of 21 squares (including center) or 20 external squares to act on.
 */
export function isSquareInPlayerRange(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  mapSize: number = DEFAULT_MAP_SIZE,
  includeSelf = false
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Must be within 5x5 box
  if (absDx > 2 || absDy > 2) return false;

  // Cannot reach the 4 corners
  if (absDx === 2 && absDy === 2) return false;

  // Cannot act on own square
  if (!includeSelf && dx === 0 && dy === 0) return false;

  // Bounds check within map
  if (
    toX < MIN_COORD ||
    toX > mapSize ||
    toY < MIN_COORD ||
    toY > mapSize
  ) {
    return false;
  }

  return true;
}

/**
 * Returns all coordinate pairs belonging to the circular 21-square range centered at (centerX, centerY).
 */
export function getPlayerRangeCoordinates(
  centerX: number,
  centerY: number,
  mapSize: number = DEFAULT_MAP_SIZE,
  includeSelf = false
): Array<{ x: number; y: number }> {
  const coords: Array<{ x: number; y: number }> = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const tx = centerX + dx;
      const ty = centerY + dy;
      if (isSquareInPlayerRange(centerX, centerY, tx, ty, mapSize, includeSelf)) {
        coords.push({ x: tx, y: ty });
      }
    }
  }
  return coords;
}

/**
 * Returns the bank value that will be available when the current round resolves.
 * Banks appreciate by +1 at the start of each round, capped at maxValue.
 */
export function getBankClaimValue(currentValue: number): number {
  return Math.min(
    currentValue + GAME_RULES.BUILDINGS.bank.valueIncreasePerDay,
    GAME_RULES.BUILDINGS.bank.maxValue
  );
}

/**
 * Generates a randomized player spawn position complying with:
 * - Never in the outer 2 layers (X in [2, 22], Y in [2, 22])
 * - Never directly adjacent to any existing player (Chebyshev distance > 1)
 */
export function generateSafeSpawnPosition(
  existingPositions: Array<{ x: number; y: number }>,
  mapSize: number = DEFAULT_MAP_SIZE
): { x: number; y: number } {
  const MIN_SPAWN = MIN_COORD + 2;
  const MAX_SPAWN = mapSize - 2; // Excludes outer 2 layers

  for (let attempt = 0; attempt < 1000; attempt++) {
    const x = Math.floor(Math.random() * (MAX_SPAWN - MIN_SPAWN + 1)) + MIN_SPAWN;
    const y = Math.floor(Math.random() * (MAX_SPAWN - MIN_SPAWN + 1)) + MIN_SPAWN;

    const isAdjacent = existingPositions.some(
      (pos) => Math.max(Math.abs(pos.x - x), Math.abs(pos.y - y)) <= 1
    );

    if (!isAdjacent) {
      return { x, y };
    }
  }

  // Fallback if tight
  const center = Math.ceil(mapSize / 2);
  return { x: center, y: center };
}

/**
 * Deterministic pseudo-random number generator (Mulberry32) for stable seed-based shuffling
 */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically shuffles an array using a numeric seed
 */
export function deterministicShuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  const rand = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
