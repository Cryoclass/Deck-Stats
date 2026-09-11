import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { emptyConfiguration, type Configuration, type ConditionNode } from '../src/domain/deckConfiguration.js';

// This suite never falls back to DATABASE_URL or the developer's .env database.
const url=new URL(process.env.TEST_DATABASE_URL ?? 'http://missing');
if (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/step23') throw new Error('Use the disposable step23 database on 127.0.0.1:55433 via TEST_DATABASE_URL.');
process.env.DATABASE_URL=url.toString();
const { pool, query }=await import('../src/db.js');
const { decksRoutes }=await import('../src/routes/decks.js');
const { libraryRoutes }=await import('../src/routes/library.js');
const app=Fastify();
const owner=randomUUID(),other=randomUUID(),legacyDeck=randomUUID(),legacyPair=randomUUID();
// Deck de l'ère v2 (entre les étapes 3 et 5B) : prérequis ET plats, horizons, résumé.
const v2Deck=randomUUID(),v2Pair=randomUUID();
const reqA='00000000-0000-4000-8000-00000000000a',reqB='00000000-0000-4000-8000-00000000000b',reqC='00000000-0000-4000-8000-00000000000c';
const migration=await readFile(new URL('../../db/migrations/001-deck-configuration.sql',import.meta.url),'utf8');
const migration2=await readFile(new URL('../../db/migrations/002-profiles-and-conditions.sql',import.meta.url),'utf8');
const migration4=await readFile(new URL('../../db/migrations/004-side-plans.sql',import.meta.url),'utf8');
const leaf=(card_id: number, at_least=1): ConditionNode => ({ kind:'remaining',card_id,at_least });
app.decorateRequest('user',null);
app.addHook('onRequest',async (req) => { req.user={ id: req.headers['x-test-owner'] === 'other' ? other : owner,email:'test@example.invalid',display_name:'Test' }; });
await app.register(decksRoutes,{ prefix:'/decks' });
await app.register(libraryRoutes,{ prefix:'/library' });

async function rejects(sql: string, pattern: RegExp) {
  const client=await pool.connect();
  try { await assert.rejects(client.query(sql),pattern); await client.query('rollback'); } finally { client.release(); }
}

before(async () => {
  // Require a pristine disposable database. Never truncate an existing schema.
  const tables=await query("select tablename from pg_tables where schemaname='public'");
  assert.equal(tables.rows.length,0,'Integration suite requires a fresh disposable database.');
  await query(await readFile(new URL('../../db/schema.sql',import.meta.url),'utf8'));
  await query('insert into users (id,email,display_name) values ($1,$2,$2),($3,$4,$4)',[owner,'owner@example.invalid',other,'other@example.invalid']);
  await query('insert into decks (id,owner_id,name,summary) values ($1,$2,$3,$4)',[legacyDeck,owner,'Legacy','{"startRateFirst":1}']);
  await query('insert into combo_pairs (id,owner_id,card_a_id,card_b_id,note) values ($1,$2,1,2,$3)',[legacyPair,owner,'Keep until purge']);
  await query('insert into deck_pair_exclusions values ($1,$2)',[legacyDeck,legacyPair]);
  await query('insert into deck_start_requirements (deck_id,source_card_id,required_card_id,min_in_deck) values ($1,1,3,1)',[legacyDeck]);
  await query('insert into deck_start_requirements (deck_id,source_pair_id,required_card_id,min_in_deck) values ($1,$2,4,1)',[legacyDeck,legacyPair]);
  await query('insert into card_flags (owner_id,card_id,is_hopt,dead_first) values ($1,1,true,true)',[owner]);
  await query('alter table decks alter column owner_id drop not null');
  await query('update decks set owner_id=null where id=$1',[legacyDeck]);
  await rejects(migration,/Adopt legacy ownerless/);
  await query('update decks set owner_id=$2 where id=$1',[legacyDeck,owner]);
  await query('alter table decks alter column owner_id set not null');
  // A malformed legacy condition must abort the WHOLE migration, including DDL.
  await query('update deck_start_requirements set min_in_deck=0 where source_card_id is not null');
  await rejects(migration,/Invalid legacy card requirement/);
  assert.equal((await query("select to_regclass('deck_requirements') as name")).rows[0].name,null);
  await query('update deck_start_requirements set min_in_deck=1 where source_card_id is not null');
  await query(migration);

  // ─── Étape 5B : données de l'ère v2, puis migration 002 (rollback, application, rejeu) ───
  await query('insert into decks (id,owner_id,name,summary,params) values ($1,$2,$3,$4,$5)',[v2Deck,owner,'V2','{"brickRate":0.1}','{"horizonFirst":2,"horizonSecond":3,"importance":0.5}']);
  await query('insert into deck_cards (deck_id,card_id,zone,copies) values ($1,1,$2,3),($1,2,$2,3),($1,3,$2,1),($1,4,$2,2),($1,5,$2,1)',[v2Deck,'main']);
  await query('insert into deck_starters (deck_id,card_id) values ($1,1)',[v2Deck]);
  await query('insert into deck_combo_pairs (deck_id,id,card_a_id,card_b_id) values ($1,$2,1,2)',[v2Deck,v2Pair]);
  await query('insert into deck_requirements (deck_id,id,source_card_id,source_pair_id,required_card_id,min_in_deck) values ($1,$2,1,null,4,2),($1,$3,1,null,3,1),($1,$4,null,$5,5,1)',[v2Deck,reqB,reqA,reqC,v2Pair]);
  await query('insert into nonengine_categories (owner_id,name,relevance) values ($1,$2,$3)',[owner,'Handtrap','first']);
  // 002 exige 001 : journal absent → refus, sans effet.
  await query("delete from app_migrations where id='001-deck-configuration'");
  await rejects(migration2,/Apply 001-deck-configuration/);
  await query("insert into app_migrations (id) values ('001-deck-configuration')");
  // Une ligne v2 invalide (contrainte retirée pour l'injection) annule TOUT, DDL compris.
  await query('alter table deck_requirements drop constraint deck_requirements_min_in_deck_check');
  await query('update deck_requirements set min_in_deck=0 where id=$1',[reqC]);
  await rejects(migration2,/Invalid v2 requirement/);
  assert.equal((await query("select to_regclass('deck_conditions') as name")).rows[0].name,null);
  assert.equal((await query("select to_regclass('nonengine_groups') as name")).rows[0].name,null);
  assert.equal((await query("select count(*)::int as n from information_schema.columns where table_name='card_flags' and column_name in ('availability','group_id')")).rows[0].n,0);
  assert.equal((await query("select count(*)::int as n from app_migrations where id='002-profiles-and-conditions'")).rows[0].n,0);
  assert.equal((await query('select params from decks where id=$1',[v2Deck])).rows[0].params.horizonFirst,2);
  await query('update deck_requirements set min_in_deck=1 where id=$1',[reqC]);
  await query('alter table deck_requirements add constraint deck_requirements_min_in_deck_check check (min_in_deck >= 1)');
  await query(migration2);
  // Étape 10 : additive, indépendante de 003, appliquée deux fois — le rejeu est sans effet.
  await query(migration4);
  await query(migration4);
  assert.equal((await query("select count(*)::int as n from app_migrations where id='004-side-plans'")).rows[0].n,1);
  await app.ready();
});
after(async () => { await app.close();await pool.end(); });
async function create(configuration: Configuration, user?: 'other') {
  const r=await app.inject({ method:'POST',url:'/decks',payload:configuration,headers:user ? { 'x-test-owner':user } : {} });
  assert.equal(r.statusCode,201,r.body);return r.json().id as string;
}
async function detail(id: string) { const r=await app.inject({ method:'GET',url:`/decks/${id}` });assert.equal(r.statusCode,200,r.body);return r.json(); }
async function library(user?: 'other') { const r=await app.inject({ method:'GET',url:'/library',headers:user ? { 'x-test-owner':user } : {} });assert.equal(r.statusCode,200,r.body);return r.json(); }

test('additive migration preserves legacy records, copies card conditions only, and is idempotent',async () => {
  await query(migration);
  const d=await detail(legacyDeck);
  assert.equal(d.pairs.length,0);assert.equal(d.conditions.length,1);assert.equal(d.conditions[0].source_card_id,1);
  assert.deepEqual(d.deadFirst,[1]);assert.equal(d.summary,null);
  assert.equal((await query('select * from combo_pairs where id=$1',[legacyPair])).rowCount,1);
  assert.equal((await query('select * from deck_start_requirements where deck_id=$1',[legacyDeck])).rowCount,2);
  assert.equal((await query('select * from deck_pair_exclusions where deck_id=$1',[legacyDeck])).rowCount,1);
  assert.equal((await app.inject({ method:'POST',url:'/library/pairs',payload:{ card_a_id:1,card_b_id:2 } })).statusCode,410);
});

test('migration 002 converts flat requirements into one AND group per source, strips horizons, invalidates summaries, keeps v2 rows, and replays without effect',async () => {
  const d=await detail(v2Deck);
  assert.equal(d.summary,null);
  assert.deepEqual(d.params,{ importance:0.5 });
  assert.equal(d.conditions.length,2);
  const card=d.conditions.find((c: { source_card_id:number|null }) => c.source_card_id===1);
  const pair=d.conditions.find((c: { source_pair_id:string|null }) => c.source_pair_id===v2Pair);
  // Nommée par la première feuille (ordre des identifiants) ; feuilles dans le même ordre.
  assert.deepEqual(card,{ id:reqA,source_card_id:1,source_pair_id:null,condition:{ kind:'and',all:[leaf(3),leaf(4,2)] } });
  assert.deepEqual(pair,{ id:reqC,source_card_id:null,source_pair_id:v2Pair,condition:{ kind:'and',all:[leaf(5)] } });
  // Legacy deck: its single copied card requirement is converted too.
  assert.deepEqual((await detail(legacyDeck)).conditions[0].condition,{ kind:'and',all:[leaf(3)] });
  // Anciennes lignes conservées (aucun DELETE avant l'étape 8) ; plus jamais lues.
  assert.equal((await query('select count(*)::int as n from deck_requirements')).rows[0].n,4);
  assert.equal((await query("select count(*)::int as n from decks where summary is not null")).rows[0].n,0);
  const before=(await query('select count(*)::int as n from deck_conditions')).rows[0].n;
  await query(migration2);
  assert.equal((await query('select count(*)::int as n from deck_conditions')).rows[0].n,before);
  assert.equal((await query("select count(*)::int as n from app_migrations where id='002-profiles-and-conditions'")).rows[0].n,1);
  // Aucun profil ni plafond n'est créé par la migration (Q2, Q4).
  assert.equal((await query('select count(*)::int as n from nonengine_groups')).rows[0].n,0);
  assert.equal((await query('select count(*)::int as n from card_flags where availability is not null')).rows[0].n,0);
  // Q3 : une seule représentation — l'API refuse l'ancien format.
  const stale={ ...emptyConfiguration('Stale'),requirements:[] } as unknown as Configuration;
  const r=await app.inject({ method:'PUT',url:`/decks/${v2Deck}`,payload:{ configuration:stale,expectedRevision:d.revision } });
  assert.equal(r.statusCode,400);assert.match(r.json().message ?? r.json().error ?? r.body,/format antérieur/);
});

test('save, reload and duplicate preserve notes, dormant pairs, exclusions, ET/OU conditions and parameters',async () => {
  const c=emptyConfiguration('A',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'side',copies:1 }]);
  c.pairs=[{ id:randomUUID(),card_a_id:1,card_b_id:9,note:'Dormant',disabled:true }];
  c.conditions=[
    { id:randomUUID(),source_card_id:null,source_pair_id:c.pairs[0].id,condition:{ kind:'and',all:[leaf(3,2),{ kind:'or',any:[leaf(4),leaf(5)] }] } },
    { id:randomUUID(),source_card_id:1,source_pair_id:null,condition:{ kind:'or',any:[leaf(6),leaf(7,3)] } },
  ];
  c.starters=[1];c.deadSecond=[1];c.notes='Deck notes';c.params={ importance:0.5,savedQueries:[] };
  const id=await create(c);let d=await detail(id);
  assert.equal(d.pairs[0].id,c.pairs[0].id);
  assert.deepEqual([...d.conditions].sort((a: { id:string },b: { id:string }) => a.id.localeCompare(b.id)),[...c.conditions].sort((a,b) => a.id.localeCompare(b.id)));
  c.name='Changed';
  const saved=await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration:c,expectedRevision:d.revision } });
  assert.equal(saved.statusCode,200,saved.body);d=await detail(id);assert.equal(d.revision,2);assert.equal(d.name,'Changed');
  const dup=await app.inject({ method:'POST',url:`/decks/${id}/duplicate` });assert.equal(dup.statusCode,201,dup.body);
  const copy=await detail(dup.json().id);
  assert.notEqual(copy.pairs[0].id,c.pairs[0].id);
  const copiedPair=copy.conditions.find((r: { source_pair_id:string|null }) => r.source_pair_id!==null);
  assert.equal(copiedPair.source_pair_id,copy.pairs[0].id);assert.deepEqual(copiedPair.condition,c.conditions[0].condition);
  assert.ok(copy.conditions.every((r: { id:string }) => !c.conditions.some((o) => o.id===r.id)));
  assert.deepEqual(copy.cards,d.cards);assert.deepEqual(copy.params,d.params);assert.equal(copy.notes,c.notes);assert.deepEqual(copy.deadSecond,[1]);
  assert.deepEqual(copy.pair_exclusions,[copy.pairs[0].id]);
  const unrelated=await detail(await create(emptyConfiguration('Other deck')));assert.equal(unrelated.pairs.length,0);
  // Deux conditions sur la même source, ou un groupe vide : refusés avant toute écriture.
  const twice={ ...c,conditions:[c.conditions[1],{ ...c.conditions[1],id:randomUUID() }] };
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration:twice,expectedRevision:2 } })).statusCode,400);
  const empty={ ...c,conditions:[{ ...c.conditions[1],condition:{ kind:'and',all:[] } }] };
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration:empty,expectedRevision:2 } })).statusCode,400);
  assert.equal((await detail(id)).revision,2);
});

