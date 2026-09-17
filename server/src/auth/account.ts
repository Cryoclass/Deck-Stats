import type pg from 'pg';
import { tx } from '../db.js';
import { hashPassword } from './password.js';
import type { SessionUser } from './session.js';

// Catégories fournies de base (§2.6). La bibliothèque étant par compte (Lot B),
// elles sont créées pour CHAQUE compte à sa création — plus de seed SQL global.
// Étape 8 : une catégorie est une étiquette pure (5B, Q4) ; la pertinence historique
// n'est plus écrite (colonne purgée par la migration 003).
export const BUILTIN_CATEGORIES: ReadonlyArray<{ name: string }> = [
  { name: 'Handtrap' },
  { name: 'Board breaker' },
];

/** Plafonds partagés fournis de base (docs/annotations-par-defaut.md, D7′) : la détection et la
 *  référence désignent un plafond par son nom, chaque compte porte le sien. */
export const BUILTIN_GROUPS: ReadonlyArray<{ name: string; cap_per_turn: number }> = [
  { name: 'Mulcharmy', cap_per_turn: 2 },
];

export async function seedBuiltinCategories(c: pg.PoolClient, userId: string): Promise<void> {
  // `adopt` tourne avant 001 (pas de `nonengine_groups`) et une base peut précéder 006 (pas de
  // `is_builtin`) : le groupe n'est créé que si la colonne existe ; 006 le rétro-crée sinon.
  const { rowCount: hasBuiltinGroups } = await c.query(
    `select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'nonengine_groups' and column_name = 'is_builtin'`,
  );
  if (hasBuiltinGroups) for (const group of BUILTIN_GROUPS) {
    await c.query(
      `insert into nonengine_groups (owner_id, name, cap_per_turn, is_builtin)
       select $1, $2, $3, true
       where not exists (select 1 from nonengine_groups where owner_id = $1 and name = $2)`,
      [userId, group.name, group.cap_per_turn],
    );
  }
  for (const cat of BUILTIN_CATEGORIES) {
    // `where not exists` plutôt que `on conflict (owner_id, name)` : sur une base
    // legacy, la contrainte d'unicité par compte n'existe qu'APRÈS `npm run adopt` —
    // un register avant l'adoption ne doit pas répondre 500 pour autant.
    await c.query(
      `insert into nonengine_categories (owner_id, name, is_builtin)
       select $1, $2, true
       where not exists (
         select 1 from nonengine_categories where owner_id = $1 and name = $2
       )`,
      [userId, cat.name],
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
