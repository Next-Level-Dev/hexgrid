/**
 * Authentication, passwords and session management:
 * - Scrypt-hashed account passwords
 * - Hashed 30-day session tokens
 * - One-time 7-day password reset invitations
 * - Admin authorization checks on protected APIs
 */
import crypto from 'crypto';
import { CookieOptions, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { Player } from '../src/types/game';

export const SESSION_COOKIE_NAME = 'hexgrid_session';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function getSessionCookieOptions(): CookieOptions {
  const secureOverride = process.env.SESSION_COOKIE_SECURE;
  const options: CookieOptions = {
    httpOnly: true,
    secure:
      secureOverride === undefined
        ? process.env.NODE_ENV === 'production'
        : secureOverride === 'true',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  if (domain) options.domain = domain;
  return options;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`;
  }
  return null;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: unknown, storedHash: string | null): boolean {
  if (typeof password !== 'string' || !storedHash) return false;
  const [algorithm, saltHex, hashHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length === 0) return false;
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
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
  res.cookie(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

  return token;
}

export function clearPlayerSessionCookie(res: Response) {
  const options = getSessionCookieOptions();
  delete options.maxAge;
  res.clearCookie(SESSION_COOKIE_NAME, options);
}

export interface AuthenticatedRequest extends Request {
  player?: Player;
  sessionId?: string;
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
    return next();
  }

  const tokenHash = hashToken(String(token));
  const session = db.getSessionByTokenHash(tokenHash);

  if (!session || new Date(session.expires_at) < new Date()) {
    // Session invalid or expired
    return next();
  }

  if (new Date(session.expires_at).getTime() - Date.now() < SESSION_REFRESH_THRESHOLD_MS) {
    const refreshedExpiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
    db.touchSession(session.id, refreshedExpiry);
    res.cookie(SESSION_COOKIE_NAME, String(token), getSessionCookieOptions());
  }

  const player = db.getPlayer(session.player_id);
  if (player) {
    req.player = player;
    req.sessionId = session.id;
  }
  next();
}

export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const source = origin || referer;

  if (source) {
    let sourceHost: string;
    try {
      sourceHost = new URL(source).host;
    } catch {
      res.status(403).json({ error: 'Invalid request origin' });
      return;
    }

    const forwardedHost = req.headers['x-forwarded-host'];
    const requestHost = (Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost || req.headers.host
    )?.split(',')[0];

    if (!requestHost || sourceHost !== requestHost) {
      res.status(403).json({ error: 'Cross-origin requests are not allowed' });
      return;
    }
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
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
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
