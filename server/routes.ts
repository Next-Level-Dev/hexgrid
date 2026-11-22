/**
 * Express REST API Routes for HexGrid Tactics
 * Authoritative Server Validation on all Actions and Permissions
 */
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { gameService } from './gameService';
import {
  AuthenticatedRequest,
  authenticatePlayer,
  requireAuth,
  requireAdmin,
  createPlayerSession,
  generateSecureToken,
  hashToken,
} from './auth';
import {
  ActionSubmission,
  Building,
  Player,
  BuildingType,
  GameEngineEvent,
  GameStateData,
  GameRecord,
} from '../src/types/game';
import {
  ALL_BUILDING_TYPES,
  DEFAULT_MAP_SIZE,
  isValidMapSize,
  isValidPlayerHealth,
  isValidRewardPool,
  isValidMineLimit,
  isValidMineLimitIncreaseDays,
  isValidAssassinationCost,
  getActionPriorityGroup,
  getMineLimitForDay,
  getNextMineLimitIncreaseDay,
  generateSafeSpawnPosition,
} from '../src/game/rules';

export const apiRouter = Router();

apiRouter.use(authenticatePlayer);

/**
 * The day currently being calculated during the closed phase must stay sealed.
 * Only the previous day (and earlier) is visible until the open phase begins.
 */
function getHighestVisibleDay(game: { currentDay: number; phase: string }): number {
  if (!game || game.currentDay <= 0) return 0;
  if (game.phase === 'closed') return Math.max(1, game.currentDay - 1);
  return game.currentDay;
}

/**
 * Overlays the live (or latest visible) game snapshot onto the stored player
 * records. Points, health, position and alive state only exist inside the game
 * state, so without this the API would keep returning the placeholder values
 * (1 point, full health) after a server restart.
 */
function withLivePlayerState(players: Player[], game: GameRecord | null): Player[] {
  if (!game || game.currentDay <= 0) return players;

  const visibleDay = getHighestVisibleDay(game);
  if (visibleDay <= 0) return players;

  const state = db.getGameState(game.id, visibleDay);
  if (!state) return players;

  return players.map((player) => {
    const snap = state.data.players[player.id];
    return snap ? { ...player, ...snap } : player;
  });
}

function findPlayerByUsername(username: string, excludeId?: string): Player | undefined {
  const normalized = username.trim().toLowerCase();
  return db
    .getAllPlayers()
    .find((p) => p.id !== excludeId && p.username.trim().toLowerCase() === normalized);
}

/**
 * Mines are private: reconstruct their owners from every state up to the
 * requested day so triggered/destroyed mines can still be attributed even
 * though they have been removed from the final building list.
 */
function buildMineOwnerMap(gameId: string, upToDay: number): Map<string, string> {
  const owners = new Map<string, string>();
  for (const record of db.getGameStatesUpTo(gameId, upToDay)) {
    for (const building of record.data.buildings) {
      if (building.type === 'mine' && !owners.has(building.id)) {
        owners.set(building.id, building.ownerId);
      }
    }
    for (const event of record.data.events ?? []) {
      if (
        event.type === 'build' &&
        event.buildingType === 'mine' &&
        event.buildingId &&
        event.playerId
      ) {
        owners.set(event.buildingId, event.playerId);
      }
    }
  }
  return owners;
}

/**
 * Removes every trace of mines the viewer does not own, including coordinates
 * and coordinate-bearing descriptions embedded in replay events.
 */
