#!/usr/bin/env node
// Rapport d'inventaire des annotations par défaut (docs/annotations-par-defaut.md, partie A).
//
//   node --import tsx scripts/annotations-report.ts --db <url jetable> [--out <rapport.md>]
//
// Lit le catalogue, les cartes de main des decks et les annotations des comptes d'une base
// JETABLE (hôte 127.0.0.1, port explicite différent de 5433 : la base de dev est interdite) et
// mesure la détection de `server/src/domain/cardDefaults.ts` :
//   1. classes HOPT et gabarits non-engine sur le catalogue entier ;
//   2. sur les cartes réellement jouées (main deck), accord entre la détection HOPT et les choix
//      existants (`card_flags.is_hopt`), et profils proposés face aux étiquettes existantes.
// Aucune écriture. Le rapport ne cite que des cartes et des comptages : jamais d'email, de nom
// de compte ni d'identifiant de compte (les comptes sont numérotés dans l'ordre de création).
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { cardDefaults, detectHopt, detectNonEngine, type CardText, type HoptKind } from '../server/src/domain/cardDefaults.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function usage(message: string): never { console.error(`annotations-report : ${message}`); process.exit(2); }
const raw = option('--db');
if (!raw) usage('--db <url> requis');
let url: URL;
try { url = new URL(raw); } catch { usage(`--db : URL invalide (${raw})`); }
if (url!.protocol !== 'postgres:' && url!.protocol !== 'postgresql:') usage('--db : URL postgres:// attendue');
if (url!.hostname !== '127.0.0.1') usage(`--db : hôte ${url!.hostname} refusé, seule une base jetable sur 127.0.0.1 est admise`);
if (!url!.port || url!.port === '5433') usage('--db : port explicite différent de 5433 requis, la base de dev (5433) est interdite');
const outFile = option('--out');

pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
interface CardRow extends CardText { id: number }
interface PlayedRow { card_id: number; decks: number; max_copies: number }
interface FlagRow { owner: number; card_id: number; is_hopt: boolean | null; availability: string | null }
interface LabelRow { owner: number; card_id: number; name: string }

