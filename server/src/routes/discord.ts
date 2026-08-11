import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { query, tx } from '../db.js';
import { insertAccount } from '../auth/account.js';
import { createSession, resolveSession } from '../auth/session.js';

/**
 * OAuth Discord (itération 8, Lot D). Deux intentions, portées par un cookie
 * d'état court (anti-CSRF) posé au départ :
 *  - connexion/création : identité connue → session ; inconnue → création de compte,
 *    qui EXIGE un code d'invitation valide (embarqué dans le cookie d'état AVANT le
 *    départ chez Discord — la porte d'entrée reste fermée).
 *  - liaison (`?link=1`) : rattache l'identité Discord au compte de la SESSION en
 *    cours. JAMAIS de rattachement automatique par simple égalité d'email : un email
 *    Discord non maîtrisé permettrait de voler un compte.
 * Les URLs Discord sont surchargeables par env — testables contre un mock local.
 */

const OAUTH_COOKIE = 'ygo_oauth';
const OAUTH_MINUTES = 10;

const cfg = () => ({
  clientId: process.env.DISCORD_CLIENT_ID ?? '',
  clientSecret: process.env.DISCORD_CLIENT_SECRET ?? '',
  redirectUri:
    process.env.DISCORD_REDIRECT_URI ?? 'http://localhost:5173/api/auth/discord/callback',
  authorizeUrl: process.env.DISCORD_AUTHORIZE_URL ?? 'https://discord.com/oauth2/authorize',
  tokenUrl: process.env.DISCORD_TOKEN_URL ?? 'https://discord.com/api/oauth2/token',
  userUrl: process.env.DISCORD_USER_URL ?? 'https://discord.com/api/users/@me',
});

export const discordConfigured = (): boolean => !!(cfg().clientId && cfg().clientSecret);

const inviteCodes = (): string[] =>
  (process.env.INVITE_CODES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

interface OauthState {
  s: string; // aléa anti-CSRF, comparé au paramètre `state` du retour
  invite: string | null;
  link: boolean;
}

const secureCookies = (): boolean =>
  process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === '1';

function setOauthCookie(reply: FastifyReply, state: OauthState): void {
  reply.setCookie(OAUTH_COOKIE, Buffer.from(JSON.stringify(state)).toString('base64url'), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax', // Lax : le cookie accompagne la redirection top-level de retour
    secure: secureCookies(),
    maxAge: OAUTH_MINUTES * 60,
  });
}

function readOauthCookie(raw: string | undefined): OauthState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as OauthState;
    return typeof parsed.s === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Retour utilisateur : la page de connexion (ou l'accueil) affiche le code d'erreur. */
const fail = (reply: FastifyReply, code: string) =>
  reply.redirect(`/decks?discord_error=${encodeURIComponent(code)}`);

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  email: string | null;
  verified?: boolean;
}