test('competing saves cannot overwrite a more recent revision',async () => {
  const c=emptyConfiguration('Concurrent');const id=await create(c);
  const results=await Promise.all(['First','Second'].map((name) => app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ expectedRevision:1,configuration:{ ...c,name } } })));
  assert.deepEqual(results.map((r) => r.statusCode).sort(),[200,409]);
  assert.equal((await detail(id)).revision,2);
});

test('a SQL failure after updating the deck rolls back every write',async () => {
  const c=emptyConfiguration('Before');const id=await create(c);const before=await detail(id);
  await query("create function reject_test_condition() returns trigger language plpgsql as $$ begin if NEW.condition->>'kind'='or' then raise exception 'injected test failure'; end if; return NEW; end $$; create trigger reject_test_condition before insert on deck_conditions for each row execute function reject_test_condition()");
  try {
    c.name='Must roll back';c.starters=[5];c.pairs=[{ id:randomUUID(),card_a_id:5,card_b_id:6,disabled:false }];
    c.conditions=[{ id:randomUUID(),source_card_id:null,source_pair_id:c.pairs[0].id,condition:{ kind:'or',any:[leaf(999),leaf(998)] } }];
    const r=await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ expectedRevision:1,configuration:c } });
    assert.equal(r.statusCode,500);assert.deepEqual(await detail(id),before);
  } finally { await query('drop trigger reject_test_condition on deck_conditions; drop function reject_test_condition()'); }
});

