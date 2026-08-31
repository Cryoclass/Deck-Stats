/**
 * Migration initiale (§6.1) : copie de la table `cards` depuis la Supabase
 * publique vers le Postgres local. Lecture ponctuelle via PostgREST (clé anon),
 * on ignore card_printings / card_translations / collection_items.
 *
 *   npm run migrate -w server         (ou: npm run migrate à la racine)
 *
 * Idempotent : ON CONFLICT (id) DO UPDATE. Rejouable sans risque.
 *
 * Version du référentiel : la source tient une table `dataset_versions`. On la
 * lit AVANT et APRÈS la copie — si elle bouge entre les deux, la copie est à
 * cheval sur deux versions et n'est estampillée d'aucune. La version retenue est
 * consignée dans `catalog_version`, qu'expose `/api/health` : comparer deux bases
 * revient alors à comparer deux réponses de health.
 */
import '../src/env.js';
import pg from 'pg';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://fczujhwaxkmspdgvuyyg.supabase.co';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_VhrITzX99YP_j7u6GUpWsw_taHSczkR';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ygo:ygo@localhost:5433/ygo';

// Colonnes cibles du schéma local. On ne copie que celles réellement présentes
// côté Supabase (détectées sur la première ligne), le reste vaut NULL.
const TARGET_COLUMNS = [
  'id',
  'name',
  'type',
  'race',
  'attribute',
  'atk',
  'def',
  'level',
  'description',
  'image_url',
  'image_url_small',
  'image_url_cropped',
] as const;

const PAGE = 1000;

/** Ligne de `dataset_versions` (source). Lisible avec la clé anon ; les fonctions
 *  `dataset_fingerprint()` / `record_dataset_version()`, elles, lui sont fermées. */
type DatasetVersion = {
  version: string;
  recorded_at: string;
  fingerprint: string | null;
  cards_count: number | null;
};

/** Dernière version publiée par la source, ou null si le suivi n'est pas en place. */
async function fetchDatasetVersion(): Promise<DatasetVersion | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dataset_versions` +
      `?select=version,recorded_at,fingerprint,cards_count&order=recorded_at.desc&limit=1`,
    { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
  );
  // Table absente (404/PGRST205) = source sans suivi de version : on copie quand
  // même, la traçabilité est un plus, pas un prérequis.
  if (!res.ok) return null;
  const rows = (await res.json()) as DatasetVersion[];
  return rows[0] ?? null;
}

async function fetchPage(offset: number): Promise<Record<string, unknown>[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/cards` +
    `?select=*&order=id.asc&limit=${PAGE}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>[];
}

async function main() {
  console.log('→ Connexion au Postgres local:', DATABASE_URL.replace(/:[^:@]*@/, ':***@'));
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  // Garde-fou : le schéma doit être en place (créé à l'init du conteneur).
  await pool.query('select 1 from cards limit 1').catch(() => {
    throw new Error(
      "La table `cards` n'existe pas. Lance d'abord `npm run db:up` (docker-compose applique db/schema.sql).",
    );
  });

  const before = await fetchDatasetVersion();
  if (before) {
    console.log(
      `→ Version source: ${before.version} (${before.cards_count ?? '?'} cartes annoncées, ` +
        `empreinte ${before.fingerprint ?? '—'})`,
    );
  } else {
    console.log('→ Source sans suivi de version (table `dataset_versions` absente).');
  }

  let offset = 0;
  let total = 0;
  let presentCols: string[] = [];

  for (;;) {
    const rows = await fetchPage(offset);
    if (rows.length === 0) break;

    if (presentCols.length === 0) {
      presentCols = TARGET_COLUMNS.filter((c) => c in rows[0]);
      console.log('→ Colonnes copiées:', presentCols.join(', '));
      if (!presentCols.includes('id') || !presentCols.includes('name')) {
        throw new Error('Colonnes id/name absentes côté Supabase — abandon.');
      }
    }

    await upsertBatch(pool, presentCols, rows);
    total += rows.length;
    offset += rows.length;
    process.stdout.write(`\r→ ${total} cartes copiées…`);
    if (rows.length < PAGE) break;
  }

  process.stdout.write('\n');
  const { rows } = await pool.query<{ count: string }>('select count(*)::text as count from cards');
  const localCount = Number(rows[0].count);
  console.log(`✓ Migration terminée. Table locale cards: ${localCount} lignes.`);

  await stampVersion(pool, before, total, localCount);
  await pool.end();
}

/** Estampille la copie — seulement si elle est cohérente et non à cheval. */
async function stampVersion(
  pool: pg.Pool,
  before: DatasetVersion | null,
  copied: number,
  localCount: number,
): Promise<void> {
  const hasTable = await pool
    .query('select 1 from catalog_version limit 1')
    .then(() => true)
    .catch(() => false);
  if (!hasTable) {
    console.log('⚠ Table `catalog_version` absente — lance `npm run db:schema`, puis relance.');
    return;
  }
  if (!before) return;

  // Relecture : la source a-t-elle publié une nouvelle version pendant la copie ?
  const after = await fetchDatasetVersion();
  if (after && after.version !== before.version) {
    console.log(
      `⚠ La source est passée de ${before.version} à ${after.version} PENDANT la copie : ` +
        `elle est à cheval sur deux versions, aucune estampille posée. Relance la migration.`,
    );
    return;
  }
  if (before.cards_count != null && before.cards_count !== copied) {
    console.log(
      `⚠ ${copied} cartes copiées pour ${before.cards_count} annoncées par la version ` +
        `${before.version} — écart non expliqué, aucune estampille posée.`,
    );
    return;
  }

  await pool.query(
    `insert into catalog_version (only_row, version, source_recorded_at, fingerprint,
                                  source_cards_count, copied_cards_count, local_cards_count,
                                  migrated_at)
     values (true, $1, $2, $3, $4, $5, $6, now())
     on conflict (only_row) do update set
       version = excluded.version, source_recorded_at = excluded.source_recorded_at,
       fingerprint = excluded.fingerprint, source_cards_count = excluded.source_cards_count,
       copied_cards_count = excluded.copied_cards_count,
       local_cards_count = excluded.local_cards_count, migrated_at = excluded.migrated_at`,
    [before.version, before.recorded_at, before.fingerprint, before.cards_count, copied, localCount],
  );
  console.log(`✓ Catalogue estampillé version ${before.version}.`);
}

async function upsertBatch(
  pool: pg.Pool,
  cols: string[],
  rows: Record<string, unknown>[],
): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((row, r) => {
      const placeholders = cols.map((_, c) => `$${r * cols.length + c + 1}`);
      for (const col of cols) values.push(normalize(col, row[col]));
      return `(${placeholders.join(',')})`;
    });
    const updates = cols
      .filter((c) => c !== 'id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    const sql =
      `insert into cards (${cols.join(',')}) values ${tuples.join(',')} ` +
      `on conflict (id) do update set ${updates}`;
    await pool.query(sql, values);
  }
}

// Coerce les types texte/numérique attendus par le schéma local.
function normalize(col: string, v: unknown): unknown {
  if (v === undefined) return null;
  if (['id', 'atk', 'def', 'level'].includes(col)) {
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

main().catch((err) => {
  console.error('\n✗ Échec migration:', err.message ?? err);
  process.exit(1);
});