function sanitizeStateForViewer(
  data: GameStateData,
  viewerId: string | undefined,
  mineOwners: Map<string, string>,
  mineCounts: Map<string, number>,
  revealMines: boolean
): GameStateData {
  const viewerMineCount = viewerId ? mineCounts.get(viewerId) ?? 0 : 0;
  const minesPlaced: Record<string, number> = viewerId
    ? { [viewerId]: viewerMineCount }
    : {};

  // Once the game is over, mines are no longer secret and the full replay is
  // safe to reveal.
  if (revealMines) {
    return { ...data, minesPlaced };
  }

  const buildings = data.buildings.filter(
    (building) => building.type !== 'mine' || building.ownerId === viewerId
  );

  const events = data.events
    ?.map((event): GameEngineEvent | null => {
      const isMineEvent =
        event.type === 'mine_triggered' ||
        (event.buildingType === 'mine' &&
          (event.type === 'build' || event.type === 'building_destroyed'));
      if (!isMineEvent) return event;

      const ownerId =
        event.type === 'build'
          ? event.playerId
          : event.buildingId
            ? mineOwners.get(event.buildingId)
            : undefined;

      if (ownerId && viewerId && ownerId === viewerId) return event;

      // Omit destroyed-mine events entirely: even without coordinates, they
      // could be correlated with the public attack/nuke target that caused
      // the destruction, revealing where the mine was.
      if (event.type === 'building_destroyed') return null;

      // Other players' placements are skipped completely during a live game
      // so replays never mention that a hidden mine was built.
      if (event.type === 'build') return null;

      const redacted: GameEngineEvent = { ...event };
      delete redacted.fromX;
      delete redacted.fromY;
      delete redacted.toX;
      delete redacted.toY;

      if (event.type === 'mine_triggered') {
        redacted.description = `A hidden mine detonated! -${event.damage ?? 0} HP`;
      }

      return redacted;
    })
    .filter((event): event is GameEngineEvent => event !== null);

  return { ...data, buildings, minesPlaced, events };
}

// --- User & Session Info ---

apiRouter.get('/me', (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  const allPlayers = withLivePlayerState(db.getAllPlayers(), game);
  const player = req.player
    ? allPlayers.find((p) => p.id === req.player!.id) ?? req.player
    : null;
  res.json({
    player,
    allPlayers,
  });
});


// Redeem invitation token
apiRouter.post('/auth/redeem-invite', (req: AuthenticatedRequest, res: Response) => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: 'Token is required' });
    return;
  }

  const tokenHash = hashToken(token);
  const invite = db.getInvitationByHash(tokenHash);
  if (!invite) {
    res.status(400).json({ error: 'Invalid or expired invitation link' });
    return;
  }

  if (new Date(invite.expires_at) < new Date()) {
    res.status(400).json({ error: 'Invitation link has expired' });
    return;
  }

  // Mark invitation used
  db.markInvitationUsed(invite.id);

  // Prefer the exact player the invitation was issued for. Older invitations
  // only stored a username, so fall back to that.
  let player = invite.player_id
    ? db.getPlayer(invite.player_id) ?? undefined
    : findPlayerByUsername(invite.username);
  if (!player) {
    const existing = db.getAllPlayers().map((p) => ({ x: p.x, y: p.y }));
    const mapSize = db.getCurrentGame()?.mapSize ?? DEFAULT_MAP_SIZE;
    const safePos = generateSafeSpawnPosition(existing, mapSize);

    player = {
      id: uuidv4(),
      username: invite.username,
      avatarUrl: `https://api.dicebear.com/10.x/initial-face/svg?seed=${encodeURIComponent(invite.username)}`,
      health: 3,
      points: 1,
      tokens: 0,
      x: safePos.x,
      y: safePos.y,
      isAlive: true,
      isAdmin: false,
      peaceVote: 'no',
      stats: { gamesPlayed: 0, worldPeaces: 0, lastOneStandings: 0, deaths: 0 },
      games: {},
    };
    db.savePlayer(player);
  }

  createPlayerSession(res, player);
  res.json({ success: true, player });
});

// Update profile for currently authenticated player
apiRouter.patch('/players/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const player = req.player!;
  const { username, avatarUrl } = req.body;
  if (username && username.trim()) {
    const trimmed = username.trim();
    if (findPlayerByUsername(trimmed, player.id)) {
      res.status(409).json({ error: 'That username is already taken' });
      return;
    }
    player.username = trimmed;
  }
  if (avatarUrl && avatarUrl.trim()) player.avatarUrl = avatarUrl.trim();

  db.savePlayer(player);

  const game = db.getCurrentGame();
  if (game && game.currentDay > 0) {
    const state = db.getGameState(game.id, game.currentDay);
    if (state && state.data.players[player.id]) {
      state.data.players[player.id].username = player.username;
      state.data.players[player.id].avatarUrl = player.avatarUrl;
      db.saveGameState(state);
    }
  }

  res.json({ success: true, player });
});

