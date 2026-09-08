import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { Configuration } from '../src/domain/deckConfiguration.js';

// Étape 8 (8A) : migration 003 (refus nominatifs, simulation annulée volontairement,
// acceptation par empreinte, purge exacte, rejeu, schema.sql sans résurrection) puis
// prune-stale-cards sur les emplacements v2, avec un faux Supabase local (aucun réseau).
// Même garde que persistence.integration.ts : uniquement la base jetable step23.
const url=new URL(process.env.TEST_DATABASE_URL ?? 'http://missing');
if (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/step23') throw new Error('Use the disposable step23 database on 127.0.0.1:55433 via TEST_DATABASE_URL.');
process.env.DATABASE_URL=url.toString();
const { pool, query }=await import('../src/db.js');
const { decksRoutes }=await import('../src/routes/decks.js');
const { libraryRoutes }=await import('../src/routes/library.js');

const sql=(rel: string) => readFile(new URL(rel,import.meta.url),'utf8');
const schema=await sql('../../db/schema.sql');
const m1=await sql('../../db/migrations/001-deck-configuration.sql');
const m2=await sql('../../db/migrations/002-profiles-and-conditions.sql');
const m3=await sql('../../db/migrations/003-purge-legacy.sql');
const fixture=await sql('./fixtures/legacy-representative.sql');
const SERVER_DIR=fileURLToPath(new URL('..',import.meta.url));

const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b1';
const D1='00000000-0000-4000-8000-0000000000d1',D2='00000000-0000-4000-8000-0000000000d2',D3='00000000-0000-4000-8000-0000000000d3',D4='00000000-0000-4000-8000-0000000000d4';
const P1='00000000-0000-4000-8000-000000000001';
const E001='00000000-0000-4000-8000-00000000e001',E003='00000000-0000-4000-8000-00000000e003';
const C001='00000000-0000-4000-8000-00000000c001';
const uid=(s: string) => `00000000-0000-4000-8000-0000000${s}`; // 5 caractères hexadécimaux
const leaf=(card_id: number, at_least=1) => ({ kind:'remaining',card_id,at_least });

const app=Fastify();
app.decorateRequest('user',null);
app.addHook('onRequest',async (req) => { req.user={ id: req.headers['x-test-owner'] === 'b' ? B : A,email:'test@example.invalid',display_name:'Test' }; });
await app.register(decksRoutes,{ prefix:'/decks' });
await app.register(libraryRoutes,{ prefix:'/library' });
const inject=(method: 'GET'|'POST'|'PUT'|'DELETE', url: string, payload?: unknown, user?: 'b') =>
  app.inject({ method,url,payload: payload as never,headers: user ? { 'x-test-owner':user } : {} });

/** Réinitialise UNIQUEMENT la base jetable (URL gardée ci-dessus), et seulement si elle est
 *  vide ou porte les fixtures d'une suite de ce dépôt : jamais une base inconnue. */
async function reset() {
  const tables=await query("select count(*)::int as n from pg_tables where schemaname='public'");
  if (tables.rows[0].n > 0) {
    const known=await query("select 1 from users where email in ('owner@example.invalid','owner-a@example.invalid') limit 1").catch(() => ({ rowCount:0 }));
    assert.ok(known.rowCount,'La base jetable porte des tables inconnues : refus de la réinitialiser.');
  }
  await query('drop schema public cascade; create schema public;');
}

type Report={ lines: Array<{ section: string; line: string }>; notices: string[]; of: (section: string) => string[]; status: string; fingerprint: string };
/** Joue 003 dans une session dédiée (GUC de session posées avant le fichier), rend le rapport. */
async function migrate003(opts: { mode?: 'simulate'; accept?: string }={}): Promise<Report> {
  const client=await pool.connect();
  const notices: string[]=[];
  const onNotice=(n: { message?: string }) => { notices.push(n.message ?? ''); };
  client.on('notice',onNotice);
  try {
    await client.query(`set testhand.purge_mode = '${opts.mode ?? ''}'`);
    await client.query(`set testhand.purge_accept = '${opts.accept ?? ''}'`);
    const results=await client.query(m3) as unknown;
    const lines=(Array.isArray(results) ? results : [results]).flatMap((r: { rows?: Array<{ section?: string; line?: string }> }) => (r.rows ?? []).filter((x) => x.section && x.line)) as Array<{ section: string; line: string }>;
    const of=(section: string) => lines.filter((l) => l.section === section).map((l) => l.line);
    return { lines,notices,of,status: of('statut')[0] ?? '',fingerprint: (of('empreinte')[0] ?? '').replace('empreinte du rapport : ','') };
  } catch (e) {
    // Le fichier ouvre sa propre transaction : après un refus, la session reste en
    // transaction annulée tant qu'un rollback n'est pas envoyé (comme psql à la déconnexion).
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.removeListener('notice',onNotice);client.release(); }
}
const regclass=async (name: string) => (await query('select to_regclass($1) as r',[name])).rows[0].r as string | null;
const count=async (table: string) => (await query(`select count(*)::int as n from ${table}`)).rows[0].n as number;
const legacyColumns=async () => (await query("select count(*)::int as n from information_schema.columns where table_schema='public' and ((table_name='nonengine_categories' and column_name='relevance') or (table_name='card_flags' and column_name in ('dead_first','dead_second')))")).rows[0].n as number;
const journaled=async (id: string) => (await query('select 1 from app_migrations where id=$1',[id])).rowCount === 1;
async function legacyIntact() {
  assert.equal(await regclass('combo_pairs'),'combo_pairs');assert.equal(await count('combo_pairs'),4);
  assert.equal(await count('deck_pair_exclusions'),1);assert.equal(await count('deck_start_requirements'),5);assert.equal(await count('deck_requirements'),3);
  assert.equal(await legacyColumns(),3);assert.equal(await journaled('003-purge-legacy'),false);
}

// ─── Faux Supabase : pages d'ids triés, ≥ 10 000 pour passer le garde-fou du script ───
const CURRENT_SYNTHETIC=[...Array.from({ length:19 },(_,i) => 90000001+i),90000105,90000106];
const SOURCE_IDS=[...Array.from({ length:10_000 },(_,i) => i+1),...CURRENT_SYNTHETIC];
const stub=createServer((req,res) => {
  const u=new URL(req.url ?? '/','http://stub');
  if (!u.pathname.endsWith('/rest/v1/cards')) { res.statusCode=404;return res.end('{}'); }
  const limit=Number(u.searchParams.get('limit') ?? 1000),offset=Number(u.searchParams.get('offset') ?? 0);
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify(SOURCE_IDS.slice(offset,offset+limit).map((id) => ({ id }))));
});
await new Promise<void>((r) => stub.listen(0,'127.0.0.1',r));
const STUB_URL=`http://127.0.0.1:${(stub.address() as { port: number }).port}`;