test('owner isolation and malformed source references reject without partial writes',async () => {
  const id=await create(emptyConfiguration('Private'),'other');
  assert.equal((await app.inject({ method:'GET',url:`/decks/${id}` })).statusCode,404);
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ expectedRevision:1,configuration:emptyConfiguration('Attack') } })).statusCode,404);
  assert.equal((await app.inject({ method:'POST',url:`/decks/${id}/duplicate` })).statusCode,404);
  const c=emptyConfiguration('Bad source');c.conditions=[{ id:randomUUID(),source_card_id:null,source_pair_id:legacyPair,condition:leaf(1) }];
  assert.equal((await app.inject({ method:'POST',url:'/decks',payload:c })).statusCode,400);
});

test('profiles and shared caps are account annotations: label before profile (Q1), profile before cap (Q2), cross-account caps rejected',async () => {
  const uncategorised=await app.inject({ method:'PUT',url:'/library/flags/300',payload:{ availability:'flexible' } });
  assert.equal(uncategorised.statusCode,400,uncategorised.body);assert.match(uncategorised.body,/catégorie/);
  const cat=(await app.inject({ method:'POST',url:'/library/categories',payload:{ name:'Étiquette 5B' } })).json();
  assert.equal(cat.name,'Étiquette 5B');assert.equal(cat.relevance,undefined);
  assert.equal((await app.inject({ method:'POST',url:'/library/card-categories',payload:{ card_id:300,category_id:cat.id } })).statusCode,201);
  const group=await app.inject({ method:'POST',url:'/library/groups',payload:{ name:'Mulcharmy',cap_per_turn:2 } });
  assert.equal(group.statusCode,201,group.body);const gid=group.json().id as string;
  assert.equal((await app.inject({ method:'POST',url:'/library/groups',payload:{ name:'Mulcharmy',cap_per_turn:3 } })).statusCode,400);
  assert.equal((await app.inject({ method:'POST',url:'/library/groups',payload:{ name:'Zero',cap_per_turn:0 } })).statusCode,400);
  // Q2 : plafond sans profil — refusé par la contrainte SQL, relayé en 400.
  const early=await app.inject({ method:'PUT',url:'/library/flags/300',payload:{ group_id:gid } });
  assert.equal(early.statusCode,400,early.body);assert.match(early.body,/profil/);
  assert.equal((await app.inject({ method:'PUT',url:'/library/flags/300',payload:{ availability:'sometimes' } })).statusCode,400);
  const profiled=await app.inject({ method:'PUT',url:'/library/flags/300',payload:{ availability:'early',group_id:gid } });
  assert.equal(profiled.statusCode,200,profiled.body);assert.deepEqual(profiled.json(),{ ok:true,card_id:300,is_hopt:false,availability:'early',group_id:gid });
  // HOPT reste indépendant et conservé lors d'une mise à jour partielle.
  await app.inject({ method:'PUT',url:'/library/flags/300',payload:{ is_hopt:true } });
  const lib=await library();
  assert.ok(lib.hoptCardIds.includes(300));
  assert.deepEqual(lib.profiles.find((p: { card_id:number }) => p.card_id===300),{ card_id:300,availability:'early',group_id:gid });
  assert.deepEqual(lib.groups,[{ id:gid,name:'Mulcharmy',cap_per_turn:2 }]);
  assert.equal(lib.categories.find((c: { id:string }) => c.id===cat.id).relevance,undefined);
  // Autre compte : plafond invisible et inutilisable.
  assert.equal((await library('other')).groups.length,0);
  assert.equal((await app.inject({ method:'PUT',url:'/library/flags/300',headers:{ 'x-test-owner':'other' },payload:{ availability:'early',group_id:gid } })).statusCode,404); // plafond d'un autre compte : introuvable
  assert.equal((await app.inject({ method:'PATCH',url:`/library/groups/${gid}`,headers:{ 'x-test-owner':'other' },payload:{ cap_per_turn:5 } })).statusCode,404);
  assert.equal((await app.inject({ method:'PATCH',url:`/library/groups/${gid}`,payload:{ cap_per_turn:3 } })).json().cap_per_turn,3);
  // Retirer le profil retire aussi le plafond (un plafond exige un profil) ; supprimer le plafond garde le profil.
  assert.deepEqual((await app.inject({ method:'PUT',url:'/library/flags/300',payload:{ availability:null } })).json(),{ ok:true,card_id:300,is_hopt:true,availability:null,group_id:null });
  await app.inject({ method:'PUT',url:'/library/flags/300',payload:{ availability:'flexible',group_id:gid } });
  assert.equal((await app.inject({ method:'DELETE',url:`/library/groups/${gid}` })).statusCode,200);
  assert.deepEqual((await library()).profiles.find((p: { card_id:number }) => p.card_id===300),{ card_id:300,availability:'flexible',group_id:null });
});

