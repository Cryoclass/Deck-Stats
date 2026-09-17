import type { FastifyRequest } from 'fastify';
import { query } from '../db.js';
import { requireUser } from './session.js';
import { isReferentRole, roleValid, type Role } from '../domain/deckConfiguration.js';

/**
 * Rôle d'un compte (`users.role`, migration 005 puis 006 : `user` | `referent` | `admin`),
 * relu en base à chaque appel — jamais mis en cache dans la session : un rôle retiré par le
 * back-office prend effet à la requête suivante. Le serveur n'écrit JAMAIS cette colonne :
 * l'attribution passe par `deploy/backoffice-role.sh` (ou le back-office).
 */
export async function roleOf(userId: string): Promise<Role> {
  const { rows } = await query<{ role: string }>('select role from users where id = $1', [userId]);
  const role = rows[0]?.role;
  return roleValid(role) ? role : 'user';
}

/** Un référent (ou un admin, qui l'est aussi) ; sinon 404, comme une ressource d'autrui (Q7). */
export async function requireReferent(req: FastifyRequest): Promise<{ id: string; role: Role }> {
  const user = requireUser(req);
  const role = await roleOf(user.id);
  if (!isReferentRole(role)) throw Object.assign(new Error('Introuvable.'), { statusCode: 404 });
  return { id: user.id, role };
}