// Logout
apiRouter.post('/auth/logout', (req: AuthenticatedRequest, res: Response) => {
  if (req.player) {
    db.revokePlayerSessions(req.player.id);
  }
  res.clearCookie('hexgrid_session');
  res.json({ success: true });
});

// --- Game Status & Schedule ---

apiRouter.get('/game/current', (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  if (!game) {
    res.status(404).json({ error: 'No active game' });
    return;
  }

  const now = Date.now();
  const endsAt = new Date(game.phaseEndsAt).getTime();
  const secondsRemaining = Math.max(0, Math.floor((endsAt - now) / 1000));

  // Determine user's last viewed day
  let lastDayViewed = game.currentDay;
  let peaceVote: 'yes' | 'no' = 'no';
  if (req.player) {
    const membership = req.player.games[game.id];
    if (membership?.lastDayViewed) {
      lastDayViewed = membership.lastDayViewed;
    }
    if (membership?.peaceVote) {
      peaceVote = membership.peaceVote;
    }
  }

  const version = `${game.id}:${game.revision}:${lastDayViewed}:${peaceVote}`;
  const requestedVersion = typeof req.query.version === 'string' ? req.query.version : '';
  res.set('Cache-Control', 'no-store');

  if (requestedVersion === version) {
    res.json({ version, secondsRemaining, unchanged: true });
    return;
  }

  res.json({
    version,
    secondsRemaining,
    game,
    timer: {
      phase: game.phase,
      phaseStartedAt: game.phaseStartedAt,
      phaseEndsAt: game.phaseEndsAt,
      secondsRemaining,
      isClosed: game.phase === 'closed',
    },
    userContext: {
      lastDayViewed,
      peaceVote,
    },
  });
});

// --- Game State (Day Inspection) ---

apiRouter.get('/game/state/:day', (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  if (!game) {
    res.status(404).json({ error: 'No active game' });
    return;
  }

  const requestedDay = parseInt(req.params.day, 10);
  if (isNaN(requestedDay) || requestedDay < 1) {
    res.status(400).json({ error: 'Invalid day number' });
    return;
  }

  const highestVisibleDay = getHighestVisibleDay(game);
  if (requestedDay > highestVisibleDay) {
    res.status(403).json({
      error:
        game.phase === 'closed'
          ? `Day ${requestedDay} is sealed while the closed phase is calculating`
          : `Day ${requestedDay} has not been reached yet`,
    });
    return;
  }

  const stateRecord = db.getGameState(game.id, requestedDay);
  if (!stateRecord) {
    res.status(404).json({ error: `State for Day ${requestedDay} not found` });
    return;
  }

  // Mines stay private while the game is running. Once it is over the full
  // board (including every mine) can be revealed for post-game replays.
  const viewerId = req.player?.id;
  const mineOwners = buildMineOwnerMap(game.id, requestedDay);
  const mineCounts = new Map<string, number>();
  for (const ownerId of mineOwners.values()) {
    mineCounts.set(ownerId, (mineCounts.get(ownerId) ?? 0) + 1);
  }
  const sanitizedState = sanitizeStateForViewer(
    stateRecord.data,
    viewerId,
    mineOwners,
    mineCounts,
    game.phase === 'over'
  );

  res.json({
    day: stateRecord.day,
    gameId: stateRecord.gameId,
    state: sanitizedState,
  });
});

// --- Action Planning & Submissions ---

apiRouter.get('/game/actions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  if (!game) {
    res.status(404).json({ error: 'No active game' });
    return;
  }

  const highestVisibleDay = getHighestVisibleDay(game);
  const requestedDay =
    req.query.day !== undefined ? Number(req.query.day) : highestVisibleDay;
  if (
    !Number.isInteger(requestedDay) ||
    requestedDay < 1 ||
    requestedDay > highestVisibleDay
  ) {
    res.status(400).json({ error: 'Invalid or sealed day' });
    return;
  }

  const actions = db.getPlayerActionsForDay(game.id, requestedDay, req.player!.id);
  res.json({ actions });
});