test('a shared cap sent alone to an already profiled card is accepted (étape 6B : CHECK evaluated before ON CONFLICT)',async () => {
  const cat=(await app.inject({ method:'POST',url:'/library/categories',payload:{ name:'Étiquette 6B' } })).json();
  assert.equal((await app.inject({ method:'POST',url:'/library/card-categories',payload:{ card_id:301,category_id:cat.id } })).statusCode,201);
  const gid=(await app.inject({ method:'POST',url:'/library/groups',payload:{ name:'Plafond 6B',cap_per_turn:2 } })).json().id as string;
  assert.equal((await app.inject({ method:'PUT',url:'/library/flags/301',payload:{ availability:'early' } })).statusCode,200);
  // Le menu ⋯ n'envoie que `group_id` : constaté 400 à l'écran avant correction.
  const capOnly=await app.inject({ method:'PUT',url:'/library/flags/301',payload:{ group_id:gid } });
  assert.equal(capOnly.statusCode,200,capOnly.body);assert.deepEqual(capOnly.json(),{ ok:true,card_id:301,is_hopt:false,availability:'early',group_id:gid });
  // Retirer le plafond seul garde le profil ; un plafond avec profil explicitement nul reste refusé.
  assert.deepEqual((await app.inject({ method:'PUT',url:'/library/flags/301',payload:{ group_id:null } })).json(),{ ok:true,card_id:301,is_hopt:false,availability:'early',group_id:null });
  const nullProfile=await app.inject({ method:'PUT',url:'/library/flags/301',payload:{ availability:null,group_id:gid } });
  assert.equal(nullProfile.statusCode,400,nullProfile.body);assert.match(nullProfile.body,/profil/);
  assert.equal((await app.inject({ method:'DELETE',url:`/library/groups/${gid}` })).statusCode,200);
});

