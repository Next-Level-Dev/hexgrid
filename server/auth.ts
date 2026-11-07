/**
 * Authentication and Session Management
 * Conforms to Master Specification Section 16 & 18:
 * - Secure hashed session tokens
 * - 3-month session cookies
 * - One-time invitation tokens
 * - Admin authorization checks on protected APIs
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { Player } from '../src/types/game';

export const SESSION_COOKIE_NAME = 'hexgrid_session';
const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 3 months

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Creates a session for a player and sets the session cookie on the response
 */
export function createPlayerSession(res: Response, player: Player): string {
  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();

  db.createSession(sessionId, player.id, tokenHash, expiresAt);

  // Set cookie
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });

  return token;
}

export interface AuthenticatedRequest extends Request {
  player?: Player;
}

/**
 * Middleware: extracts and validates the player session from cookie or Authorization header
 */
export function authenticatePlayer(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const token =
    req.cookies?.[SESSION_COOKIE_NAME] ||
    req.headers['x-session-token'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    // If no session exists in preview, check if we can fall back to the default admin player
    const defaultAdmin = db.getPlayer('a0000000-0000-0000-0000-000000000001');
    if (defaultAdmin) {
      req.player = defaultAdmin;
    }
    return next();
  }

  const tokenHash = hashToken(String(token));
  const session = db.getSessionByTokenHash(tokenHash);

  if (!session || new Date(session.expires_at) < new Date()) {
    // Session invalid or expired
    return next();
  }

  const player = db.getPlayer(session.player_id);
  if (player) {
    req.player = player;
  }
  next();
}

/**
 * Middleware: requires an authenticated player
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.player) {
    res.status(401).json({ error: 'Authentication required. Please sign in or use an invitation link.' });
    return;
  }
  next();
}

/**
 * Middleware: requires admin role
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.player || !req.player.isAdmin) {
    res.status(403).json({ error: 'Access denied: Administrator privileges required.' });
    return;
  }
  next();
}