apiRouter.post('/game/actions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  if (!game) {
    res.status(404).json({ error: 'No active game' });
    return;
  }

  // 1. Validate Phase
  if (game.phase !== 'open') {
    res.status(403).json({ error: 'Actions can only be submitted during the OPEN phase' });
    return;
  }

  // 2. Validate Player Status
  const currentState = db.getGameState(game.id, game.currentDay);
  const playerSnap = currentState?.data.players[req.player!.id];
  if (!playerSnap || !playerSnap.isAlive) {
    res.status(403).json({ error: 'Deceased players cannot submit actions' });
    return;
  }

  // 3. Parse and validate action payload
  const rawActions = req.body.actions;
  if (!Array.isArray(rawActions)) {
    res.status(400).json({ error: 'Actions payload must be an array' });
    return;
  }

  // Reject any action that references a building type disabled for this game.
  const nukeSiloIds = new Set<string>();
  for (const item of rawActions) {
    const disabledBuildingType: BuildingType | null =
      item.actionType === 'build'
        ? (item.buildingType as BuildingType)
        : item.actionType === 'claim_bank'
        ? 'bank'
        : item.actionType === 'launch_nuke'
        ? 'silo'
        : null;

    if (disabledBuildingType && !game.enabledBuildings[disabledBuildingType]) {
      res.status(400).json({
        error: `${disabledBuildingType} buildings are disabled in this game`,
      });
      return;
    }

    if (item.actionType === 'assassinate') {
      if (game.assassinationCost <= 0) {
        res.status(400).json({ error: 'Assassination is disabled in this game' });
        return;
      }
      const targetPlayerId =
        typeof item.targetPlayerId === 'string' ? item.targetPlayerId : '';
      const target = targetPlayerId
        ? currentState.data.players[targetPlayerId]
        : undefined;
      if (!target || !target.isAlive || targetPlayerId === req.player!.id) {
        res.status(400).json({ error: 'Assassination target must be a living opponent' });
        return;
      }
    }

    if (item.actionType === 'launch_nuke') {
      const buildingId = typeof item.buildingId === 'string' ? item.buildingId : '';
      const silo = buildingId
        ? currentState.data.buildings.find((b) => b.id === buildingId)
        : undefined;
      if (
        !silo ||
        silo.type !== 'silo' ||
        silo.ownerId !== req.player!.id ||
        !silo.isArmed ||
        silo.isSpent
      ) {
        res.status(400).json({
          error: 'Nuclear launches must target one of your ready, armed silos',
        });
        return;
      }
      if (nukeSiloIds.has(buildingId)) {
        res.status(400).json({ error: 'Each ready silo can only be assigned one nuclear target' });
        return;
      }
      nukeSiloIds.add(buildingId);

      const targetX = parseInt(item.x, 10);
      const targetY = parseInt(item.y, 10);
      if (
        !Number.isInteger(targetX) ||
        !Number.isInteger(targetY) ||
        targetX < 1 ||
        targetX > game.mapSize ||
        targetY < 1 ||
        targetY > game.mapSize
      ) {
        res.status(400).json({ error: 'Nuclear target must be a valid tile on the map' });
        return;
      }
    }
  }

  // Enforce the lifetime mine limit at submission time as well as in the
  // engine. Removed mines are reconstructed from all states up to today.
  const plannedMineBuilds = rawActions.filter(
    (item) => item.actionType === 'build' && item.buildingType === 'mine'
  ).length;
  if (plannedMineBuilds > 0) {
    const mineOwners = buildMineOwnerMap(game.id, game.currentDay);
    const mineCounts = new Map<string, number>();
    for (const ownerId of mineOwners.values()) {
      mineCounts.set(ownerId, (mineCounts.get(ownerId) ?? 0) + 1);
    }
    const used = Math.max(
      mineCounts.get(req.player!.id) ?? 0,
      currentState.data.minesPlaced?.[req.player!.id] ?? 0
    );
    const limit = getMineLimitForDay(
      game.mineLimit,
      game.currentDay,
      game.mineLimitIncreaseDays
    );
    if (used + plannedMineBuilds > limit) {
      const nextIncrease = getNextMineLimitIncreaseDay(
        game.currentDay,
        game.mineLimitIncreaseDays
      );
      res.status(400).json({
        error: `Mine limit reached: ${used}/${limit} placed.${
          nextIncrease ? ` The limit increases on Day ${nextIncrease}.` : ''
        }`,
      });
      return;
    }
  }

  const validatedActions: ActionSubmission[] = rawActions.map((item, idx) => {
    const actType = item.actionType;
    const priorityGroup = getActionPriorityGroup(actType);
    return {
      id: uuidv4(),
      gameId: game.id,
      day: game.currentDay,
      playerId: req.player!.id,
      priorityGroup,
      data: {
        actionType: actType,
        targetPlayerId: item.targetPlayerId,
        amount: item.amount ? Math.max(1, parseInt(item.amount, 10)) : 1,
        allowPartial: Boolean(item.allowPartial),
        buildingType: item.buildingType,
        buildingId: item.buildingId,
        x: item.x !== undefined ? parseInt(item.x, 10) : undefined,
        y: item.y !== undefined ? parseInt(item.y, 10) : undefined,
        direction: item.direction,
        orderIndex: idx,
      },
    };
  });

  db.setPlayerActionsForDay(game.id, game.currentDay, req.player!.id, validatedActions);
  res.json({ success: true, count: validatedActions.length });
});