test('every global change invalidates the cached summaries of the decks concerned',async () => {
  const withCard=await create(emptyConfiguration('With 400',[{ card_id:400,zone:'main',copies:1 }]));
  const without=await create(emptyConfiguration('Without 400'));
  const cat=(await app.inject({ method:'POST',url:'/library/categories',payload:{ name:'Invalidation' } })).json();
  await app.inject({ method:'POST',url:'/library/card-categories',payload:{ card_id:400,category_id:cat.id } });
  const seed=async () => query("update decks set summary='{\"cached\":true}' where id in ($1,$2)",[withCard,without]);
  const summaries=async () => (await query('select id,summary from decks where id in ($1,$2) order by id=$1 desc',[withCard,without])).rows.map((r) => r.summary!==null);
  // Changement lié à une carte : seuls les decks qui la contiennent.
  await seed();await app.inject({ method:'PUT',url:'/library/flags/400',payload:{ availability:'breaker' } });
  assert.deepEqual(await summaries(),[false,true]);
  await seed();await app.inject({ method:'PUT',url:'/library/flags/400',payload:{ is_hopt:true } });
  assert.deepEqual(await summaries(),[false,true]);
  await seed();await app.inject({ method:'DELETE',url:`/library/card-categories/400/${cat.id}` });
  assert.deepEqual(await summaries(),[false,true]);
  // Changement sans carte (catégorie, plafond) : tous les decks du compte.
  await seed();await app.inject({ method:'DELETE',url:`/library/categories/${cat.id}` });
  assert.deepEqual(await summaries(),[false,false]);
  const group=(await app.inject({ method:'POST',url:'/library/groups',payload:{ name:'Invalidation',cap_per_turn:1 } })).json();
  await seed();await app.inject({ method:'PATCH',url:`/library/groups/${group.id}`,payload:{ cap_per_turn:2 } });
  assert.deepEqual(await summaries(),[false,false]);
  await app.inject({ method:'DELETE',url:`/library/groups/${group.id}` });
  // Un autre compte n'est jamais touché.
  const foreign=await create(emptyConfiguration('Foreign'),'other');
  await query("update decks set summary='{\"cached\":true}' where id=$1",[foreign]);
  await app.inject({ method:'PUT',url:'/library/flags/400',payload:{ is_hopt:false } });
  assert.notEqual((await query('select summary from decks where id=$1',[foreign])).rows[0].summary,null);
});