function runPrune(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child=spawn(process.execPath,['--import','tsx','scripts/prune-stale-cards.ts',...args],{ cwd:SERVER_DIR,env:{ ...process.env,DATABASE_URL:url.toString(),SUPABASE_URL:STUB_URL,SUPABASE_ANON_KEY:'stub' } });
    let stdout='',stderr='';
    child.stdout.on('data',(d) => { stdout+=d; });child.stderr.on('data',(d) => { stderr+=d; });
    child.on('close',(status) => resolve({ status,stdout,stderr }));
  });
}
const SNAPSHOT_TABLES=['cards','catalog_version','deck_cards','deck_starters','deck_combo_pairs','deck_conditions','deck_flags','card_flags','card_categories','nonengine_groups'];
async function snapshot(): Promise<string> {
  const parts: string[]=[];
  for (const t of SNAPSHOT_TABLES) parts.push((await query(`select md5(coalesce(string_agg(t::text,'|' order by t::text),'')) as h from ${t} t`)).rows[0].h);
  return parts.join(',');
}

before(async () => {
  await reset();
  await query(schema);await query(fixture);await query(m1);await query(m2);
  await app.ready();
});
after(async () => { await app.close();await pool.end();stub.close(); });

test('prune-stale-cards refuses to run while the legacy model is still there (003 not journalised)',async () => {
  const r=await runPrune(['--apply']);
  assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stderr,/003-purge-legacy\.sql avant la purge du catalogue/);
  assert.equal(await count('cards'),19);await legacyIntact();
});