// --- World Peace Voting ---

apiRouter.post('/game/vote', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  if (!game) {
    res.status(404).json({ error: 'No active game' });
    return;
  }

  if (game.phase !== 'open') {
    res.status(403).json({ error: 'Votes can only be changed during the OPEN phase' });
    return;
  }

  const { vote } = req.body;
  if (vote !== 'yes' && vote !== 'no') {
    res.status(400).json({ error: 'Vote must be "yes" or "no"' });
    return;
  }

  const player = req.player!;
  const currentState = db.getGameState(game.id, game.currentDay);
  const playerSnap = currentState?.data.players[player.id];
  if (!player.isAlive || (playerSnap && !playerSnap.isAlive)) {
    res.status(403).json({ error: 'Eliminated players cannot vote on world peace' });
    return;
  }

  if (currentState && currentState.data.players[player.id]) {
    currentState.data.players[player.id].peaceVote = vote;
    db.saveGameState(currentState);
  }

  player.peaceVote = vote;
  if (!player.games[game.id]) {
    player.games[game.id] = { lastDayViewed: game.currentDay, peaceVote: vote };
  } else {
    player.games[game.id].peaceVote = vote;
  }
  db.savePlayer(player);

  res.json({ success: true, vote });
});

// --- Progress to Next Day Record ---

apiRouter.post('/game/progress', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  if (!game) {
    res.status(404).json({ error: 'No active game' });
    return;
  }

  const { day } = req.body;
  const targetDay = parseInt(day, 10);
  if (isNaN(targetDay) || targetDay < 1) {
    res.status(400).json({ error: 'Invalid day' });
    return;
  }

  const highestVisibleDay = getHighestVisibleDay(game);
  if (targetDay > highestVisibleDay) {
    res.status(403).json({ error: 'Cannot record progress for a sealed or unreached day' });
    return;
  }

  const player = req.player!;
  const currentGameMembership = player.games[game.id] || { lastDayViewed: 1, peaceVote: 'no' };

  // Viewing an old day must never reduce last_day_viewed
  currentGameMembership.lastDayViewed = Math.max(currentGameMembership.lastDayViewed, targetDay);
  player.games[game.id] = currentGameMembership;
  db.savePlayer(player);

  res.json({ success: true, lastDayViewed: currentGameMembership.lastDayViewed });
});

// --- Admin Endpoints ---

apiRouter.post('/admin/players', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { username, avatarUrl } = req.body;
  if (!username || !username.trim()) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  if (findPlayerByUsername(username)) {
    res.status(409).json({ error: 'That username is already taken' });
    return;
  }

  const playerId = uuidv4();
  const newPlayer: Player = {
    id: playerId,
    username: username.trim(),
    avatarUrl: avatarUrl?.trim() || `https://api.dicebear.com/10.x/initial-face/svg?seed=${encodeURIComponent(username.trim())}`,
    health: 3,
    points: 1,
    tokens: 0,
    x: 13,
    y: 13,
    isAlive: true,
    isAdmin: false,
    peaceVote: 'no',
    stats: { gamesPlayed: 0, worldPeaces: 0, lastOneStandings: 0, deaths: 0 },
    games: {},
  };
  db.savePlayer(newPlayer);

  res.json({
    success: true,
    player: newPlayer,
  });
});

