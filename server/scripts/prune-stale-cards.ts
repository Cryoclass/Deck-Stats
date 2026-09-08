/**
 * Purge des cartes du catalogue local absentes de la source Supabase, avec
 * REPORT préalable des références utilisateur vers le passcode courant.
 *
 * Pourquoi : `migrate-cards.ts` fait `on conflict do update` — il ajoute et met
 * à jour, il ne supprime jamais. Les entrées retirées côté source (passcodes
 * provisoires `1004xxxxx`/`1014xxxxx` que YGOPRODeck attribue aux cartes OCG
 * puis remplace par le vrai passcode à la sortie TCG) restent donc en base et
 * ressortent en double dans la recherche par nom.
 *
 *   npm run prune-cards                          # simulation : joue TOUT puis rollback
 *   npm run prune-cards -- --apply               # exécute et valide
 *   npm run prune-cards -- --only-remappable     # ne touche qu'aux doublons ayant une cible
 *   npm run prune-cards -- --emit-sql purge.sql  # écrit le SQL autonome (prod)
 *
 * Le catalogue étant un LOOKUP et non une contrainte (cf. note de schema.sql),
 * aucune FK ne fait le report à notre place : chaque emplacement de passcode est
 * traité un par un, conflits de clés composites compris.
 *
 * Étape 8 : le modèle historique (combo_pairs, deck_pair_exclusions,
 * deck_start_requirements, deck_requirements) est purgé par la migration 003 ; ce
 * script REFUSE de tourner tant qu'elle n'est pas journalisée, et ne connaît que les
 * emplacements v2 : deck_cards, deck_starters, card_flags (profil et plafond compris),
 * card_categories, deck_combo_pairs (paires par deck), deck_conditions (source carte,
 * source paire, feuilles `card_id` de l'arbre JSON) et deck_flags.
 *
 * Règles de sûreté : un orphelin RÉFÉRENCÉ mais SANS cible sûre n'est jamais
 * supprimé — perdre la ligne changerait silencieusement les probabilités d'un
 * deck. Il est conservé et signalé. Un conflit que l'outil ne sait pas résoudre
 * sûrement (deux conditions pour une même source après fusion de paires, profils ou
 * plafonds contradictoires) annule TOUTE la transaction en nommant le conflit.
 *
 * Tout est dans UNE transaction : ou tout passe, ou rien ne change.
 */
import '../src/env.js';
import { pool } from '../src/db.js';
import { writeFileSync } from 'node:fs';
import type pg from 'pg';
import type { ConditionNode } from '../src/domain/deckConfiguration.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_REMAPPABLE = args.includes('--only-remappable');
const emitAt = args.indexOf('--emit-sql');
const EMIT_TO = emitAt >= 0 ? args[emitAt + 1] : null;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://fczujhwaxkmspdgvuyyg.supabase.co';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_VhrITzX99YP_j7u6GUpWsw_taHSczkR';

const PAGE = 1000;
// Garde-fou : sous ce seuil, la source est considérée en panne ou tronquée.
// Sans lui, une réponse vide ferait de TOUT le catalogue un « orphelin ».
const MIN_EXPECTED = 10_000;

/** Emplacements de passcode en colonne, hors `cards` (catalogue = lookup, pas de FK). */
type Ref = { table: string; column: string; where?: string };
const REFS: Ref[] = [
  { table: 'deck_cards', column: 'card_id' },
  { table: 'deck_starters', column: 'card_id' },
  { table: 'card_flags', column: 'card_id' },
  { table: 'card_categories', column: 'card_id' },
  { table: 'deck_combo_pairs', column: 'card_a_id' },
  { table: 'deck_combo_pairs', column: 'card_b_id' },
  { table: 'deck_conditions', column: 'source_card_id', where: 'source_card_id is not null' },
  { table: 'deck_flags', column: 'card_id' },
];
// Feuilles `{ kind: 'remaining', card_id, at_least }` de l'arbre ET/OU, à toute profondeur.
// Mode strict obligatoire : en mode lax, `.**` rend chaque élément de tableau deux fois.
const LEAF_REFS_SQL =
  `select (leaf->>'card_id')::bigint as card_id, count(*) as n from deck_conditions c ` +
  `cross join lateral jsonb_path_query(c.condition, 'strict $.** ? (@.kind == "remaining")') as leaf group by 1`;

