/**
 * Game domain models and types for the turn-based multiplayer grid game
 */

export type Phase = 'open' | 'closed' | 'over';
export type WinReason = 'world_peace' | 'last_player_standing' | 'waiting_to_start' | null;

export interface Coordinates {
  x: number;
  y: number;
}

export interface PlayerStats {
  gamesPlayed: number;
  worldPeaces: number;
  lastOneStandings: number;
  deaths: number;
}

export interface PlayerGameMembership {
  lastDayViewed: number;
  peaceVote: 'yes' | 'no';
}

export interface Player {
  id: string; // UUID
  username: string;
  avatarUrl: string;
  health: number; // 0 to 3
  points: number;
  x: number;
  y: number;
  isAlive: boolean;
  isAdmin: boolean;
  peaceVote: 'yes' | 'no';
  stats: PlayerStats;
  games: Record<string, PlayerGameMembership>;
}

export type BuildingType = 'mine' | 'outpost' | 'silo' | 'bank';

export interface Building {
  id: string; // UUID
  type: BuildingType;
  ownerId: string;
  x: number;
  y: number;
  health: number;
  isArmed?: boolean; // For nuclear silo: arms on Day D+1
  value?: number;    // For bank: starts at 1, +1 each day up to 5
  isSpent?: boolean; // When silo launched or bank claimed
}

export type ActionType =
  | 'send_points'
  | 'heal'
  | 'build'
  | 'move'
  | 'attack'
  | 'claim_bank'
  | 'launch_nuke';

export interface ActionData {
  actionType: ActionType;
  targetPlayerId?: string;
  amount?: number;
  allowPartial?: boolean;
  buildingType?: BuildingType;
  buildingId?: string; // For claim_bank or launch_nuke
  x?: number;
  y?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  orderIndex?: number;
}

export interface ActionSubmission {
  id: string;
  gameId: string;
  day: number;
  playerId: string;
  priorityGroup: 1 | 2 | 3 | 4 | 5;
  data: ActionData;
}

export interface GameEngineEvent {
  id: string;
  type:
    | 'send_points'
    | 'heal'
    | 'build'
    | 'move'
    | 'attack'
    | 'damage'
    | 'death'
    | 'building_destroyed'
    | 'mine_triggered'
    | 'nuke_launch'
    | 'bank_claimed'
    | 'cancelled';
  playerId?: string;
  targetPlayerId?: string;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  amount?: number;
  damage?: number;
  buildingId?: string;
  buildingType?: BuildingType;
  reason?: string;
  partial?: boolean;
  description: string;
}

export interface GameStateData {
  prioritySeed: number;
  playerPriorityOrder: string[]; // Player IDs in execution priority order
  players: Record<string, {
    id: string;
    username: string;
    avatarUrl: string;
    health: number;
    points: number;
    x: number;
    y: number;
    isAlive: boolean;
    peaceVote: 'yes' | 'no';
  }>;
  buildings: Building[];
  events?: GameEngineEvent[]; // Authoritative events that created this state from previous day
}

export interface GameRecord {
  id: string;
  currentDay: number;
  phase: Phase;
  phaseStartedAt: string; // ISO UTC
  phaseEndsAt: string;   // ISO UTC
  locked: boolean;
  endReason?: WinReason;
  mapSize: number;
  enabledBuildings: Record<BuildingType, boolean>;
}

export interface GameStateRecord {
  id: string;
  gameId: string;
  day: number;
  data: GameStateData;
  locked: boolean;
}
