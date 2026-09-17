import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { verifyAgainstDummy, verifyPassword } from '../auth/password.js';
import { createAccount } from '../auth/account.js';
import { createSession, destroySession, requireUser } from '../auth/session.js';
import { discordConfigured } from './discord.js';
import { isReferentRole, roleValid } from '../domain/deckConfiguration.js';
import { dismissNotice, noticesDue, noticeValid } from '../auth/notices.js';

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
// Audit 05 C1 : `\S+@\S+` sur une chaîne de « @ » coûte n² sur la boucle d'événements (64 000
// « @ » = 8 s de gel pour TOUTES les requêtes). La longueur est bornée AVANT la regex — 254
// caractères, maximum d'une adresse (RFC 5321) ; à cette taille la regex est négligeable.
const EMAIL_MAX = 254;
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
  const [ids, pw, notices] = await Promise.all([
    query<{ provider: string }>('select provider from user_identities where user_id = $1', [u.id]),
    query<{ has: boolean; role: string }>('select password_hash is not null as has, role from users where id = $1', [
      u.id,
    ]),
    noticesDue(u.id),
  ]);
  // Rôle (005 / 006) relu à chaque appel, jamais mis en cache : `referent` pilote l'interface du
  // référent (docs/annotations-par-defaut.md, D5′) ; la garde réelle est côté routes (`requireReferent`).
  const role = roleValid(pw.rows[0]?.role) ? pw.rows[0].role : 'user';
  return {
    ...publicUser(u),
    providers: ids.rows.map((r) => r.provider),
    has_password: pw.rows[0]?.has ?? false,
    role,
    referent: isReferentRole(role),
    // Avis d'interface dus à ce compte (auth/notices.ts), relus à chaque appel : aujourd'hui
    // `['annotation-defaults']` ou `[]`. La fermeture est retenue côté serveur (user_notices).
    notices,
  };
}

export async function authRoutes(app: FastifyInstance) {
  // Routes publiques (`public: true`, garde de auth/guard.ts) : inscription, connexion,
  // fournisseurs, déconnexion. `/me` reste derrière la garde, comme le reste de l'API.
  // Inscription — protégée par code d'invitation + rate-limit.
  app.post<{
    Body: { email?: string; password?: string; display_name?: string; invite_code?: string };
  }>(
    '/register',
    { config: { public: true, rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { email, password, display_name, invite_code } = req.body ?? {};

      const codes = inviteCodes();
      if (codes.length === 0) {
        return reply.code(403).send({ error: 'inscriptions fermées (aucun code configuré)' });
      }
      if (!invite_code || !codes.includes(invite_code.trim())) {
        return reply.code(403).send({ error: "code d'invitation invalide" });
      }
      if (typeof email !== 'string' || email.length > EMAIL_MAX || !EMAIL_RE.test(email.trim())) {
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
    { config: { public: true, rateLimit: { max: 10, timeWindow: '1 minute' } } },
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
  app.get('/providers', { config: { public: true } }, async () => ({ discord: discordConfigured() }));

  // Publique : déconnecter une session déjà expirée reste un succès (cookie effacé).
  app.post('/logout', { config: { public: true } }, async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  // Sonde de session du front : 401 = anonyme, rendu par la garde globale (route privée).
  app.get('/me', async (req) => ({ user: await withAccountMeta(requireUser(req)) }));

  // Fermeture d'un avis pour le compte courant (route privée : garde globale). Idempotente ;
  // clé inconnue → 404 avec message. Aucune condition « dû » : fermer un avis non dû est sans effet
  // visible, et le client n'a pas à connaître la règle d'affichage.
  app.post<{ Params: { notice: string } }>('/notices/:notice/dismiss', async (req) => {
    const user = requireUser(req);
    if (!noticeValid(req.params.notice)) {
      throw Object.assign(new Error('Avis inconnu.'), { statusCode: 404 });
    }
    await dismissNotice(user.id, req.params.notice);
    return { ok: true };
  });
}