// Generate one-time authentication / invite link for a non-admin player.
// Admin auth links may only be generated from the server console via
// `npm run admin:link`.
apiRouter.post('/admin/players/:id/auth-link', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const player = db.getPlayer(req.params.id);
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }
  if (player.isAdmin) {
    res.status(403).json({
      error: 'Administrator auth links can only be generated from the server console.',
    });
    return;
  }

  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const inviteId = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  db.createInvitation(inviteId, tokenHash, player.id, player.username, req.player?.id || null, expiresAt);

  res.json({
    success: true,
    player,
    invitation: {
      token: rawToken,
      inviteUrl: `/invite/${rawToken}`,
      expiresAt,
    },
  });
});

apiRouter.patch('/admin/players/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const player = db.getPlayer(req.params.id);
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }

  const { username, avatarUrl } = req.body;
  if (username && username.trim()) {
    const trimmed = username.trim();
    if (findPlayerByUsername(trimmed, player.id)) {
      res.status(409).json({ error: 'That username is already taken' });
      return;
    }
    player.username = trimmed;
  }
  if (avatarUrl && avatarUrl.trim()) player.avatarUrl = avatarUrl.trim();

  db.savePlayer(player);

  // Also update live state snapshot if player is participating in current game
  const game = db.getCurrentGame();
  if (game && game.currentDay > 0) {
    const state = db.getGameState(game.id, game.currentDay);
    if (state && state.data.players[player.id]) {
      state.data.players[player.id].username = player.username;
      state.data.players[player.id].avatarUrl = player.avatarUrl;
      db.saveGameState(state);
    }
  }

  res.json({ success: true, player });
});

apiRouter.post('/admin/players/:id/reset-sessions', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  db.revokePlayerSessions(req.params.id);
  res.json({ success: true, message: 'All sessions for player revoked' });
});

apiRouter.delete('/admin/players/:id', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const player = db.getPlayer(req.params.id);
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }

  if (player.isAdmin) {
    res.status(403).json({
      error: 'Administrator accounts cannot be deleted from the admin console.',
    });
    return;
  }

  // Keep active games internally consistent: a participating player cannot be
  // removed while their snapshot is still being resolved.
  const game = db.getCurrentGame();
  if (game && game.currentDay > 0 && game.phase !== 'over') {
    const state = db.getGameState(game.id, game.currentDay);
    if (state && state.data.players[player.id]) {
      res.status(409).json({
        error:
          'Cannot delete a player who is participating in the active game. Reset or finish the game first.',
      });
      return;
    }
  }

  db.deletePlayer(player.id);
  res.json({ success: true, message: `Player ${player.username} deleted` });
});