test('003 refuses without the 002 journal entry and changes nothing',async () => {
  await query("delete from app_migrations where id='002-profiles-and-conditions'");
  await assert.rejects(migrate003(),/Apply 001-deck-configuration and 002-profiles-and-conditions/);
  await query("insert into app_migrations (id) values ('002-profiles-and-conditions')");
  await legacyIntact();
});

test('003 refuses and names a legacy card-source requirement never converted by 001',async () => {
  const stray=uid('0e006');
  await query('insert into deck_start_requirements (id,deck_id,source_card_id,required_card_id,min_in_deck) values ($1,$2,90000003,90000005,1)',[stray,D3]);
  await assert.rejects(migrate003(),(e: Error) => /jamais converti/.test(e.message) && e.message.includes(stray) && e.message.includes('Deck A3') && e.message.includes('90000003 « Combo Gamma »'));
  await query('delete from deck_start_requirements where id=$1',[stray]);
  await legacyIntact();
});

test('003 refuses and names a v2 requirement whose source has no ET/OU condition',async () => {
  const stray=uid('0e007');
  await query('insert into deck_requirements (deck_id,id,source_card_id,required_card_id,min_in_deck) values ($1,$2,90000003,90000005,1)',[D3,stray]);
  await assert.rejects(migrate003(),(e: Error) => /sans condition ET\/OU/.test(e.message) && e.message.includes(stray) && e.message.includes('Deck A3'));
  await query('delete from deck_requirements where id=$1',[stray]);
  await legacyIntact();
});

test('003 refuses a deck still carrying a horizon in params',async () => {
  await query(`update decks set params=params || '{"horizonFirst":1}' where id=$1`,[D3]);
  await assert.rejects(migrate003(),(e: Error) => /horizon/.test(e.message) && e.message.includes('Deck A3'));
  await query(`update decks set params=params - 'horizonFirst' where id=$1`,[D3]);
  await legacyIntact();
});

let fingerprint='';
test('simulation plays the whole purge, rolls it back on purpose, reports every line and ends normally',async () => {
  const sim=await migrate003({ mode:'simulate' });
  assert.match(sim.status,/^SIMULATION TERMINÉE : purge jouée puis annulée volontairement/,`statut : ${JSON.stringify(sim.status)} (${sim.lines.length} lignes)`);
  assert.match(sim.fingerprint,/^[0-9a-f]{32}$/);
  assert.equal(sim.of('compte').length,2);
  assert.match(sim.of('compte')[0],new RegExp(`^compte ${A} : 3 paire\\(s\\) globale\\(s\\), 1 exclusion\\(s\\), 1 prérequis source paire, 3 deck\\(s\\)$`));
  const p1=sim.of('P1');assert.equal(p1.length,4);
  assert.equal(p1[0],`compte ${A} · paire ${P1} : 90000001 « Starter Alpha » + 90000002 « Starter Beta » · note : « Alpha + Beta : ouverture principale » · exclue dans 1 deck(s) · 1 prérequis source paire`);
  assert.ok(p1.some((l) => l.includes('90000003 « Combo Gamma » + 90000004 « Combo Delta » · sans note · exclue dans 0 deck(s) · 0 prérequis source paire')));
  assert.ok(p1[3].startsWith(`compte ${B} · paire`) && p1[3].includes('note : « Paire B »'));
  assert.equal(sim.of('P2').length,1);assert.match(sim.of('P2')[0],/« Deck A2 ».*exclut la paire 00000000-0000-4000-8000-000000000001$/);
  assert.equal(sim.of('P3').length,2);assert.ok(sim.of('P3').every((l) => l.endsWith('· supprimé avec la paire')));
  const p4=sim.of('P4');assert.equal(p4.length,3);
  assert.ok(p4.every((l) => l.includes('origine : prérequis historique converti par 001') && l.endsWith('· table supprimée, condition conservée')));
  assert.equal(p4.filter((l) => l.includes(`→ condition ${E001}`)).length,2);assert.ok(p4.some((l) => l.includes(`→ condition ${E003}`)));
  assert.equal(sim.of('P5').length,5);assert.ok(sim.of('P5').some((l) => l.includes('« Quick »') && l.includes('relevance = first')));
  assert.equal(sim.of('P6').length,2);assert.ok(sim.of('P6').some((l) => l.includes('90000010 « Breaker Kappa » : dead_first = true, dead_second = false')));
  assert.ok(sim.of('avant').includes('combo_pairs : 4') && sim.of('avant').includes('deck_start_requirements : 5 (source carte 3, source paire 2)') && sim.of('avant').includes('deck_conditions : 2'));
  assert.equal(sim.of('résumé')[0],'à purger : 14 ligne(s) — P1 paires 4, P2 exclusions 1, P3 prérequis source paire 2, P5 pertinences 5, P6 drapeaux 2 ; P4 prérequis v2 convertis retirés avec leur table : 3');
  assert.ok(sim.of('après').includes('combo_pairs, deck_pair_exclusions, deck_start_requirements, deck_requirements : seraient supprimées'));
  assert.ok(sim.notices.some((n) => n.startsWith('[003 statut] SIMULATION TERMINÉE')));
  await legacyIntact();
  // Déterminisme : une seconde simulation donne la même empreinte.
  assert.equal((await migrate003({ mode:'simulate' })).fingerprint,sim.fingerprint);
  fingerprint=sim.fingerprint;
});