export async function discordRoutes(app: FastifyInstance) {
  // ─── Départ : pose l'état puis redirige vers l'autorisation Discord ───
  // Rate-limité : la réponse (erreur immédiate vs redirection) révèle si un code
  // d'invitation est valide — sans limite, c'est un oracle de brute-force.
  app.get<{ Querystring: { invite?: string; link?: string } }>('/start', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const c = cfg();
    if (!discordConfigured()) return fail(reply, 'not_configured');

    const link = req.query.link === '1';
    const invite = req.query.invite?.trim() || null;
    // Un code fourni mais invalide échoue TOUT DE SUITE (avant l'aller-retour Discord).
    if (invite && !inviteCodes().includes(invite)) return fail(reply, 'invite_invalid');
    // La liaison exige une session dès le départ.
    if (link && !(await resolveSession(req, reply))) return fail(reply, 'session_required');

    const state: OauthState = { s: randomBytes(16).toString('base64url'), invite, link };
    setOauthCookie(reply, state);

    const url = new URL(c.authorizeUrl);
    url.searchParams.set('client_id', c.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', c.redirectUri);
    url.searchParams.set('scope', 'identify email');
    url.searchParams.set('state', state.s);
    return reply.redirect(url.toString());
  });

  // ─── Retour de Discord ───
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const c = cfg();
      const st = readOauthCookie(req.cookies[OAUTH_COOKIE]);
      reply.clearCookie(OAUTH_COOKIE, { path: '/' });

      if (req.query.error) return fail(reply, 'cancelled'); // refus côté Discord
      if (!st || !req.query.state || req.query.state !== st.s) {
        return fail(reply, 'state_mismatch'); // anti-CSRF
      }
      if (!req.query.code) return fail(reply, 'exchange_failed');

      // Échange code → token, puis identité Discord.
      let du: DiscordUser;
      try {
        const tokenRes = await fetch(c.tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: c.clientId,
            client_secret: c.clientSecret,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: c.redirectUri,
          }),
        });
        if (!tokenRes.ok) return fail(reply, 'exchange_failed');
        const { access_token } = (await tokenRes.json()) as { access_token?: string };
        if (!access_token) return fail(reply, 'exchange_failed');
        const userRes = await fetch(c.userUrl, {
          headers: { authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) return fail(reply, 'exchange_failed');
        du = (await userRes.json()) as DiscordUser;
      } catch {
        return fail(reply, 'exchange_failed');
      }
      if (!du?.id) return fail(reply, 'exchange_failed');

      // ─── Intention : liaison au compte de la session en cours ───
      if (st.link) {
        const me = await resolveSession(req, reply);
        if (!me) return fail(reply, 'session_required');
        const existing = await query<{ user_id: string }>(
          `select user_id from user_identities where provider = 'discord' and provider_user_id = $1`,
          [du.id],
        );
        if (existing.rows[0] && existing.rows[0].user_id !== me.id) {
          return fail(reply, 'discord_taken');
        }
        if (!existing.rows[0]) {
          await query(
            `insert into user_identities (provider, provider_user_id, user_id)
             values ('discord', $1, $2)`,
            [du.id, me.id],
          );
        }
        return reply.redirect('/decks');
      }

      // ─── Intention : connexion (identité connue) ou création (invitation requise) ───
      const identity = await query<{ user_id: string }>(
        `select user_id from user_identities where provider = 'discord' and provider_user_id = $1`,
        [du.id],
      );
      if (identity.rows[0]) {
        await createSession(reply, identity.rows[0].user_id, req.headers['user-agent']);
        return reply.redirect('/decks');
      }

      // Création : code d'invitation revalidé au retour (l'env a pu changer entre-temps).
      if (!st.invite || !inviteCodes().includes(st.invite)) return fail(reply, 'invite_required');
      if (!du.email || du.verified === false) return fail(reply, 'no_email');

      let userId: string;
      try {
        userId = await tx(async (t) => {
          const u = await insertAccount(t, {
            email: du.email!,
            displayName: du.global_name?.trim() || du.username,
            passwordHash: null, // compte Discord seul : le login par mot de passe le traite en inconnu
          });
          await t.query(
            `insert into user_identities (provider, provider_user_id, user_id)
             values ('discord', $1, $2)`,
            [du.id, u.id],
          );
          return u.id;
        });
      } catch (e) {
        const pgErr = e as { code?: string; constraint?: string };
        if (pgErr.code === '23505' && pgErr.constraint === 'users_email_unique') {
          // Un compte mot de passe porte déjà cet email : PAS de rattachement d'office
          // (l'email Discord ne prouve pas la propriété du compte) — l'utilisateur se
          // connecte par mot de passe puis « Lier Discord ».
          return fail(reply, 'email_taken');
        }
        if (pgErr.code === '23505') return fail(reply, 'discord_taken'); // course sur l'identité
        throw e;
      }
      await createSession(reply, userId, req.headers['user-agent']);
      return reply.redirect('/decks');
    },
  );

  // ─── Déliaison (depuis le menu de compte, session requise) ───
  app.delete('/', async (req, reply) => {
    const me = await resolveSession(req, reply);
    if (!me) return reply.code(401).send({ error: 'non authentifié' });
    // Un compte SANS mot de passe perdrait tout moyen de connexion : refus.
    const pw = await query<{ has: boolean }>(
      'select password_hash is not null as has from users where id = $1',
      [me.id],
    );
    if (!pw.rows[0]?.has) {
      return reply
        .code(400)
        .send({ error: 'définis d’abord un mot de passe : ce compte n’a que Discord' });
    }
    await query(`delete from user_identities where provider = 'discord' and user_id = $1`, [me.id]);
    return { ok: true };
  });
}
