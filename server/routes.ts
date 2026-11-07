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
import { ActionSubmission, Building, Player } from '../src/types/game';
import { getActionPriorityGroup, generateSafeSpawnPosition } from '../src/game/rules';

export const apiRouter = Router();

apiRouter.use(authenticatePlayer);

// --- User & Session Info ---

apiRouter.get('/me', (req: AuthenticatedRequest, res: Response) => {
  const allPlayers = db.getAllPlayers();
  res.json({
    player: req.player || null,
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

  // Look for player with this username or create new player
  let player = db.getAllPlayers().find((p) => p.username === invite.username);
  if (!player) {
    const existing = db.getAllPlayers().map((p) => ({ x: p.x, y: p.y }));
    const safePos = generateSafeSpawnPosition(existing);

    player = {
      id: uuidv4(),
      username: invite.username,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(invite.username)}`,
      health: 3,
      points: 1,
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
  if (username && username.trim()) player.username = username.trim();
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

  res.json({
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

  const stateRecord = db.getGameState(game.id, requestedDay);
  if (!stateRecord) {
    res.status(404).json({ error: `State for Day ${requestedDay} not found` });
    return;
  }

  // Filter hidden mines based on viewer identity and game status
  // Mines are only visible to their owner, UNLESS the game is over (then shown transparently)
  const isGameOver = game.phase === 'over';
  const viewerId = req.player?.id;

  const filteredBuildings = stateRecord.data.buildings.filter((b) => {
    if (b.type !== 'mine') return true;
    if (isGameOver) return true;
    return b.ownerId === viewerId;
  }).map((b) => {
    if (b.type === 'mine' && isGameOver && b.ownerId !== viewerId) {
      return { ...b, transparent: true };
    }
    return b;
  });

  res.json({
    day: stateRecord.day,
    gameId: stateRecord.gameId,
    state: {
      ...stateRecord.data,
      buildings: filteredBuildings,
    },
  });
});

// --- Action Planning & Submissions ---

apiRouter.get('/game/actions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const game = db.getCurrentGame();
  if (!game) {
    res.status(404).json({ error: 'No active game' });
    return;
  }

  const actions = db.getPlayerActionsForDay(game.id, game.currentDay, req.player!.id);
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
  if (isNaN(targetDay)) {
    res.status(400).json({ error: 'Invalid day' });
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
  const { username, avatarUrl, isAdmin } = req.body;
  if (!username || !username.trim()) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }

  const playerId = uuidv4();
  const newPlayer: Player = {
    id: playerId,
    username: username.trim(),
    avatarUrl: avatarUrl?.trim() || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username.trim())}`,
    health: 3,
    points: 1,
    x: 13,
    y: 13,
    isAlive: true,
    isAdmin: Boolean(isAdmin),
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

// Generate one-time authentication / invite link for ANY existing player
apiRouter.post('/admin/players/:id/auth-link', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const player = db.getPlayer(req.params.id);
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }

  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const inviteId = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  db.createInvitation(inviteId, tokenHash, player.username, req.player?.id || null, expiresAt);

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
  if (username && username.trim()) player.username = username.trim();
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

apiRouter.post('/admin/start-game', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const game = gameService.startNewGame();
  res.json({ success: true, game });
});

apiRouter.post('/admin/advance-round', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const result = gameService.adminAdvanceRound();
  if (!result.success) {
    res.status(500).json({ error: result.error });
    return;
  }
  const game = db.getCurrentGame();
  res.json({ success: true, game });
});

apiRouter.post('/admin/jump-phase', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  const result = gameService.jumpToNextPhase();
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
