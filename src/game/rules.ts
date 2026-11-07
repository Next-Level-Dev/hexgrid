/**
 * Centralized Game Rules & Constants
 * Reference: RULE_DECISIONS.md & Master Prompt
 */
import { ActionType, BuildingType } from '../types/game';

export const GAME_RULES = {
  // Map dimensions
  GRID_SIZE: 25,
  MIN_COORD: 1,
  MAX_COORD: 25,

  // Player bounds
  INITIAL_HEALTH: 3,
  MAX_HEALTH: 3,
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
      centerDamage: 2,
      surroundDamage: 1,
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
    OPEN_PHASE_START_HOUR_UTC: 0,
    OPEN_PHASE_DURATION_HOURS: 20, // 00:00 to 20:00 UTC
    CLOSED_PHASE_START_HOUR_UTC: 20,
    CLOSED_PHASE_DURATION_HOURS: 4, // 20:00 to 24:00 (00:00) UTC
  },
};

/**
 * Returns the global action priority group (1-5) for a given action type.
 * Priority 1: Sending points
 * Priority 2: Healing
 * Priority 3: Building (and Claiming Bank)
 * Priority 4: Moving
 * Priority 5: Attacking (and Nuclear launch)
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
    case 'launch_nuke':
      return 5;
  }
}

/**
 * Fixed cost for fixed-cost actions. Returns null for amount-based variable actions.
 */
export function getFixedActionCost(
  actionType: ActionType,
  buildingType?: BuildingType
): number | null {
  if (actionType === 'move') return 1;
  if (actionType === 'claim_bank') return GAME_RULES.BUILDINGS.bank.claimCost;
  if (actionType === 'launch_nuke') return GAME_RULES.BUILDINGS.silo.launchCost;
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
    toX < GAME_RULES.MIN_COORD ||
    toX > GAME_RULES.MAX_COORD ||
    toY < GAME_RULES.MIN_COORD ||
    toY > GAME_RULES.MAX_COORD
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
  includeSelf = false
): Array<{ x: number; y: number }> {
  const coords: Array<{ x: number; y: number }> = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const tx = centerX + dx;
      const ty = centerY + dy;
      if (isSquareInPlayerRange(centerX, centerY, tx, ty, includeSelf)) {
        coords.push({ x: tx, y: ty });
      }
    }
  }
  return coords;
}

/**
 * Generates a randomized player spawn position complying with:
 * - Never in the outer 2 layers (X in [2, 22], Y in [2, 22])
 * - Never directly adjacent to any existing player (Chebyshev distance > 1)
 */
export function generateSafeSpawnPosition(
  existingPositions: Array<{ x: number; y: number }>
): { x: number; y: number } {
  const MIN_SPAWN = 3;
  const MAX_SPAWN = 23; // Excludes outer 2 layers: 1, 2 and 24, 25

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
  return { x: 13, y: 13 };
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