test('apply requires the accepted fingerprint, refuses if the data moved since, then purges exactly what was announced',async () => {
  await assert.rejects(migrate003(),/Purge non acceptée : 14 ligne\(s\)/);
  await assert.rejects(migrate003({ accept:'0'.repeat(32) }),/Purge non acceptée/);
  await legacyIntact();
  // Une paire apparue après la simulation change l'empreinte : refus.
  await query('insert into combo_pairs (id,owner_id,card_a_id,card_b_id) values ($1,$2,90000003,90000004)',[uid('00005'),B]);
  await assert.rejects(migrate003({ accept:fingerprint }),/Purge non acceptée/);
  await query('delete from combo_pairs where id=$1',[uid('00005')]);
  await legacyIntact();

  const applied=await migrate003({ accept:fingerprint });
  assert.equal(applied.status,`PURGE APPLIQUÉE : 003-purge-legacy journalisée, 14 ligne(s) supprimée(s), empreinte ${fingerprint}.`);
  assert.ok(applied.of('après').includes('combo_pairs, deck_pair_exclusions, deck_start_requirements, deck_requirements : supprimées'));
  assert.equal(await journaled('003-purge-legacy'),true);
  for (const t of ['combo_pairs','deck_pair_exclusions','deck_start_requirements','deck_requirements']) assert.equal(await regclass(t),null,t);
  assert.equal(await legacyColumns(),0);
  assert.equal(await count('decks'),4);assert.equal(await count('deck_cards'),61);assert.equal(await count('deck_starters'),6);
  assert.equal(await count('deck_combo_pairs'),0);assert.equal(await count('deck_conditions'),2);assert.equal(await count('deck_flags'),6);
  assert.equal(await count('card_flags'),5);assert.equal(await count('nonengine_categories'),5);assert.equal(await count('card_categories'),7);assert.equal(await count('cards'),19);
  const conditions=(await query('select deck_id,id,source_card_id,source_pair_id,condition from deck_conditions order by deck_id')).rows;
  assert.deepEqual(conditions,[
    { deck_id:D1,id:E001,source_card_id:90000001,source_pair_id:null,condition:{ kind:'and',all:[leaf(90000014),leaf(90000003,2)] } },
    { deck_id:D2,id:E003,source_card_id:90000002,source_pair_id:null,condition:{ kind:'and',all:[leaf(90000005)] } },
  ]);
  // L'API vit sur la base purgée : lecture, catégorie sans pertinence, enregistrement, duplication.
  const d=(await inject('GET',`/decks/${D1}`)).json();
  assert.equal(d.pairs.length,0);assert.equal(d.conditions.length,1);assert.deepEqual(d.deadFirst,[90000010]);assert.deepEqual(d.deadSecond,[90000009]);assert.deepEqual(d.params,{ importance:0.5 });
  const cat=await inject('POST','/library/categories',{ name:'Après purge' });
  assert.equal(cat.statusCode,201,cat.body);assert.equal(cat.json().relevance,undefined);
  const lib=(await inject('GET','/library')).json();
  assert.equal(lib.categories.length,4);assert.deepEqual(lib.hoptCardIds.sort(),[90000005,90000006]);
  const configuration: Configuration={ version:2,name:d.name,cards:d.cards,starters:d.starters,pairs:d.pairs,conditions:d.conditions,deadFirst:d.deadFirst,deadSecond:d.deadSecond,params:d.params,notes:d.notes };
  const saved=await inject('PUT',`/decks/${D1}`,{ configuration,expectedRevision:d.revision });
  assert.equal(saved.statusCode,200,saved.body);
  const dup=await inject('POST',`/decks/${D1}/duplicate`);assert.equal(dup.statusCode,201,dup.body);
  assert.equal((await inject('GET',`/decks/${dup.json().id}`)).json().conditions.length,1);
  assert.equal((await inject('GET',`/decks/${D1}`,undefined,'b')).statusCode,404);
  await query('delete from decks where id=$1',[dup.json().id]);
});