test('JSON import atomically merges global annotations (profiles and caps included) and remaps all category references',async () => {
  const configuration=emptyConfiguration('Imported');
  configuration.params={ statsView:'portable',savedQueries:[{ id:'q',name:'Q',criteria:[{ id:'c',subject:{ kind:'category',categoryId:'portable' },min:1,max:null }] }] };
  const archive={ format:'ygo-proba-deck',version:2,configuration,library:{ hoptCardIds:[42],categories:[{ id:'portable',name:'Imported category' }],cardCategories:[{ card_id:42,category_id:'portable' }],
    groups:[{ id:'gp',name:'Imported cap',cap_per_turn:2 }],profiles:[{ card_id:42,availability:'flexible',group_id:'gp' }] } };
  const result=await app.inject({ method:'POST',url:'/decks/import',payload:archive });assert.equal(result.statusCode,201,result.body);
  const d=await detail(result.json().id);const lib=await library();
  const cat=lib.categories.find((c: { name:string }) => c.name==='Imported category');
  const group=lib.groups.find((g: { name:string }) => g.name==='Imported cap');
  assert.equal(d.params.statsView,cat.id);assert.equal(d.params.savedQueries[0].criteria[0].subject.categoryId,cat.id);
  assert.ok(lib.hoptCardIds.includes(42));assert.ok(lib.cardCategories.some((cc: { card_id:number;category_id:string }) => cc.card_id===42 && cc.category_id===cat.id));
  assert.deepEqual(lib.profiles.find((p: { card_id:number }) => p.card_id===42),{ card_id:42,availability:'flexible',group_id:group.id });
  const otherLib=await library('other');assert.equal(otherLib.categories.length,0);
  const decksBefore=(await query('select count(*)::int as n from decks')).rows[0].n;
  // Conflit explicite (profil contradictoire) : aucun deck créé, aucune catégorie ajoutée.
  archive.library.categories.unshift({ id:'new',name:'Rollback category' });
  archive.library.profiles[0].availability='early';
  const rejected=await app.inject({ method:'POST',url:'/decks/import',payload:archive });assert.equal(rejected.statusCode,409,rejected.body);
  assert.equal((await query("select * from nonengine_categories where name='Rollback category'")).rowCount,0);
  assert.equal((await query('select count(*)::int as n from decks')).rows[0].n,decksBefore);
  // Plafond de même nom avec une autre limite : conflit aussi.
  archive.library.profiles[0].availability='flexible';archive.library.groups[0].cap_per_turn=3;
  assert.equal((await app.inject({ method:'POST',url:'/decks/import',payload:archive })).statusCode,409);
  assert.equal((await query('select count(*)::int as n from decks')).rows[0].n,decksBefore);
});

