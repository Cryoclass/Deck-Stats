import type pg from 'pg';
import { tx } from '../db.js';
import { hashPassword } from './password.js';
import type { SessionUser } from './session.js';

// Catégories fournies de base (§2.6). La bibliothèque étant par compte (Lot B),
// elles sont créées pour CHAQUE compte à sa création — plus de seed SQL global.
export const BUILTIN_CATEGORIES: ReadonlyArray<{
  name: string;
  relevance: 'first' | 'second' | 'both';
}> = [
  { name: 'Handtrap', relevance: 'both' },
  { name: 'Board breaker', relevance: 'second' },
];

export async function seedBuiltinCategories(c: pg.PoolClient, userId: string): Promise<void> {
  for (const cat of BUILTIN_CATEGORIES) {
    // `where not exists` plutôt que `on conflict (owner_id, name)` : sur une base
    // legacy, la contrainte d'unicité par compte n'existe qu'APRÈS `npm run adopt` —
    // un register avant l'adoption ne doit pas répondre 500 pour autant.
    await c.query(
      `insert into nonengine_categories (owner_id, name, relevance, is_builtin)
       select $1, $2, $3, true
       where not exists (
         select 1 from nonengine_categories where owner_id = $1 and name = $2
       )`,
      [userId, cat.name, cat.relevance],
    );
  }
}

/** Insertion compte + bibliothèque de base sur un client de transaction FOURNI :
 *  permet d'y adjoindre d'autres écritures atomiques (ex. identité Discord, Lot D).
 *  Laisse remonter la violation d'unicité (code pg 23505) : à l'appelant de la traduire. */
export async function insertAccount(
  c: pg.PoolClient,
  opts: { email: string; displayName: string; passwordHash: string | null },
): Promise<SessionUser> {
  const { rows } = await c.query<SessionUser>(
    `insert into users (email, display_name, password_hash)
     values ($1, $2, $3)
     returning id, email, display_name`,
    [opts.email, opts.displayName, opts.passwordHash],
  );
  await seedBuiltinCategories(c, rows[0].id);
  return rows[0];
}

/** Création de compte par mot de passe (register). */
export async function createAccount(opts: {
  email: string;
  displayName: string;
  password: string;
}): Promise<SessionUser> {
  const passwordHash = await hashPassword(opts.password);
  return tx((c) => insertAccount(c, { email: opts.email, displayName: opts.displayName, passwordHash }));
}
