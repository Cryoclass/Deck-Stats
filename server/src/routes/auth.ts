import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { verifyAgainstDummy, verifyPassword } from '../auth/password.js';
import { createAccount } from '../auth/account.js';
import { createSession, destroySession, resolveSession } from '../auth/session.js';
import { discordConfigured } from './discord.js';

// Codes d'invitation : liste en variable d'environnement (séparés par des virgules).
// Zéro table, zéro écran d'admin ; révoquer = éditer .env + redémarrer. Le contrôle
// est isolé ici : passer à une table de codes traçables restera un petit changement.
function inviteCodes(): string[] {
  return (process.env.INVITE_CODES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PASSWORD_MIN = 8;

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
}

const publicUser = (u: Pick<UserRow, 'id' | 'email' | 'display_name'>) => ({
  id: u.id,
  email: u.email,
  display_name: u.display_name,
});

/** Métadonnées de compte pour le front (Lot D) : fournisseurs OAuth liés + présence
 *  d'un mot de passe (pilote « Lier / Délier Discord » dans le menu de compte). */
async function withAccountMeta(u: Pick<UserRow, 'id' | 'email' | 'display_name'>) {
  const [ids, pw] = await Promise.all([
    query<{ provider: string }>('select provider from user_identities where user_id = $1', [u.id]),
    query<{ has: boolean }>('select password_hash is not null as has from users where id = $1', [
      u.id,
    ]),
  ]);
  return {
    ...publicUser(u),
    providers: ids.rows.map((r) => r.provider),
    has_password: pw.rows[0]?.has ?? false,
  };
}

export async function authRoutes(app: FastifyInstance) {
  // Inscription — protégée par code d'invitation + rate-limit.
  app.post<{
    Body: { email?: string; password?: string; display_name?: string; invite_code?: string };
  }>(
    '/register',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { email, password, display_name, invite_code } = req.body ?? {};

      const codes = inviteCodes();
      if (codes.length === 0) {
        return reply.code(403).send({ error: 'inscriptions fermées (aucun code configuré)' });
      }
      if (!invite_code || !codes.includes(invite_code.trim())) {
        return reply.code(403).send({ error: "code d'invitation invalide" });
      }
      if (!email || !EMAIL_RE.test(email.trim())) {
        return reply.code(400).send({ error: 'email invalide' });
      }
      if (!password || password.length < PASSWORD_MIN) {
        return reply
          .code(400)
          .send({ error: `mot de passe trop court (minimum ${PASSWORD_MIN} caractères)` });
      }

      const cleanEmail = email.trim();
      const name = display_name?.trim() || cleanEmail.split('@')[0];
      let user: Awaited<ReturnType<typeof createAccount>>;
      try {
        // Crée le compte ET sa bibliothèque de base (catégories §2.6), en transaction.
        user = await createAccount({ email: cleanEmail, displayName: name, password });
      } catch (e) {
        // Scopé à la contrainte d'unicité de l'email : un autre 23505 (ex. schéma
        // legacy pas encore migré) est une vraie erreur serveur, pas un doublon.
        const pgErr = e as { code?: string; constraint?: string };
        if (pgErr.code === '23505' && pgErr.constraint === 'users_email_unique') {
          return reply.code(409).send({ error: 'un compte existe déjà avec cet email' });
        }
        throw e;
      }

      await createSession(reply, user.id, req.headers['user-agent']);
      return reply.code(201).send({ user: publicUser(user) });
    },
  );

  // Connexion — mêmes réponse ET coût (scrypt factice) que l'email existe ou non :
  // pas d'énumération de comptes.
  app.post<{ Body: { email?: string; password?: string } }>(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        return reply.code(400).send({ error: 'email et mot de passe requis' });
      }
      const { rows } = await query<UserRow>(
        `select id, email, display_name, password_hash
         from users where lower(email) = lower($1)`,
        [email.trim()],
      );
      const user = rows[0];
      const ok =
        user?.password_hash != null
          ? await verifyPassword(password, user.password_hash)
          : await verifyAgainstDummy(password); // email inconnu OU compte OAuth seul
      if (!ok) return reply.code(401).send({ error: 'identifiants invalides' });

      await createSession(reply, user.id, req.headers['user-agent']);
      return { user: await withAccountMeta(user) };
    },
  );

  // Fournisseurs OAuth disponibles (pilote l'affichage du bouton Discord).
  app.get('/providers', async () => ({ discord: discordConfigured() }));

  app.post('/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  // Sonde de session du front : 401 = anonyme (les routes /api/auth/* échappent à la
  // garde globale, on résout donc la session explicitement ici).
  app.get('/me', async (req, reply) => {
    const user = await resolveSession(req, reply);
    if (!user) return reply.code(401).send({ error: 'non authentifié' });
    return { user: await withAccountMeta(user) };
  });
}
