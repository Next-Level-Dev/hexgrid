/**
 * Single-admin account management.
 *
 * HexGrid Tactics has exactly one administrator. It is created automatically
 * and can never be created or promoted through the web UI/API. Any legacy
 * extra admin accounts are demoted when the server initializes.
 */
import { db } from './db';
import { hashPassword, validatePassword } from './auth';
import { Player } from '../src/types/game';

export const DEFAULT_ADMIN_ID = 'a0000000-0000-0000-0000-000000000001';
export const DEFAULT_ADMIN_USERNAME = 'Admin';

function createDefaultAdmin(): Player {
  const admin: Player = {
    id: DEFAULT_ADMIN_ID,
    username: DEFAULT_ADMIN_USERNAME,
    avatarUrl: `https://api.dicebear.com/10.x/initial-face/svg?seed=${DEFAULT_ADMIN_USERNAME}`,
    health: 3,
    points: 1,
    tokens: 0,
    x: 13,
    y: 13,
    isAlive: true,
    isAdmin: true,
    peaceVote: 'no',
    stats: { gamesPlayed: 0, worldPeaces: 0, lastOneStandings: 0, deaths: 0 },
    games: {},
  };
  db.savePlayer(admin);
  return admin;
}

function applyAdminPassword(admin: Player) {
  const password = process.env.ADMIN_PASSWORD;
  const error = validatePassword(password);
  if (error) {
    console.warn(`[HexGrid Admin] ADMIN_PASSWORD is invalid: ${error}. The admin cannot sign in.`);
    return;
  }
  db.setPlayerPasswordHash(admin.id, hashPassword(password as string));
}

/**
 * Ensures the one and only admin account exists and that no other player has
 * administrator rights. Returns the admin player.
 */
export function ensureSingleAdmin(): Player {
  const players = db.getAllPlayers();
  const admin =
    players.find((p) => p.id === DEFAULT_ADMIN_ID) ??
    players.find(
      (p) => p.username.trim().toLowerCase() === DEFAULT_ADMIN_USERNAME.toLowerCase()
    );

  const resolvedAdmin = admin ?? createDefaultAdmin();
  if (!resolvedAdmin.isAdmin) {
    resolvedAdmin.isAdmin = true;
    db.savePlayer(resolvedAdmin);
  }

  for (const player of db.getAllPlayers()) {
    if (player.id !== resolvedAdmin.id && player.isAdmin) {
      player.isAdmin = false;
      db.savePlayer(player);
    }
  }

  applyAdminPassword(resolvedAdmin);

  // Invitations are password reset links bound to a player id. Retire legacy
  // username-only links so they cannot be used against the admin account.
  db.invalidateLegacyInvitationsForUsername(resolvedAdmin.username);
  db.invalidateLegacyInvitationsForUsername(DEFAULT_ADMIN_USERNAME);
  db.invalidateInvitationsForPlayer(resolvedAdmin.id);

  return resolvedAdmin;
}

export function findAdmin(): Player | null {
  return db.getAllPlayers().find((p) => p.isAdmin) ?? null;
}