test('global annotations persist across decks while cross-account category writes are rejected',async () => {
  const id=randomUUID();
  const cat=await app.inject({ method:'POST',url:'/library/categories',payload:{ id,name:'Manual' } });
  assert.equal(cat.statusCode,201,cat.body);assert.equal(cat.json().id,id);
  const assigned=await app.inject({ method:'POST',url:'/library/card-categories',payload:{ card_id:100,category_id:id } });assert.equal(assigned.statusCode,201,assigned.body);
  const hopt=await app.inject({ method:'PUT',url:'/library/flags/100',payload:{ is_hopt:true } });assert.equal(hopt.statusCode,200,hopt.body);
  const forbidden=await app.inject({ method:'POST',url:'/library/card-categories',headers:{ 'x-test-owner':'other' },payload:{ card_id:100,category_id:id } });assert.equal(forbidden.statusCode,404);
  const lib=await library();assert.ok(lib.hoptCardIds.includes(100));
  assert.ok(lib.cardCategories.some((cc: { card_id:number }) => cc.card_id===100));
  assert.equal((await app.inject({ method:'PUT',url:'/library/flags/100',payload:{ dead_first:true } })).statusCode,400);
  assert.equal((await app.inject({ method:'DELETE',url:'/library/card-categories/100/'+id })).statusCode,200);
  assert.equal((await app.inject({ method:'DELETE',url:'/library/categories/'+id })).statusCode,200);
});

// ─── Étape 9, point 1 : aperçu (decks.summary) — cache d'affichage, jamais une source de vérité ───
test('a summary is stored only with the configuration it describes or for the current revision, and every write invalidates it',async () => {
  const summary=(mainSize: number, version='0123456789abcdef') => ({ engineVersion:version,mainSize,startRateFirst:0.7,brickRate:0.3,computedAt:'2026-09-09T10:00:00.000Z' });
  const id=await create(emptyConfiguration('Preview',[{ card_id:501,zone:'main',copies:3 },{ card_id:502,zone:'main',copies:2 }]));
  const list=async () => (await app.inject({ method:'GET',url:'/decks' })).json().find((d: { id:string }) => d.id===id);
  const configuration=emptyConfiguration('Preview',[{ card_id:501,zone:'main',copies:3 },{ card_id:502,zone:'main',copies:2 },{ card_id:503,zone:'side',copies:1 }]);
  // Création : aucun résumé. Enregistrement avec un résumé d'une autre taille : refusé, rien d'écrit.
  assert.equal((await list()).summary,null);
  const wrongSize=await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration,expectedRevision:1,summary:summary(6) } });
  assert.equal(wrongSize.statusCode,400,wrongSize.body);assert.match(wrongSize.json().message ?? wrongSize.body,/calculé pour 6 cartes, main deck de 5/);
  assert.equal((await detail(id)).revision,1);
  // Enregistrement avec un résumé conforme (le side ne compte pas) : écrit dans la même transaction.
  const saved=await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration,expectedRevision:1,summary:summary(5) } });
  assert.equal(saved.statusCode,200,saved.body);
  assert.deepEqual((await list()).summary,summary(5));
  assert.equal((await detail(id)).summary,null); // le détail n'en a pas l'usage (Q8)
  // Enregistrement sans résumé : le cache est effacé (recalculé à l'accueil).
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration,expectedRevision:2 } })).statusCode,200);
  assert.equal((await list()).summary,null);
  // Recalcul à l'accueil : refusé pour une révision qui n'est plus la courante (409), pour une
  // taille qui n'est pas celle enregistrée (400), pour un résumé malformé (400) ; accepté sinon,
  // sans changer la révision ni updated_at.
  const before=await detail(id);
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}/summary`,payload:{ summary:summary(5),expectedRevision:2 } })).statusCode,409);
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}/summary`,payload:{ summary:summary(4),expectedRevision:3 } })).statusCode,400);
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}/summary`,payload:{ summary:{ startRateFirst:1 },expectedRevision:3 } })).statusCode,400);
  assert.equal((await list()).summary,null);
  const put=await app.inject({ method:'PUT',url:`/decks/${id}/summary`,payload:{ summary:summary(5,'fedcba9876543210'),expectedRevision:3 } });
  assert.equal(put.statusCode,200,put.body);assert.equal(put.json().revision,3);
  assert.deepEqual((await list()).summary,summary(5,'fedcba9876543210'));
  const after=await detail(id);assert.equal(after.revision,3);assert.equal(after.updated_at,before.updated_at);
  // Un autre compte ne peut ni lire ni écrire ce résumé (404, jamais 403).
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}/summary`,headers:{ 'x-test-owner':'other' },payload:{ summary:summary(5),expectedRevision:3 } })).statusCode,404);
  // Une écriture de bibliothèque touchant une carte du deck l'invalide (règle existante).
  assert.equal((await app.inject({ method:'PUT',url:'/library/flags/501',payload:{ is_hopt:true } })).statusCode,200);
  assert.equal((await list()).summary,null);
  await app.inject({ method:'PUT',url:'/library/flags/501',payload:{ is_hopt:false } });
});