apiRouter.post('/admin/start-game', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const {
    mapSize,
    playerHealth,
    rewardPool,
    enabledBuildings,
    mineLimit,
    mineLimitIncreaseDays,
    assassinationCost,
  } = req.body || {};

  if (mapSize !== undefined) {
    const parsedMapSize = Number(mapSize);
    if (!isValidMapSize(parsedMapSize)) {
      res.status(400).json({
        error: 'Map size must be between 10 and 50 in increments of 5',
      });
      return;
    }
  }

  if (playerHealth !== undefined) {
    const parsedPlayerHealth = Number(playerHealth);
    if (!isValidPlayerHealth(parsedPlayerHealth)) {
      res.status(400).json({
        error: 'Player health must be between 1 and 10 in increments of 1',
      });
      return;
    }
  }

  if (rewardPool !== undefined) {
    const parsedRewardPool = Number(rewardPool);
    if (!isValidRewardPool(parsedRewardPool)) {
      res.status(400).json({
        error: 'Reward pool must be a whole number of 0 or greater',
      });
      return;
    }
  }

  if (mineLimit !== undefined) {
    const parsedMineLimit = Number(mineLimit);
    if (!isValidMineLimit(parsedMineLimit)) {
      res.status(400).json({ error: 'Mine limit must be a whole number between 0 and 99' });
      return;
    }
  }

  if (mineLimitIncreaseDays !== undefined) {
    const parsedIncreaseDays = Number(mineLimitIncreaseDays);
    if (!isValidMineLimitIncreaseDays(parsedIncreaseDays)) {
      res.status(400).json({
        error: 'Mine limit increase interval must be between 1 and 999 days',
      });
      return;
    }
  }

  if (assassinationCost !== undefined) {
    const parsedAssassinationCost = Number(assassinationCost);
    if (!isValidAssassinationCost(parsedAssassinationCost)) {
      res.status(400).json({
        error: 'Assassination cost must be a whole number between 0 and 99',
      });
      return;
    }
  }

  const buildingOverrides: Partial<Record<BuildingType, boolean>> = {};
  if (enabledBuildings && typeof enabledBuildings === 'object') {
    for (const type of ALL_BUILDING_TYPES) {
      if (typeof enabledBuildings[type] === 'boolean') {
        buildingOverrides[type] = enabledBuildings[type];
      }
    }
  }

  const game = gameService.startNewGame({
    mapSize: mapSize !== undefined ? Number(mapSize) : undefined,
    playerHealth: playerHealth !== undefined ? Number(playerHealth) : undefined,
    rewardPool: rewardPool !== undefined ? Number(rewardPool) : undefined,
    enabledBuildings: buildingOverrides,
    mineLimit: mineLimit !== undefined ? Number(mineLimit) : undefined,
    mineLimitIncreaseDays:
      mineLimitIncreaseDays !== undefined ? Number(mineLimitIncreaseDays) : undefined,
    assassinationCost:
      assassinationCost !== undefined ? Number(assassinationCost) : undefined,
  });
  res.json({ success: true, game });
});

apiRouter.post('/admin/end-game-world-peace', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const result = gameService.endGameEarly();
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({
    success: true,
    game: result.game,
    distributed: result.distributed,
    perPlayer: result.perPlayer,
  });
});

apiRouter.patch('/admin/game/reward-pool', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { rewardPool } = req.body || {};
  const parsedRewardPool = Number(rewardPool);

  if (!isValidRewardPool(parsedRewardPool)) {
    res.status(400).json({ error: 'Reward pool must be a whole number of 0 or greater' });
    return;
  }

  const result = gameService.updateRewardPool(parsedRewardPool);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, game: result.game });
});

apiRouter.patch('/admin/game/mine-rules', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { mineLimit, mineLimitIncreaseDays } = req.body || {};
  const parsedMineLimit = Number(mineLimit);
  const parsedIncreaseDays = Number(mineLimitIncreaseDays);

  if (!isValidMineLimit(parsedMineLimit)) {
    res.status(400).json({ error: 'Mine limit must be a whole number between 0 and 99' });
    return;
  }
  if (!isValidMineLimitIncreaseDays(parsedIncreaseDays)) {
    res.status(400).json({
      error: 'Mine limit increase interval must be between 1 and 999 days',
    });
    return;
  }

  const result = gameService.updateMineRules(parsedMineLimit, parsedIncreaseDays);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, game: result.game });
});

apiRouter.patch(
  '/admin/game/assassination-cost',
  requireAdmin,
  (req: AuthenticatedRequest, res: Response) => {
    const parsedCost = Number(req.body?.assassinationCost);

    if (!isValidAssassinationCost(parsedCost)) {
      res.status(400).json({
        error: 'Assassination cost must be a whole number between 0 and 99',
      });
      return;
    }

    const result = gameService.updateAssassinationCost(parsedCost);
    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ success: true, game: result.game });
  }
);

apiRouter.patch('/admin/game/buildings', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const { buildingType, enabled } = req.body || {};

  if (!ALL_BUILDING_TYPES.includes(buildingType)) {
    res.status(400).json({ error: 'Unknown building type' });
    return;
  }
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }

  const result = gameService.setBuildingEnabled(buildingType as BuildingType, enabled);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, game: result.game });
});

apiRouter.post('/admin/resolve-day', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const result = gameService.resolveCurrentDay();
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, game: result.game });
});

apiRouter.post('/admin/reset-game', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const game = gameService.resetToWaiting();
  res.json({ success: true, game });
});

apiRouter.get('/admin/audit-logs', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  res.json({ logs: gameService.auditLogs });
});