test('003 replays without effect, schema.sql no longer resurrects any legacy object, and a resurrected object is refused',async () => {
  assert.equal((await migrate003()).status,'003-purge-legacy déjà appliquée : aucun effet.');
  await query(schema);
  for (const t of ['combo_pairs','deck_pair_exclusions','deck_start_requirements']) assert.equal(await regclass(t),null,t);
  assert.equal(await legacyColumns(),0);
  assert.equal((await migrate003()).status,'003-purge-legacy déjà appliquée : aucun effet.');
  await query('create table combo_pairs (id int)');
  await assert.rejects(migrate003(),/journalisée mais un objet historique est réapparu.*table combo_pairs/);
  await query('drop table combo_pairs');
});

test('prune-stale-cards remaps every v2 location (pairs, conditions, JSON leaves, deck and card flags), keeps unsafe orphans, simulation first',async () => {
  await query(`insert into cards (id,name,type) values (90000101,'Starter Alpha','Effect Monster'),(90000102,'Lost Card','Spell Card'),(90000103,'Gone','Spell Card'),
    (90000104,'Twin','Effect Monster'),(90000105,'Twin','Effect Monster'),(90000106,'Twin','Effect Monster')`);
  await query(`insert into deck_cards (deck_id,card_id,zone,copies) values ($1,90000101,'main',2),($2,90000102,'main',1),($2,90000104,'main',1)`,[D3,D4]);
  await query('insert into deck_starters (deck_id,card_id) values ($1,90000101)',[D3]);
  await query(`insert into deck_combo_pairs (deck_id,id,card_a_id,card_b_id,note,disabled) values ($1,$2,90000003,90000101,'ancienne',false),($1,$3,90000001,90000003,'courante',false),($1,$4,90000001,90000101,null,false)`,[D3,uid('0f001'),uid('0f002'),uid('0f003')]);
  await query(`insert into deck_conditions (deck_id,id,source_card_id,source_pair_id,condition) values
    ($1,$3,null,$2,$6::jsonb),($1,$5,null,$4,$7::jsonb),($1,$8,90000101,null,$9::jsonb),($10,$11,90000001,null,$12::jsonb)`,
    [D3,uid('0f001'),uid('0f101'),uid('0f003'),uid('0f102'),JSON.stringify(leaf(90000005)),JSON.stringify(leaf(90000006)),
      uid('0f103'),JSON.stringify({ kind:'and',all:[leaf(90000102),leaf(90000101,2)] }),
      D4,uid('0f104'),JSON.stringify({ kind:'or',any:[leaf(90000101),{ kind:'and',all:[leaf(90000003)] }] })]);
  await query('insert into deck_flags (deck_id,card_id,dead_first,dead_second) values ($1,90000101,true,false),($1,90000001,false,true)',[D3]);
  await query(`insert into nonengine_groups (id,owner_id,name,cap_per_turn) values ($1,$2,'Plafond',2)`,[uid('0a001'),A]);
  await query(`insert into card_flags (owner_id,card_id,is_hopt,availability,group_id) values ($1,90000101,false,'early',$2),($1,90000001,true,null,null)`,[A,uid('0a001')]);
  await query('insert into card_categories (card_id,category_id) values (90000101,$1),(90000001,$1)',[C001]);
  const before=await snapshot();

  const emitted=path.join(tmpdir(),`testhand-prune-${process.pid}.sql`);
  const sim=await runPrune(['--emit-sql',emitted]);
  assert.equal(sim.status,0,sim.stdout+sim.stderr);
  assert.match(sim.stdout,/SIMULATION — tout a été joué puis annulé/);
  // 10 références : deck_cards, deck_starters, deux paires, une source de condition, deux feuilles, deck_flags, card_flags, card_categories.
  assert.match(sim.stdout,/90000101\s+→ 90000001\s+Starter Alpha\s+⟵ 10 référence\(s\) à reporter/);
  assert.match(sim.stdout,/90000103\s+Gone/);
  // Lost Card : une copie en deck + une feuille de condition = 2 (jsonpath strict, sans doublon).
  assert.match(sim.stdout,/90000102\s+Lost Card — 2 référence\(s\), aucune carte de ce nom dans la source/);
  assert.match(sim.stdout,/90000104\s+Twin — 1 référence\(s\), homonymes: 90000105, 90000106/);
  assert.equal(await snapshot(),before,'la simulation ne modifie rien');
  const emittedSql=await readFile(emitted,'utf8');
  assert.match(emittedSql,/create temporary table dcp_dup/);
  assert.match(emittedSql,/update deck_conditions set condition = '\{"kind":"and","all":\[\{"kind":"remaining","card_id":90000102,"at_least":1\},\{"kind":"remaining","card_id":90000001,"at_least":2\}\]\}'::jsonb/);
  assert.match(emittedSql,/delete from cards where id = any\('\{90000101,90000103\}'::bigint\[\]\)/);

  const applied=await runPrune(['--apply']);
  assert.equal(applied.status,0,applied.stdout+applied.stderr);assert.match(applied.stdout,/✓ Appliqué/);
  assert.equal(await count('cards'),23);
  assert.deepEqual((await query('select id from cards where id in (90000101,90000102,90000103,90000104) order by id')).rows.map((r) => r.id),[90000102,90000104]);
  assert.deepEqual((await query('select card_id,copies from deck_cards where deck_id=$1 and card_id in (90000001,90000101) order by card_id',[D3])).rows,[{ card_id:90000001,copies:3 }]);
  assert.deepEqual((await query('select card_id from deck_starters where deck_id=$1 order by card_id',[D3])).rows.map((r) => r.card_id),[90000001,90000003]);
  assert.deepEqual((await query('select id,card_a_id,card_b_id,note from deck_combo_pairs where deck_id=$1 order by id',[D3])).rows,[{ id:uid('0f002'),card_a_id:90000001,card_b_id:90000003,note:'courante' }]);
  const conditions=(await query('select id,source_card_id,source_pair_id,condition from deck_conditions where id in ($1,$2,$3,$4) order by id',[uid('0f101'),uid('0f102'),uid('0f103'),uid('0f104')])).rows;
  assert.deepEqual(conditions,[
    { id:uid('0f101'),source_card_id:null,source_pair_id:uid('0f002'),condition:leaf(90000005) },
    { id:uid('0f103'),source_card_id:90000001,source_pair_id:null,condition:{ kind:'and',all:[leaf(90000102),leaf(90000001,2)] } },
    { id:uid('0f104'),source_card_id:90000001,source_pair_id:null,condition:{ kind:'or',any:[leaf(90000001),{ kind:'and',all:[leaf(90000003)] }] } },
  ]);
  assert.deepEqual((await query('select card_id,dead_first,dead_second from deck_flags where deck_id=$1 and card_id in (90000001,90000101)',[D3])).rows,[{ card_id:90000001,dead_first:true,dead_second:true }]);
  assert.deepEqual((await query('select card_id,is_hopt,availability,group_id from card_flags where owner_id=$1 and card_id in (90000001,90000101)',[A])).rows,[{ card_id:90000001,is_hopt:true,availability:'early',group_id:uid('0a001') }]);
  assert.equal((await query('select count(*)::int as n from card_categories where card_id in (90000001,90000101)')).rows[0].n,1);
  assert.equal((await query('select local_cards_count from catalog_version')).rows[0].local_cards_count,23);
  assert.match(applied.stdout,/1\s+deck_conditions \(condition d’une paire dégénérée supprimée\)/);
  assert.match(applied.stdout,/2\s+deck_conditions\.condition \(feuilles reportées\)/);
  // Relance : plus rien à reporter, les orphelins sans cible sûre restent conservés.
  const again=await runPrune(['--apply']);
  assert.equal(again.status,0,again.stdout+again.stderr);assert.match(again.stdout,/Rien à faire/);assert.match(again.stdout,/2 CONSERVÉE\(S\)/);
});