async function fetchSupabaseIds(): Promise<number[]> {
  const ids: number[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cards?select=id&order=id.asc&limit=${PAGE}&offset=${offset}`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
    );
    if (!res.ok) {
      throw new Error(`Supabase ${res.status} ${res.statusText}: ${await res.text()}`);
    }
    const rows = (await res.json()) as { id: number | string }[];
    for (const r of rows) ids.push(Number(r.id));
    process.stdout.write(`\r→ ${ids.length} ids lus depuis Supabase…`);
    if (rows.length < PAGE) break;
  }
  process.stdout.write('\n');
  return ids;
}

// ─── Journal SQL (option --emit-sql) ───
// Les opérations sont écrites une seule fois, en SQL paramétré : elles sont
// soit exécutées, soit inlinées dans le fichier. Aucune divergence possible
// entre ce qui est simulé ici et ce qui sera joué en production.
const sqlLog: string[] = [];

/** Inline un paramètre. N'accepte QUE des entiers, des uuid et le JSON d'un arbre de
 *  condition (clés et valeurs du contrat, sans apostrophe) — rien d'autre ne peut
 *  atteindre le fichier, donc aucune injection possible. */
function lit(v: unknown): string {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) return `'${v}'`;
  if (typeof v === 'string' && v.startsWith('{') && /^[\w\s"{}[\]:,.-]*$/.test(v)) {
    JSON.parse(v); // lève si ce n'est pas du JSON
    return `'${v}'`;
  }
  if (Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isSafeInteger(x))) {
    return `'{${v.join(',')}}'`;
  }
  throw new Error(`Paramètre non sérialisable : ${JSON.stringify(v)}`);
}

function inline(sql: string, params: unknown[]): string {
  return sql.replace(/\$(\d+)(::[a-z[\]]+)?/g, (_, n, cast) => lit(params[Number(n) - 1]) + (cast ?? ''));
}

const counts = new Map<string, number>();

async function run(
  c: pg.PoolClient,
  label: string,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const { rowCount } = await c.query(sql, params as never);
  const n = rowCount ?? 0;
  if (n > 0) counts.set(label, (counts.get(label) ?? 0) + n);
  if (EMIT_TO && n > 0) sqlLog.push(`-- ${label} (${n})\n${inline(sql, params).trim()};`);
  return n;
}

// Désignation de la survivante quand un remap fait collisionner deux paires du même
// deck. Le `order by` fait gagner la paire NON concernée par le remap : c'est elle
// qui porte la note écrite par l'utilisateur et l'identifiant déjà référencé.
const DCP_DUP_SQL = `create temporary table dcp_dup as
  with fin as (
    select deck_id, id, card_a_id, card_b_id,
           least(case when card_a_id = $1 then $2 else card_a_id end,
                 case when card_b_id = $1 then $2 else card_b_id end) as na,
           greatest(case when card_a_id = $1 then $2 else card_a_id end,
                    case when card_b_id = $1 then $2 else card_b_id end) as nb
      from deck_combo_pairs
  ), ranked as (
    select deck_id, id,
           first_value(id) over w as keep_id,
           row_number()    over w as rn
      from fin
    window w as (partition by deck_id, na, nb
                 order by (case when card_a_id = $1 or card_b_id = $1 then 1 else 0 end), id)
  )
  select deck_id, id as loser, keep_id as winner from ranked where rn > 1`;

/** Réécrit les feuilles `card_id = oldId` d'un arbre de condition. */
function remapLeaves(node: ConditionNode, oldId: number, newId: number): ConditionNode {
  switch (node.kind) {
    case 'remaining':
      return node.card_id === oldId ? { ...node, card_id: newId } : node;
    case 'and':
      return { kind: 'and', all: node.all.map((n) => remapLeaves(n, oldId, newId)) };
    case 'or':
      return { kind: 'or', any: node.any.map((n) => remapLeaves(n, oldId, newId)) };
  }
}

/** Report de toutes les références de `oldId` vers `newId`. */
async function remap(c: pg.PoolClient, oldId: number, newId: number): Promise<void> {
  const p = [oldId, newId];

  // ── deck_combo_pairs ── le cas épineux : unicité (deck, a, b) ET check b > a.
  // Une paire (old, new) deviendrait (new, new) : hors périmètre (§D, le moteur ignore
  // a === b, l'UI interdit de la créer). Supprimée, ses conditions avec elle — comptées.
  await run(
    c,
    'deck_conditions (condition d’une paire dégénérée supprimée)',
    `delete from deck_conditions x using deck_combo_pairs p
      where p.deck_id = x.deck_id and p.id = x.source_pair_id
        and p.card_a_id = least($1::bigint, $2::bigint) and p.card_b_id = greatest($1::bigint, $2::bigint)`,
    p,
  );
  await run(
    c,
    'deck_combo_pairs (paire dégénérée supprimée)',
    `delete from deck_combo_pairs
      where card_a_id = least($1::bigint, $2::bigint) and card_b_id = greatest($1::bigint, $2::bigint)`,
    p,
  );

  await c.query(DCP_DUP_SQL, p);
  const dupCount = Number(
    (await c.query<{ n: string }>('select count(*)::text n from dcp_dup')).rows[0].n,
  );
  if (EMIT_TO && dupCount > 0) {
    sqlLog.push(
      `-- paires de combo à fusionner suite au report ${oldId} → ${newId} (${dupCount})\n` +
        inline(DCP_DUP_SQL, p).trim() +
        ';',
    );
  }
  // Refus : la perdante ET la survivante portent une condition dans le même deck.
  // Une seule condition par source (contrat §4) : l'outil ne fusionne pas des conditions
  // écrites par l'utilisateur, il s'arrête et nomme le conflit.
  const conflicts = await c.query<{ deck_id: string; loser: string; winner: string }>(
    `select d.deck_id, d.loser, d.winner from dcp_dup d
      where exists (select 1 from deck_conditions x where x.deck_id = d.deck_id and x.source_pair_id = d.loser)
        and exists (select 1 from deck_conditions y where y.deck_id = d.deck_id and y.source_pair_id = d.winner)`,
  );
  if (conflicts.rowCount) {
    const k = conflicts.rows[0];
    throw new Error(
      `Report ${oldId} → ${newId} : dans le deck ${k.deck_id}, les paires ${k.loser} et ${k.winner} fusionnent et portent chacune une condition. ` +
        `Fusionner ces conditions à la main dans l'application, puis relancer. Tout est annulé.`,
    );
  }
  await run(
    c,
    'deck_conditions.source_pair_id (reportée vers la paire survivante)',
    `update deck_conditions x set source_pair_id = d.winner
       from dcp_dup d where x.deck_id = d.deck_id and x.source_pair_id = d.loser`,
  );
  await run(
    c,
    'deck_combo_pairs (doublon fusionné)',
    `delete from deck_combo_pairs p using dcp_dup d where p.deck_id = d.deck_id and p.id = d.loser`,
  );
  await c.query('drop table dcp_dup');
  if (EMIT_TO && dupCount > 0) sqlLog.push('drop table dcp_dup;');

  // Remap et recanonicalisation en UN seul update : passer par deux updates
  // violerait le check `card_b_id > card_a_id` entre les deux.
  await run(
    c,
    'deck_combo_pairs (reportée)',
    `update deck_combo_pairs
        set card_a_id = least(case when card_a_id = $1 then $2 else card_a_id end,
                              case when card_b_id = $1 then $2 else card_b_id end),
            card_b_id = greatest(case when card_a_id = $1 then $2 else card_a_id end,
                                 case when card_b_id = $1 then $2 else card_b_id end)
      where card_a_id = $1 or card_b_id = $1`,
    p,
  );

  // ── deck_conditions.source_card_id ── unicité (deck, source) : refus si le deck a
  // déjà une condition sur la carte cible.
  const sourceConflict = await c.query<{ deck_id: string }>(
    `select x.deck_id from deck_conditions x
      where x.source_card_id = $1
        and exists (select 1 from deck_conditions y where y.deck_id = x.deck_id and y.source_card_id = $2)`,
    p,
  );
  if (sourceConflict.rowCount) {
    throw new Error(
      `Report ${oldId} → ${newId} : le deck ${sourceConflict.rows[0].deck_id} porte une condition sur chacune des deux cartes. ` +
        `Fusionner ces conditions à la main dans l'application, puis relancer. Tout est annulé.`,
    );
  }
  await run(
    c,
    'deck_conditions.source_card_id (reportée)',
    `update deck_conditions set source_card_id = $2 where source_card_id = $1`,
    p,
  );

  // ── deck_conditions.condition ── feuilles de l'arbre ET/OU, à toute profondeur.
  const trees = await c.query<{ deck_id: string; id: string; condition: ConditionNode }>(
    `select deck_id, id, condition from deck_conditions
      where jsonb_path_exists(condition, 'strict $.** ? (@.card_id == $old)', jsonb_build_object('old', $1::bigint))
      order by deck_id, id`,
    [oldId],
  );
  for (const t of trees.rows) {
    await run(
      c,
      'deck_conditions.condition (feuilles reportées)',
      `update deck_conditions set condition = $3::jsonb where deck_id = $1 and id = $2`,
      [t.deck_id, t.id, JSON.stringify(remapLeaves(t.condition, oldId, newId))],
    );
  }

  // ── deck_cards ── PK (deck_id, card_id, zone). Si le deck contient déjà la
  // carte cible dans la même zone, on cumule les copies (plafond 3 du check).
  await run(
    c,
    'deck_cards (copies cumulées)',
    `update deck_cards d set copies = least(3, d.copies + s.copies)
       from deck_cards s
      where s.card_id = $1 and d.card_id = $2
        and d.deck_id = s.deck_id and d.zone = s.zone`,
    p,
  );
  await run(
    c,
    'deck_cards (doublon fusionné)',
    `delete from deck_cards s
      where s.card_id = $1
        and exists (select 1 from deck_cards d
                     where d.deck_id = s.deck_id and d.zone = s.zone and d.card_id = $2)`,
    p,
  );
  await run(c, 'deck_cards (reportée)', `update deck_cards set card_id = $2 where card_id = $1`, p);

  // ── deck_starters ── PK (deck_id, card_id).
  await run(
    c,
    'deck_starters (doublon fusionné)',
    `delete from deck_starters s
      where s.card_id = $1
        and exists (select 1 from deck_starters d where d.deck_id = s.deck_id and d.card_id = $2)`,
    p,
  );
  await run(
    c,
    'deck_starters (reportée)',
    `update deck_starters set card_id = $2 where card_id = $1`,
    p,
  );

  // ── deck_flags ── PK (deck_id, card_id). Fusion par OU.
  await run(
    c,
    'deck_flags (drapeaux fusionnés)',
    `update deck_flags d
        set dead_first  = d.dead_first  or s.dead_first,
            dead_second = d.dead_second or s.dead_second
       from deck_flags s
      where s.card_id = $1 and d.card_id = $2 and d.deck_id = s.deck_id`,
    p,
  );
  await run(
    c,
    'deck_flags (doublon fusionné)',
    `delete from deck_flags s
      where s.card_id = $1
        and exists (select 1 from deck_flags d where d.deck_id = s.deck_id and d.card_id = $2)`,
    p,
  );
  await run(c, 'deck_flags (reportée)', `update deck_flags set card_id = $2 where card_id = $1`, p);

  // ── card_flags ── PK (owner_id, card_id). HOPT fusionné par OU ; profil et plafond
  // repris s'ils manquent sur la cible ; contradictoires = refus (l'outil ne tranche pas
  // entre deux annotations manuelles).
  const flagConflict = await c.query<{ owner_id: string; sa: string | null; da: string | null; sg: string | null; dg: string | null }>(
    `select s.owner_id, s.availability sa, d.availability da, s.group_id sg, d.group_id dg
       from card_flags s join card_flags d on d.owner_id = s.owner_id and d.card_id = $2
      where s.card_id = $1
        and ((s.availability is not null and d.availability is not null and s.availability <> d.availability)
          or (s.group_id is not null and d.group_id is not null and s.group_id <> d.group_id))`,
    p,
  );
  if (flagConflict.rowCount) {
    const k = flagConflict.rows[0];
    throw new Error(
      `Report ${oldId} → ${newId} : pour le compte ${k.owner_id}, les deux cartes portent un profil ou un plafond contradictoire ` +
        `(${k.sa ?? '—'} / ${k.sg ?? '—'} contre ${k.da ?? '—'} / ${k.dg ?? '—'}). Harmoniser à la main, puis relancer. Tout est annulé.`,
    );
  }
  await run(
    c,
    'card_flags (drapeaux, profil et plafond fusionnés)',
    `update card_flags d
        set is_hopt      = d.is_hopt or s.is_hopt,
            availability = coalesce(d.availability, s.availability),
            group_id     = coalesce(d.group_id, s.group_id)
       from card_flags s
      where s.card_id = $1 and d.card_id = $2 and d.owner_id = s.owner_id`,
    p,
  );
  await run(
    c,
    'card_flags (doublon fusionné)',
    `delete from card_flags s
      where s.card_id = $1
        and exists (select 1 from card_flags d where d.owner_id = s.owner_id and d.card_id = $2)`,
    p,
  );
  await run(c, 'card_flags (reportée)', `update card_flags set card_id = $2 where card_id = $1`, p);

  // ── card_categories ── PK (card_id, category_id).
  await run(
    c,
    'card_categories (doublon fusionné)',
    `delete from card_categories s
      where s.card_id = $1
        and exists (select 1 from card_categories d
                     where d.category_id = s.category_id and d.card_id = $2)`,
    p,
  );
  await run(
    c,
    'card_categories (reportée)',
    `update card_categories set card_id = $2 where card_id = $1`,
    p,
  );
}

