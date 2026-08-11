import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { query } from '../db.js';

export const SESSION_COOKIE = 'ygo_session';

const SESSION_DAYS = 30;
// Session glissante : on ne réécrit expires_at que sous la moitié restante,
// pour ne pas faire un UPDATE à chaque requête.
const SLIDE_UNDER_DAYS = 15;
const DAY_MS = 86_400_000;

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

// Seul le SHA-256 du token touche la base : un dump ne donne aucune session utilisable.
const sha256 = (token: string): Buffer => createHash('sha256').update(token).digest();

const secureCookies = (): boolean =>
  process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    expires: expiresAt,
  });
}

export async function createSession(
  reply: FastifyReply,
  userId: string,
  userAgent: string | undefined,
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await query(
    'insert into sessions (token_hash, user_id, expires_at, user_agent) values ($1, $2, $3, $4)',
    [sha256(token), userId, expiresAt, userAgent ?? null],
  );
  setSessionCookie(reply, token, expiresAt);
}

/** Résout le cookie de session → utilisateur, ou null. Purge la session expirée
 *  rencontrée et fait glisser l'expiration si elle approche. */
export async function resolveSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const { rows } = await query<SessionUser & { expires_at: string }>(
    `select u.id, u.email, u.display_name, s.expires_at
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1`,
    [hash],
  );
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    await query('delete from sessions where token_hash = $1', [hash]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return null;
  }
  if (expiresAt.getTime() - Date.now() < SLIDE_UNDER_DAYS * DAY_MS) {
    const next = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await query('update sessions set expires_at = $2 where token_hash = $1', [hash, next]);
    setSessionCookie(reply, token, next);
  }
  return { id: row.id, email: row.email, display_name: row.display_name };
}

/** Dans un handler derrière la garde globale, l'utilisateur est garanti présent. */
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new Error('requireUser appelé hors de la garde auth');
  return req.user;
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await query('delete from sessions where token_hash = $1', [sha256(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
