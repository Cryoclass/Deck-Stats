import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { emptyConfiguration, type Configuration } from '../src/domain/deckConfiguration.js';

// This suite never falls back to DATABASE_URL or the developer's .env database.
const url=new URL(process.env.TEST_DATABASE_URL ?? 'http://missing');
if (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/step23') throw new Error('Use the disposable step23 database on 127.0.0.1:55433 via TEST_DATABASE_URL.');
process.env.DATABASE_URL=url.toString();
const { pool, query }=await import('../src/db.js');
const { decksRoutes }=await import('../src/routes/decks.js');
const { libraryRoutes }=await import('../src/routes/library.js');
const app=Fastify();
const owner=randomUUID(),other=randomUUID(),legacyDeck=randomUUID(),legacyPair=randomUUID();
const migration=await readFile(new URL('../../db/migrations/001-deck-configuration.sql',import.meta.url),'utf8');
app.decorateRequest('user',null);
app.addHook('onRequest',async (req) => { req.user={ id: req.headers['x-test-owner'] === 'other' ? other : owner,email:'test@example.invalid',display_name:'Test' }; });
await app.register(decksRoutes,{ prefix:'/decks' });
await app.register(libraryRoutes,{ prefix:'/library' });

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
  const ownerClient=await pool.connect();
  try {
    await assert.rejects(ownerClient.query(migration),/Adopt legacy ownerless/);
    await ownerClient.query('rollback');
  } finally { ownerClient.release(); }
  await query('update decks set owner_id=$2 where id=$1',[legacyDeck,owner]);
  await query('alter table decks alter column owner_id set not null');
  // A malformed legacy condition must abort the WHOLE migration, including DDL.
  await query('update deck_start_requirements set min_in_deck=0 where source_card_id is not null');
  const migrationClient=await pool.connect();
  try {
    await assert.rejects(migrationClient.query(migration),/Invalid legacy card requirement/);
    await migrationClient.query('rollback');
  } finally { migrationClient.release(); }
  assert.equal((await query("select to_regclass('deck_requirements') as name")).rows[0].name,null);
  await query('update deck_start_requirements set min_in_deck=1 where source_card_id is not null');
  await query(migration);
  await app.ready();
});
after(async () => { await app.close();await pool.end(); });
async function create(configuration: Configuration, user?: 'other') {
  const r=await app.inject({ method:'POST',url:'/decks',payload:configuration,headers:user ? { 'x-test-owner':user } : {} });
  assert.equal(r.statusCode,201,r.body);return r.json().id as string;
}
async function detail(id: string) { const r=await app.inject({ method:'GET',url:`/decks/${id}` });assert.equal(r.statusCode,200,r.body);return r.json(); }

test('additive migration preserves legacy records, copies card conditions only, and is idempotent',async () => {
  await query(migration);
  const d=await detail(legacyDeck);
  assert.equal(d.pairs.length,0);assert.equal(d.start_requirements.length,1);assert.equal(d.start_requirements[0].source_card_id,1);
  assert.deepEqual(d.deadFirst,[1]);assert.equal(d.summary,null);
  assert.equal((await query('select * from combo_pairs where id=$1',[legacyPair])).rowCount,1);
  assert.equal((await query('select * from deck_start_requirements where deck_id=$1',[legacyDeck])).rowCount,2);
  assert.equal((await query('select * from deck_pair_exclusions where deck_id=$1',[legacyDeck])).rowCount,1);
  assert.equal((await app.inject({ method:'POST',url:'/library/pairs',payload:{ card_a_id:1,card_b_id:2 } })).statusCode,410);
});

test('save, reload and duplicate preserve notes, dormant pairs, exclusions, conditions and parameters',async () => {
  const c=emptyConfiguration('A',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'side',copies:1 }]);
  c.pairs=[{ id:randomUUID(),card_a_id:1,card_b_id:9,note:'Dormant',disabled:true }];
  c.requirements=[{ id:randomUUID(),source_card_id:null,source_pair_id:c.pairs[0].id,required_card_id:3,min_in_deck:2 }];
  c.starters=[1];c.deadSecond=[1];c.notes='Deck notes';c.params={ importance:0.5,savedQueries:[] };
  const id=await create(c);let d=await detail(id);
  assert.equal(d.pairs[0].id,c.pairs[0].id);assert.deepEqual(d.start_requirements,c.requirements);
  c.name='Changed';
  const saved=await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ configuration:c,expectedRevision:d.revision } });
  assert.equal(saved.statusCode,200,saved.body);d=await detail(id);assert.equal(d.revision,2);assert.equal(d.name,'Changed');
  const dup=await app.inject({ method:'POST',url:`/decks/${id}/duplicate` });assert.equal(dup.statusCode,201,dup.body);
  const copy=await detail(dup.json().id);
  assert.notEqual(copy.pairs[0].id,c.pairs[0].id);assert.equal(copy.start_requirements[0].source_pair_id,copy.pairs[0].id);
  assert.deepEqual(copy.cards,d.cards);assert.deepEqual(copy.params,d.params);assert.equal(copy.notes,c.notes);assert.deepEqual(copy.deadSecond,[1]);
  assert.deepEqual(copy.pair_exclusions,[copy.pairs[0].id]);
  const unrelated=await detail(await create(emptyConfiguration('Other deck')));assert.equal(unrelated.pairs.length,0);
});

