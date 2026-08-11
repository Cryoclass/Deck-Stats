/**
 * Adoption d'une base pré-itération 8 : crée (ou réutilise) un compte, lui
 * attribue TOUTES les données orphelines (decks + bibliothèque), fait basculer
 * les anciennes clés d'unicité vers les clés par compte, puis verrouille
 * owner_id en NOT NULL.
 *
 *   npm run db:schema                       # d'abord : ajoute les colonnes owner_id
 *   npm run adopt -- <email> <mot de passe> [nom affiché]
 *
 * Idempotent : relançable sans risque (compte réutilisé, 0 orphelin = no-op,
 * bascules de contraintes gardées par des tests d'existence). Tout est dans UNE
 * transaction : ou tout passe, ou rien ne change.
 */
import '../src/env.js';
import { pool, tx } from '../src/db.js';
import { hashPassword } from '../src/auth/password.js';
import { seedBuiltinCategories } from '../src/auth/account.js';

const [email, password, displayName] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage : npm run adopt -- <email> <mot de passe> [nom affiché]');
  process.exit(1);
}

const OWNED_TABLES = ['decks', 'card_flags', 'combo_pairs', 'nonengine_categories'] as const;

try {
  await tx(async (c) => {
    // ── 1. Compte : créé, ou réutilisé si l'email existe déjà (relance) ──
    const existing = await c.query<{ id: string }>(
      'select id from users where lower(email) = lower($1)',
      [email],
    );
    let userId: string;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      console.log(`Compte existant réutilisé : ${email}`);
    } else {
      const ins = await c.query<{ id: string }>(
        `insert into users (email, display_name, password_hash)
         values ($1, $2, $3) returning id`,
        [email.trim(), displayName?.trim() || email.split('@')[0], await hashPassword(password)],
      );
      userId = ins.rows[0].id;
      console.log(`Compte créé : ${email}`);
    }

    // ── 2. Adoption des orphelins (owner_id encore nullable à ce stade) ──
    for (const table of OWNED_TABLES) {
      const { rowCount } = await c.query(
        `update ${table} set owner_id = $1 where owner_id is null`,
        [userId],
      );
      console.log(`  ${table}: ${rowCount} ligne(s) adoptée(s)`);
    }

    // ── 3. Bascule des clés legacy → clés par compte ──
    const hasConstraint = async (name: string): Promise<boolean> => {
      const { rowCount } = await c.query('select 1 from pg_constraint where conname = $1', [name]);
      return (rowCount ?? 0) > 0;
    };

    // card_flags : PK (card_id) → (owner_id, card_id)
    const pkHasOwner = await c.query(
      `select 1 from information_schema.key_column_usage
       where table_name = 'card_flags' and constraint_name = 'card_flags_pkey'
         and column_name = 'owner_id'`,
    );
    if (pkHasOwner.rowCount === 0) {
      await c.query('alter table card_flags drop constraint if exists card_flags_pkey');
      await c.query('alter table card_flags add primary key (owner_id, card_id)');
      console.log('  card_flags: PK → (owner_id, card_id)');
    }

    // combo_pairs : unique (card_a, card_b) → (owner_id, card_a, card_b)
    await c.query('alter table combo_pairs drop constraint if exists combo_pairs_card_a_id_card_b_id_key');
    if (!(await hasConstraint('combo_pairs_owner_pair'))) {
      await c.query(
        `alter table combo_pairs
         add constraint combo_pairs_owner_pair unique (owner_id, card_a_id, card_b_id)`,
      );
      console.log('  combo_pairs: unicité → (owner_id, card_a_id, card_b_id)');
    }

    // nonengine_categories : unique (name) → (owner_id, name)
    await c.query('alter table nonengine_categories drop constraint if exists nonengine_categories_name_key');
    if (!(await hasConstraint('nonengine_categories_owner_name'))) {
      await c.query(
        `alter table nonengine_categories
         add constraint nonengine_categories_owner_name unique (owner_id, name)`,
      );
      console.log('  nonengine_categories: unicité → (owner_id, name)');
    }

    // ── 4. Verrouillage : plus aucune ligne sans propriétaire ──
    for (const table of OWNED_TABLES) {
      await c.query(`alter table ${table} alter column owner_id set not null`);
    }

    // ── 5. Catégories de base : présentes même si la base legacy les avait perdues ──
    await seedBuiltinCategories(c, userId);

    console.log('Adoption terminée.');
  });
} finally {
  await pool.end();
}