type Orphan = { id: number; name: string; targets: number[]; refs: number };

const client = await pool.connect();
try {
  // ── 0. Le modèle historique doit avoir été purgé (migration 003) ──
  const journal = await client.query<{ t: string | null }>("select to_regclass('public.app_migrations') as t");
  const purged = journal.rows[0].t
    ? (await client.query("select 1 from app_migrations where id = '003-purge-legacy'")).rowCount
    : 0;
  if (!purged) {
    throw new Error(
      'Jouer db/migrations/003-purge-legacy.sql avant la purge du catalogue : ce script ne connaît plus ' +
        'les tables historiques (combo_pairs, deck_pair_exclusions, deck_start_requirements, deck_requirements).',
    );
  }

  // ── 1. Source de vérité ──
  const ids = await fetchSupabaseIds();
  if (ids.length < MIN_EXPECTED) {
    throw new Error(
      `Seulement ${ids.length} ids lus (seuil ${MIN_EXPECTED}). Source douteuse — abandon ` +
        `avant de prendre tout le catalogue pour des orphelins.`,
    );
  }

  await client.query('begin');

  await client.query('create temporary table sb_ids (id bigint primary key) on commit drop');
  for (let i = 0; i < ids.length; i += 500) {
    await client.query(
      `insert into sb_ids (id) select * from unnest($1::bigint[]) on conflict do nothing`,
      [ids.slice(i, i + 500)],
    );
  }
  await client.query('analyze sb_ids');

  // ── 2. Orphelins + cible de report ──
  // Cible = une carte de MÊME NOM, toujours présente dans la source. Plusieurs
  // candidats (homonymes / alt arts) = ambigu : on ne devine pas.
  const { rows: orphans } = await client.query<Orphan>(
    `select c.id, c.name,
            coalesce((select array_agg(t.id order by t.id)
                        from cards t join sb_ids s on s.id = t.id
                       where t.name = c.name and t.id <> c.id), '{}') as targets,
            0 as refs
       from cards c
      where not exists (select 1 from sb_ids s where s.id = c.id)
      order by c.name`,
  );

  // ── 3. Références réelles, comptées en une passe (colonnes + feuilles JSON) ──
  const refSql = [
    ...REFS.map(
      (r) =>
        `select ${r.column} as card_id, count(*) as n from ${r.table}` +
        (r.where ? ` where ${r.where}` : '') +
        ` group by ${r.column}`,
    ),
    LEAF_REFS_SQL,
  ].join(' union all ');
  const { rows: refRows } = await client.query<{ card_id: number; n: string }>(
    `select card_id, sum(n)::int as n from (${refSql}) x group by card_id`,
  );
  const refByCard = new Map(refRows.map((r) => [Number(r.card_id), Number(r.n)]));
  for (const o of orphans) o.refs = refByCard.get(Number(o.id)) ?? 0;

  // ── 4. Classement ──
  const remappable = orphans.filter((o) => o.targets.length === 1);
  const undecided = orphans.filter((o) => o.targets.length !== 1);
  // Sans cible sûre, on ne supprime que ce que personne n'utilise.
  const blocked = undecided.filter((o) => o.refs > 0);
  const deletableNoTarget = undecided.filter((o) => o.refs === 0);

  const toRemap = remappable.filter((o) => o.refs > 0);
  const toDelete = ONLY_REMAPPABLE ? remappable : [...remappable, ...deletableNoTarget];

  const { rows: before } = await client.query<{ n: string }>('select count(*)::text n from cards');
  console.log(`\n${'─'.repeat(74)}`);
  console.log(`Catalogue local : ${before[0].n} lignes`);
  console.log(`Source Supabase : ${ids.length} cartes`);
  console.log(`Orphelins       : ${orphans.length}`);
  console.log(`${'─'.repeat(74)}\n`);

  if (remappable.length) {
    console.log(
      `▸ ${remappable.length} doublon(s) périmé(s) — la carte existe sous son passcode courant :`,
    );
    for (const o of remappable) {
      const tag = o.refs > 0 ? `   ⟵ ${o.refs} référence(s) à reporter` : '';
      console.log(
        `    ${String(o.id).padEnd(10)} → ${String(o.targets[0]).padEnd(10)} ${o.name}${tag}`,
      );
    }
    console.log();
  }
  if (deletableNoTarget.length) {
    const verb = ONLY_REMAPPABLE ? 'CONSERVÉE(S) (--only-remappable)' : 'supprimée(s)';
    console.log(
      `▸ ${deletableNoTarget.length} carte(s) disparue(s) de la source, aucune référence — ${verb} :`,
    );
    for (const o of deletableNoTarget) console.log(`    ${String(o.id).padEnd(10)}    ${o.name}`);
    console.log();
  }
  if (blocked.length) {
    console.log(`▸ ${blocked.length} CONSERVÉE(S) — référencée(s) sans cible sûre :`);
    for (const o of blocked) {
      const why =
        o.targets.length > 1
          ? `homonymes: ${o.targets.join(', ')}`
          : 'aucune carte de ce nom dans la source';
      console.log(`    ${String(o.id).padEnd(10)}    ${o.name} — ${o.refs} référence(s), ${why}`);
    }
    console.log();
  }

  // ── 5. Exécution ──
  for (const o of toRemap) await remap(client, Number(o.id), Number(o.targets[0]));

  if (toDelete.length) {
    await run(client, 'cards (supprimée)', `delete from cards where id = any($1::bigint[])`, [
      toDelete.map((o) => Number(o.id)),
    ]);
  }

  // ── 6. Contrôle final : aucune référence pendante vers une carte supprimée ──
  const deletedIds = toDelete.map((o) => Number(o.id));
  if (deletedIds.length) {
    const { rows } = await client.query<{ n: number }>(
      `select coalesce(sum(n), 0)::int as n from (${refSql}) x where card_id = any($1::bigint[])`,
      [deletedIds],
    );
    if (rows[0].n > 0) {
      throw new Error(
        `Contrôle final : ${rows[0].n} référence(s) pointent encore vers une carte supprimée. ` +
          `Tout est annulé : un report est resté en attente, inspecter avant de relancer.`,
      );
    }
  }

  // La purge change le nombre de lignes locales : réaligner l'estampille, sinon
  // `/api/health` annoncerait le compte d'avant purge et deux bases identiques
  // paraîtraient divergentes.
  if (toDelete.length) {
    await run(
      client,
      'catalog_version (compte local réaligné)',
      `update catalog_version set local_cards_count = (select count(*) from cards)`,
    );
  }

  if (counts.size === 0) {
    console.log('Rien à faire : le catalogue local est aligné sur la source.\n');
  } else {
    console.log('Opérations :');
    for (const [label, n] of [...counts].sort()) {
      console.log(`    ${String(n).padStart(5)}  ${label}`);
    }
    console.log();
  }

  if (EMIT_TO) {
    const header =
      `-- Purge des cartes périmées du catalogue — généré le ${new Date().toISOString()}\n` +
      `-- Source : ${SUPABASE_URL} (${ids.length} cartes)\n` +
      `-- À jouer sur une base de MÊME contenu, APRÈS sauvegarde :\n` +
      `--   psql -U ygo -d ygo -v ON_ERROR_STOP=1 -1 -f <ce fichier>\n\n`;
    writeFileSync(EMIT_TO, header + sqlLog.join('\n\n') + '\n');
    console.log(`SQL autonome écrit dans ${EMIT_TO} (${sqlLog.length} opération(s)).\n`);
  }

  if (APPLY) {
    await client.query('commit');
    console.log('✓ Appliqué.\n');
  } else {
    await client.query('rollback');
    console.log('SIMULATION — tout a été joué puis annulé (contraintes comprises).');
    console.log("Rien n'a changé. Relancer avec --apply pour valider.\n");
  }
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error('\n✗ Échec — aucune modification :', (err as Error).message ?? err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