const lines: string[] = [];
const out = (s = ''): void => { lines.push(s); };
const pct = (n: number, d: number): string => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)} %`);

const client = new pg.Client({ connectionString: url!.toString() });
await client.connect();
try {
  const cards = (await client.query<CardRow>('select id, name, type, race, description from cards order by id')).rows;
  const played = (await client.query<PlayedRow>("select card_id, count(distinct deck_id)::int as decks, max(copies)::int as max_copies from deck_cards where zone = 'main' group by card_id order by decks desc, card_id")).rows;
  const owners = "(select id, dense_rank() over (order by created_at, id)::int as n from users)";
  // Une archive antérieure à la migration 002 n'a pas de colonne `availability`.
  const hasAvailability = (await client.query("select 1 from information_schema.columns where table_name = 'card_flags' and column_name = 'availability'")).rowCount === 1;
  const flags = (await client.query<FlagRow>(`select u.n as owner, f.card_id, f.is_hopt, ${hasAvailability ? 'f.availability' : 'null::text as availability'} from card_flags f join ${owners} u on u.id = f.owner_id`)).rows;
  const labels = (await client.query<LabelRow>(`select u.n as owner, cc.card_id, c.name from card_categories cc join nonengine_categories c on c.id = cc.category_id join ${owners} u on u.id = c.owner_id`)).rows;
  const byId = new Map(cards.map((c) => [c.id, c]));

  out('# Annotations par défaut — rapport d\'inventaire');
  out();
  out(`Base : ${url!.hostname}:${url!.port}/${url!.pathname.slice(1)} · ${cards.length} cartes · ${played.length} cartes de main jouées · ${new Set(flags.map((f) => f.owner)).size} compte(s) avec drapeaux.`);
  out();

  // 1. Catalogue
  const kinds: Record<HoptKind, number> = { byName: 0, summonOnce: 0, byName2: 0, soft: 0, none: 0, excluded: 0 };
  const templates = new Map<string, number>();
  for (const c of cards) {
    kinds[detectHopt(c).kind]++;
    const ne = detectNonEngine(c);
    if (ne) templates.set(`${ne.template} → ${ne.availability}${ne.group ? ` + plafond ${ne.group}` : ''}`, (templates.get(`${ne.template} → ${ne.availability}${ne.group ? ` + plafond ${ne.group}` : ''}`) ?? 0) + 1);
  }
  out('## 1. Catalogue entier');
  out();
  out('| Classe HOPT | Cartes | HOPT par défaut |');
  out('| --- | --- | --- |');
  for (const [k, n] of Object.entries(kinds)) out(`| ${k} | ${n} | ${k === 'byName' ? 'oui' : 'non'} |`);
  out();
  out('| Gabarit non-engine → profil | Cartes |');
  out('| --- | --- |');
  for (const [k, n] of [...templates.entries()].sort((a, b) => b[1] - a[1])) out(`| ${k} | ${n} |`);
  out();

  // 2. Cartes jouées
  out('## 2. Cartes de main réellement jouées');
  out();
  const choice = new Map<string, boolean | null>();
  for (const f of flags) choice.set(`${f.owner}:${f.card_id}`, f.is_hopt);
  const ownersSeen = [...new Set(flags.map((f) => f.owner))].sort((a, b) => a - b);
  const matrix = new Map<string, number>();
  const disagreements: string[] = [];
  let covered = 0;
  let unknown = 0;
  let multiCopyHopt = 0;
  for (const p of played) {
    const c = byId.get(p.card_id);
    if (!c) { unknown++; continue; }
    const d = cardDefaults(c);
    const kind = detectHopt(c).kind;
    if (d.isHopt) covered++;
    if (d.isHopt && p.max_copies >= 2) multiCopyHopt++;
    for (const o of ownersSeen) {
      const ch = choice.get(`${o}:${p.card_id}`);
      const key = `${d.isHopt ? 'HOPT' : 'pas HOPT'} / compte ${o} : ${ch === undefined || ch === null ? 'aucun choix' : ch ? 'vrai' : 'faux'}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);
      if (ch !== undefined && ch !== null && ch !== d.isHopt) disagreements.push(`- compte ${o} · ${c.name} (${p.decks} deck(s), ${p.max_copies} ex. max) : détection ${kind}${d.isHopt ? ' (HOPT)' : ''}, choix ${ch ? 'vrai' : 'faux'}`);
    }
  }
  out(`Cartes jouées : ${played.length} (${unknown} absente(s) du catalogue) · HOPT par défaut : ${covered} (${pct(covered, played.length - unknown)}) · dont à 2 exemplaires ou plus : ${multiCopyHopt}.`);
  out();
  out('| Détection / choix du compte | Cartes |');
  out('| --- | --- |');
  for (const [k, n] of [...matrix.entries()].sort()) out(`| ${k} | ${n} |`);
  out();
  out('Désaccords (détection ≠ choix explicite) :');
  out();
  for (const d of disagreements) out(d);
  if (disagreements.length === 0) out('- aucun');
  out();

  // 3. Profils proposés sur les cartes jouées, face aux étiquettes existantes
  out('## 3. Profils non-engine proposés sur les cartes jouées');
  out();
  const labelsOf = new Map<number, Set<string>>();
  for (const l of labels) { if (!labelsOf.has(l.card_id)) labelsOf.set(l.card_id, new Set()); labelsOf.get(l.card_id)!.add(l.name); }
  const profileOf = new Map<number, Set<string>>();
  for (const f of flags) if (f.availability) { if (!profileOf.has(f.card_id)) profileOf.set(f.card_id, new Set()); profileOf.get(f.card_id)!.add(f.availability); }
  out('| Carte | Decks | Gabarit → profil proposé | Étiquettes existantes | Profils existants |');
  out('| --- | --- | --- | --- | --- |');
  for (const p of played) {
    const c = byId.get(p.card_id);
    if (!c) continue;
    const ne = detectNonEngine(c);
    const existing = labelsOf.get(p.card_id);
    const prof = profileOf.get(p.card_id);
    if (!ne && !existing && !prof) continue;
    out(`| ${c.name} | ${p.decks} | ${ne ? `${ne.template} → ${ne.availability}${ne.group ? ` + ${ne.group}` : ''}` : '—'} | ${existing ? [...existing].sort().join(', ') : '—'} | ${prof ? [...prof].sort().join(', ') : '—'} |`);
  }
  out();
} finally {
  await client.end();
}
const report = lines.join('\n') + '\n';
if (outFile) writeFileSync(outFile, report);
process.stdout.write(report);