test('prune-stale-cards rolls back everything when a remap would merge two conditions or contradict profiles',async () => {
  await query(`insert into cards (id,name,type) values (90000107,'Combo Gamma','Effect Monster')`);
  await query(`insert into deck_combo_pairs (deck_id,id,card_a_id,card_b_id,disabled) values ($1,$2,90000004,90000107,false),($1,$3,90000003,90000004,false)`,[D1,uid('0f004'),uid('0f005')]);
  await query(`insert into deck_conditions (deck_id,id,source_card_id,source_pair_id,condition) values ($1,$2,null,$3,$4::jsonb),($1,$5,null,$6,$7::jsonb)`,
    [D1,uid('0f105'),uid('0f004'),JSON.stringify(leaf(90000005)),uid('0f106'),uid('0f005'),JSON.stringify(leaf(90000006))]);
  await query(`insert into card_flags (owner_id,card_id,is_hopt,availability) values ($1,90000107,false,'breaker'),($1,90000003,false,'early')`,[A]);
  const before=await snapshot();
  const pairConflict=await runPrune(['--apply']);
  assert.equal(pairConflict.status,1,pairConflict.stdout);
  assert.match(pairConflict.stderr,new RegExp(`deck ${D1}, les paires ${uid('0f004')} et ${uid('0f005')} fusionnent et portent chacune une condition`));
  assert.equal(await snapshot(),before,'rien ne change en cas de conflit');
  await query('delete from deck_conditions where id=$1',[uid('0f105')]);
  const afterFix=await snapshot();
  const profileConflict=await runPrune(['--apply']);
  assert.equal(profileConflict.status,1,profileConflict.stdout);
  assert.match(profileConflict.stderr,/profil ou un plafond contradictoire \(breaker \/ — contre early \/ —\)/);
  assert.equal(await snapshot(),afterFix);
  await query(`update card_flags set availability='early' where card_id=90000107`);
  const ok=await runPrune(['--apply']);
  assert.equal(ok.status,0,ok.stdout+ok.stderr);
  assert.deepEqual((await query('select id,card_a_id,card_b_id from deck_combo_pairs where deck_id=$1 order by id',[D1])).rows,[{ id:uid('0f005'),card_a_id:90000003,card_b_id:90000004 }]);
  assert.equal((await query('select source_pair_id from deck_conditions where id=$1',[uid('0f106')])).rows[0].source_pair_id,uid('0f005'));
  assert.equal((await query('select count(*)::int as n from cards where id=90000107')).rows[0].n,0);
  assert.equal((await query('select availability from card_flags where owner_id=$1 and card_id=90000003',[A])).rows[0].availability,'early');
});
