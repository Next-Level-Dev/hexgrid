#!/usr/bin/env tsx
/**
 * Generates a one-time authentication link for the single admin account.
 *
 * This is the only supported way to create an admin session link. The web API
 * intentionally refuses to generate auth links for admin accounts.
 *
 * Usage:
 *   npm run admin:link
 *   APP_URL=https://hexgrid.example.com npm run admin:link
 */
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../server/db';
import { ensureSingleAdmin } from '../server/admin';
import { generateSecureToken, hashToken } from '../server/auth';

const admin = ensureSingleAdmin();

const rawToken = generateSecureToken();
const tokenHash = hashToken(rawToken);
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

db.createInvitation(uuidv4(), tokenHash, admin.id, admin.username, null, expiresAt);

const baseUrl = (
  process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`
).replace(/\/$/, '');
const inviteUrl = `${baseUrl}/invite/${rawToken}`;

console.log('');
console.log('Admin one-time auth link');
console.log('------------------------');
console.log(`Account: ${admin.username} (${admin.id})`);
console.log(`Expires: ${expiresAt}`);
console.log(`URL:     ${inviteUrl}`);
console.log('');
console.log('Open the URL in a browser to sign in. The link can only be used once.');
console.log('');

process.exit(0);