// ─── Étape 10 : adversaires et plans de side ───
test('side plans are saved, ordered, reloaded and duplicated; a matchup keeps its row so a plan summary survives an unrelated save',async () => {
  const mA=randomUUID(),mB=randomUUID();
  const first={ position:'first' as const,note:null,outgoing:[{ card_id:1,copies:1 }],incoming:[{ card_id:2,copies:1 }] };
  const second={ position:'second' as const,note:'Garder Nibiru',outgoing:[{ card_id:1,copies:2 }],incoming:[{ card_id:2,copies:2 }] };
  const kewl={ id:mA,name:'Kewl Tune',sort_index:0,plans:[first,second] };
  const snake={ id:mB,name:'Snake-Eye',sort_index:1,plans:[] };
  const c=emptyConfiguration('Plans',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'side',copies:2 }]);
  c.matchups=[snake,kewl]; // ordre d'émission indifférent : l'ordre rendu est celui de sort_index
  const id=await create(c);
  let d=await detail(id);
  assert.deepEqual(d.matchups.map((m: { id:string }) => m.id),[mA,mB]);
  assert.deepEqual(d.matchups[0].plans,[first,second]);
  assert.deepEqual(d.matchups[1],snake);

  // Cache d'aperçu d'un plan (étape 10B), écrit hors API : il doit SURVIVRE à un enregistrement
  // qui ne concerne pas ce plan. C'est ce que garantit la stabilité des lignes (identifiants du
  // client, upsert), et non un remplacement en bloc comme pour les cartes ou les starters.
  await query('update deck_side_plans set summary=$4::jsonb where deck_id=$1 and matchup_id=$2 and position=$3',[id,mA,'second',JSON.stringify({ engineVersion:'x' })]);
  c.name='Plans (renommé)';
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration:c,expectedRevision:d.revision } })).statusCode,200);
  assert.equal((await query("select summary->>'engineVersion' as v from deck_side_plans where deck_id=$1 and matchup_id=$2 and position='second'",[id,mA])).rows[0].v,'x');

  // Retrait d'un adversaire et d'un volet : les lignes concernées disparaissent (cache compris),
  // les autres restent en place.
  c.matchups=[{ ...kewl,name:'Kewl Tune (2026)',plans:[second] }];
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration:c,expectedRevision:2 } })).statusCode,200);
  d=await detail(id);
  assert.deepEqual(d.matchups,[{ id:mA,name:'Kewl Tune (2026)',sort_index:0,plans:[second] }]);
  assert.equal((await query('select count(*)::int as n from deck_side_plans where deck_id=$1',[id])).rows[0].n,1);
  assert.equal((await query('select count(*)::int as n from deck_side_plan_cards where deck_id=$1',[id])).rows[0].n,2);

  // Duplication : adversaires d'identité neuve, plans copiés à l'identique, aucun cache repris.
  const dup=await app.inject({ method:'POST',url:`/decks/${id}/duplicate` });
  assert.equal(dup.statusCode,201,dup.body);
  const copy=await detail(dup.json().id);
  assert.notEqual(copy.matchups[0].id,mA);
  assert.equal(copy.matchups[0].name,'Kewl Tune (2026)');
  assert.deepEqual(copy.matchups[0].plans,[second]);
  assert.equal((await query('select count(*)::int as n from deck_side_plans where deck_id=$1 and summary is not null',[dup.json().id])).rows[0].n,0);

  // Structure refusée = rien d'écrit (le contrat s'applique avant la transaction).
  const twice={ ...c,matchups:[{ ...c.matchups[0],plans:[second,{ ...second,note:'doublon' }] }] };
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration:twice,expectedRevision:3 } })).statusCode,400);
  assert.equal((await detail(id)).revision,3);

  // Suppression du deck : adversaires, plans et cartes de plan tombent avec lui (cascade).
  assert.equal((await app.inject({ method:'DELETE',url:`/decks/${id}` })).statusCode,200);
  assert.equal((await query('select count(*)::int as n from deck_matchups where deck_id=$1',[id])).rows[0].n,0);
  assert.equal((await query('select count(*)::int as n from deck_side_plan_cards where deck_id=$1',[id])).rows[0].n,0);
});