test('competing saves cannot overwrite a more recent revision',async () => {
  const c=emptyConfiguration('Concurrent');const id=await create(c);
  const results=await Promise.all(['First','Second'].map((name) => app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ expectedRevision:1,configuration:{ ...c,name } } })));
  assert.deepEqual(results.map((r) => r.statusCode).sort(),[200,409]);
  assert.equal((await detail(id)).revision,2);
});

test('a SQL failure after updating the deck rolls back every write',async () => {
  const c=emptyConfiguration('Before');const id=await create(c);const before=await detail(id);
  await query("create function reject_test_requirement() returns trigger language plpgsql as $$ begin if NEW.required_card_id=999 then raise exception 'injected test failure'; end if; return NEW; end $$; create trigger reject_test_requirement before insert on deck_requirements for each row execute function reject_test_requirement()");
  try {
    c.name='Must roll back';c.starters=[5];c.pairs=[{ id:randomUUID(),card_a_id:5,card_b_id:6,disabled:false }];
    c.requirements=[{ id:randomUUID(),source_card_id:null,source_pair_id:c.pairs[0].id,required_card_id:999,min_in_deck:1 }];
    const r=await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ expectedRevision:1,configuration:c } });
    assert.equal(r.statusCode,500);assert.deepEqual(await detail(id),before);
  } finally { await query('drop trigger reject_test_requirement on deck_requirements; drop function reject_test_requirement()'); }
});

test('owner isolation and malformed source references reject without partial writes',async () => {
  const id=await create(emptyConfiguration('Private'),'other');
  assert.equal((await app.inject({ method:'GET',url:`/decks/${id}` })).statusCode,404);
  assert.equal((await app.inject({ method:'PUT',url:`/decks/${id}`,payload:{ expectedRevision:1,configuration:emptyConfiguration('Attack') } })).statusCode,404);
  assert.equal((await app.inject({ method:'POST',url:`/decks/${id}/duplicate` })).statusCode,404);
  const c=emptyConfiguration('Bad source');c.requirements=[{ id:randomUUID(),source_card_id:null,source_pair_id:legacyPair,required_card_id:1,min_in_deck:1 }];
  assert.equal((await app.inject({ method:'POST',url:'/decks',payload:c })).statusCode,400);
});

test('JSON import atomically merges global annotations and remaps all category references',async () => {
  const configuration=emptyConfiguration('Imported');
  configuration.params={ statsView:'portable',savedQueries:[{ id:'q',name:'Q',criteria:[{ id:'c',subject:{ kind:'category',categoryId:'portable' },min:1,max:null }] }] };
  const archive={ format:'ygo-proba-deck',version:2,configuration,library:{ hoptCardIds:[42],categories:[{ id:'portable',name:'Imported category',relevance:'both' }],cardCategories:[{ card_id:42,category_id:'portable' }] } };
  const result=await app.inject({ method:'POST',url:'/decks/import',payload:archive });assert.equal(result.statusCode,201,result.body);
  const d=await detail(result.json().id);const lib=(await app.inject({ method:'GET',url:'/library' })).json();
  const cat=lib.categories.find((c: { name:string }) => c.name==='Imported category');
  assert.equal(d.params.statsView,cat.id);assert.equal(d.params.savedQueries[0].criteria[0].subject.categoryId,cat.id);
  assert.ok(lib.hoptCardIds.includes(42));assert.ok(lib.cardCategories.some((cc: { card_id:number;category_id:string }) => cc.card_id===42 && cc.category_id===cat.id));
  const otherLib=(await app.inject({ method:'GET',url:'/library',headers:{ 'x-test-owner':'other' } })).json();assert.equal(otherLib.categories.length,0);
  const decksBefore=(await query('select count(*)::int as n from decks')).rows[0].n;
  archive.library.categories.unshift({ id:'new',name:'Rollback category',relevance:'both' });
  archive.library.categories[1].relevance='first';
  const rejected=await app.inject({ method:'POST',url:'/decks/import',payload:archive });assert.equal(rejected.statusCode,409,rejected.body);
  assert.equal((await query("select * from nonengine_categories where name='Rollback category'")).rowCount,0);
  assert.equal((await query('select count(*)::int as n from decks')).rows[0].n,decksBefore);
});

test('global annotations persist across decks while cross-account category writes are rejected',async () => {
  const id=randomUUID();
  const cat=await app.inject({ method:'POST',url:'/library/categories',payload:{ id,name:'Manual',relevance:'both' } });
  assert.equal(cat.statusCode,201,cat.body);assert.equal(cat.json().id,id);
  const assigned=await app.inject({ method:'POST',url:'/library/card-categories',payload:{ card_id:100,category_id:id } });assert.equal(assigned.statusCode,201,assigned.body);
  const hopt=await app.inject({ method:'PUT',url:'/library/flags/100',payload:{ is_hopt:true } });assert.equal(hopt.statusCode,200,hopt.body);
  const forbidden=await app.inject({ method:'POST',url:'/library/card-categories',headers:{ 'x-test-owner':'other' },payload:{ card_id:100,category_id:id } });assert.equal(forbidden.statusCode,404);
  const lib=(await app.inject({ method:'GET',url:'/library' })).json();assert.ok(lib.hoptCardIds.includes(100));
  assert.ok(lib.cardCategories.some((cc: { card_id:number }) => cc.card_id===100));
  assert.equal((await app.inject({ method:'PUT',url:'/library/flags/100',payload:{ dead_first:true } })).statusCode,400);
  assert.equal((await app.inject({ method:'DELETE',url:'/library/card-categories/100/'+id })).statusCode,200);
  assert.equal((await app.inject({ method:'DELETE',url:'/library/categories/'+id })).statusCode,200);
});
