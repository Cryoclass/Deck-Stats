import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyConfiguration, MATCHUPS_MAX, parseConfiguration, upgradeConfiguration, validateCondition, type Configuration, type ConditionNode } from '../src/domain/deckConfiguration.js';
import { parseArchive, remapCategoryReferences } from '../src/domain/deckArchive.js';
import { parseCardIdList } from '../src/domain/cardIds.js';

test('catalogue lookup ids are strict positive integers, never coerced (étape 6, C5)', () => {
  assert.deepEqual(parseCardIdList('14558127, 27204311,1'),[14558127,27204311,1]);
  assert.deepEqual(parseCardIdList('7,7'),[7]);
  for (const bad of ['1e3','0x10','12.5','-5','0','','1,,2','abc','1 2','9007199254740993']) assert.equal(parseCardIdList(bad),null,bad);
});

const leaf=(card_id: number, at_least=1): ConditionNode => ({ kind:'remaining',card_id,at_least });
const CID='00000000-0000-4000-8000-000000000001';
const PID='00000000-0000-4000-8000-000000000002';

test('empty or incomplete decks are valid, quantities and zones are not silently clamped', () => {
  assert.equal(parseConfiguration(emptyConfiguration('Empty')).cards.length,0);
  for (const copies of [-1,0,1.5,4,NaN]) assert.throws(() => parseConfiguration(emptyConfiguration('Bad',[{ card_id: 1,zone: 'main',copies }])));
  const c=emptyConfiguration('Duplicates',[{ card_id: 1,zone: 'main',copies: 1 },{ card_id: 1,zone: 'main',copies: 2 }]);
  assert.throws(() => parseConfiguration(c));
  c.cards[1].zone='side';assert.equal(parseConfiguration(c).cards.length,2);
});
test('a condition must reference a local source, once per source; unsupported versions are rejected', () => {
  const c=emptyConfiguration('X');
  c.conditions=[{ id:CID,source_card_id:null,source_pair_id:PID,condition:{ kind:'and',all:[leaf(1)] } }];
  assert.throws(() => parseConfiguration(c));
  c.conditions[0].source_pair_id=null;c.conditions[0].source_card_id=2;
  assert.equal(parseConfiguration(c).conditions.length,1);
  c.conditions.push({ id:PID,source_card_id:2,source_pair_id:null,condition:leaf(3) });
  assert.throws(() => parseConfiguration(c),/une seule condition/);
  assert.throws(() => parseConfiguration({ ...c,version:3 }));
  assert.throws(() => parseArchive({ format:'ygo-proba-deck',version:1 }));
});
test('condition trees: unknown operator, empty group, invalid quantity or depth are rejected; nothing becomes true by default', () => {
  const valid: ConditionNode={ kind:'and',all:[leaf(1),{ kind:'or',any:[leaf(2),leaf(3,2)] }] };
  validateCondition(valid);
  for (const bad of [
    { kind:'and',all:[] },{ kind:'or',any:[] },{ kind:'unless',card_id:1 },{ kind:'remaining',card_id:1,at_least:0 },
    { kind:'remaining',card_id:0,at_least:1 },{ kind:'remaining',card_id:1,at_least:1.5 },{ kind:'and',all:[leaf(1)],extra:true },null,'x',
    { kind:'and',all:[{ kind:'or',any:[{ kind:'and',all:[{ kind:'or',any:[{ kind:'and',all:[{ kind:'or',any:[{ kind:'and',all:[{ kind:'or',any:[leaf(1)] }] }] }] }] }] }] }] },
  ]) assert.throws(() => validateCondition(bad),JSON.stringify(bad));
  const c=emptyConfiguration('X');
  c.conditions=[{ id:CID,source_card_id:1,source_pair_id:null,condition:{ kind:'and',all:[] } }];
  assert.throws(() => parseConfiguration(c),/vide/);
});
test('the API refuses the pre-5B flat requirements; archives and drafts are upgraded by the exact migration rule', () => {
  const legacy: Record<string,unknown>={ ...emptyConfiguration('Old'),params:{ horizonFirst:2,horizonSecond:3,importance:0.4 },
    requirements:[
      { id:PID,source_card_id:1,source_pair_id:null,required_card_id:3,min_in_deck:1 },
      { id:CID,source_card_id:1,source_pair_id:null,required_card_id:2,min_in_deck:2 },
    ] };
  delete legacy.conditions;
  assert.throws(() => parseConfiguration(legacy),/format antérieur/);
  const upgraded=parseConfiguration(upgradeConfiguration(legacy));
  assert.deepEqual(upgraded.conditions,[{ id:CID,source_card_id:1,source_pair_id:null,condition:{ kind:'and',all:[leaf(2,2),leaf(3)] } }]);
  assert.deepEqual(upgraded.params,{ importance:0.4 });
  // Déjà à jour : rendu tel quel (horizons retirés seulement).
  const fresh=emptyConfiguration('New');fresh.params={ horizonFirst:1 };
  assert.deepEqual(parseConfiguration(upgradeConfiguration(fresh)).params,{});
  assert.throws(() => parseConfiguration(fresh),/Paramètre non pris en charge/);
});
test('query and view category references are remapped without changing their criteria', () => {
  const params={ statsView:'old',savedQueries:[{ id:'q',name:'Any',criteria:[{ id:'c',subject:{ kind:'group',categoryIds:['old'] },min:1,max:null }] }] };
  const mapped=remapCategoryReferences(params,new Map([['old','new']]));
  assert.equal(mapped.statsView,'new');assert.equal(params.statsView,'old');
  assert.match(JSON.stringify(mapped),/"categoryIds":\["new"\]/);
  assert.throws(() => remapCategoryReferences(params,new Map()));
  assert.throws(() => parseConfiguration({ ...emptyConfiguration('Bad'),params:{ savedQueries:[{ ...params.savedQueries[0],criteria:[{ id:'c',subject:{ kind:'unknown' },min:null,max:null }] }] } }));
});
test('archives validate the entire payload before any persistence, profiles and caps included', () => {
  const configuration=emptyConfiguration('X');
  const library={ hoptCardIds:[],categories:[],cardCategories:[],profiles:[],groups:[] };
  assert.throws(() => parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ ...library,cardCategories:[{ card_id:1,category_id:'missing' }] } }));
  assert.throws(() => parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ ...library,profiles:[{ card_id:1,availability:'sometimes',group_id:null }] } }),/Profil/);
  assert.throws(() => parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ ...library,profiles:[{ card_id:1,availability:'early',group_id:'missing' }] } }),/Profil/);
  assert.throws(() => parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ ...library,groups:[{ id:'g',name:'G',cap_per_turn:0 }] } }),/Plafond/);
  const ok=parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ ...library,categories:[{ id:'c',name:'Old',relevance:'first' }],groups:[{ id:'g',name:'G',cap_per_turn:2 }],profiles:[{ card_id:1,availability:'early',group_id:'g' }] } });
  assert.equal(ok.configuration.name,'X');
  assert.deepEqual(ok.library.categories,[{ id:'c',name:'Old' }]);
  assert.deepEqual(ok.library.profiles,[{ card_id:1,availability:'early',group_id:'g' }]);
  // Archive antérieure sans profils ni plafonds : listes vides, jamais un profil deviné.
  assert.deepEqual(parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ hoptCardIds:[],categories:[],cardCategories:[] } }).library.profiles,[]);
});

// ─── Étape 9, point 1 : aperçu (cache d'affichage) validé par le serveur ───
test('a deck summary is validated strictly and must describe the saved main deck (étape 9)', async () => {
  const { parseSummary, checkSummaryMatches } = await import('../src/domain/deckSummary.js');
  const ok={ engineVersion:'0123456789abcdef',mainSize:40,startRateFirst:0.71,brickRate:0.29,computedAt:'2026-09-09T10:00:00.000Z' };
  assert.deepEqual(parseSummary(ok),ok);
  for (const bad of [null,[],'x',{ ...ok,extra:1 },{ ...ok,engineVersion:'' },{ ...ok,engineVersion:'a b' },{ ...ok,mainSize:40.5 },{ ...ok,mainSize:-1 },
    { ...ok,startRateFirst:1.01 },{ ...ok,brickRate:-0.1 },{ ...ok,brickRate:NaN },{ ...ok,computedAt:'hier' },{ ...ok,computedAt:12 }]) {
    assert.throws(() => parseSummary(bad),/Résumé invalide/,JSON.stringify(bad));
  }
  const { computedAt: _omitted, ...incomplete }=ok;
  assert.throws(() => parseSummary(incomplete),/Résumé invalide/);
  checkSummaryMatches(ok,40);
  assert.throws(() => checkSummaryMatches(ok,41),/calculé pour 40 cartes, main deck de 41/);
});

// ─── Étape 10 : adversaires et plans de side ───
const MID='00000000-0000-4000-8000-00000000000d';
/** Deck de référence : 3 copies de la carte 1 en main, 2 de la carte 2 en side, un plan second
 *  équilibré qui échange les deux. */
function withMatchup(): Configuration {
  const c=emptyConfiguration('Side',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'side',copies:2 }]);
  c.matchups=[{ id:MID,name:'  Kewl Tune  ',sort_index:0,plans:[
    { position:'second',note:'Attention au Droll',outgoing:[{ card_id:1,copies:2 }],incoming:[{ card_id:2,copies:2 }] },
  ] }];
  return c;
}

test('side plans: a document without matchups stays valid, names are trimmed, plans are kept verbatim (étape 10)', () => {
  const old: Record<string,unknown>={ ...emptyConfiguration('Old') };
  delete old.matchups;
  assert.deepEqual(parseConfiguration(old).matchups,[]);
  const parsed=parseConfiguration(withMatchup());
  assert.equal(parsed.matchups[0].name,'Kewl Tune');
  assert.deepEqual(parsed.matchups[0].plans[0].outgoing,[{ card_id:1,copies:2 }]);
  assert.equal(parsed.matchups[0].plans[0].note,'Attention au Droll');
  // Une note absente vaut `null`, jamais `undefined` (le document est canonique).
  const noNote=withMatchup();delete (noNote.matchups[0].plans[0] as { note?: unknown }).note;
  assert.equal(parseConfiguration(noNote).matchups[0].plans[0].note,null);
});

test('side plans: the contract validates STRUCTURE only — zone coherence and balance are the editor’s job (étape 10, R1/R4/R5)', () => {
  // Carte sortante absente du main : ACCEPTÉE. Refuser ici rendrait le deck non enregistrable
  // dès qu'une carte quitte sa zone, alors qu'un plan devenu incohérent doit être conservé et
  // signalé « à revoir » par l'éditeur.
  const absent=withMatchup();absent.matchups[0].plans[0].outgoing=[{ card_id:999,copies:1 }];
  assert.equal(parseConfiguration(absent).matchups[0].plans[0].outgoing[0].card_id,999);
  // Plan déséquilibré (2 sortent, 1 entre) : ACCEPTÉ, c'est l'état « incomplet » d'une retouche.
  const unbalanced=withMatchup();unbalanced.matchups[0].plans[0].incoming=[{ card_id:2,copies:1 }];
  assert.equal(parseConfiguration(unbalanced).matchups[0].plans[0].incoming[0].copies,1);
  // Une carte entrante absente du side, un plan vide, un adversaire sans plan : acceptés aussi.
  const emptyPlans=withMatchup();emptyPlans.matchups[0].plans=[];
  assert.deepEqual(parseConfiguration(emptyPlans).matchups[0].plans,[]);
});

test('side plans: structural refusals are named and nothing is silently clamped (étape 10)', () => {
  const bad=(mutate: (c: Configuration) => void, pattern?: RegExp) => {
    const c=withMatchup();mutate(c);
    assert.throws(() => parseConfiguration(c),pattern);
  };
  bad((c) => { c.matchups[0].id='pas-un-uuid'; });
  bad((c) => { c.matchups.push({ ...c.matchups[0],plans:[] }); },/dupliqué/);
  bad((c) => { c.matchups[0].name='   '; });
  bad((c) => { c.matchups[0].name='x'.repeat(201); });
  for (const sortIndex of [-1,1.5,NaN]) bad((c) => { c.matchups[0].sort_index=sortIndex; });
  bad((c) => { c.matchups[0].plans.push({ ...c.matchups[0].plans[0] }); },/au plus un plan par position/);
  bad((c) => { (c.matchups[0].plans[0] as unknown as { position: string }).position='third'; });
  for (const copies of [0,4,1.5,NaN]) bad((c) => { c.matchups[0].plans[0].incoming[0].copies=copies; });
  for (const cardId of [0,-1,1.5]) bad((c) => { c.matchups[0].plans[0].incoming[0].card_id=cardId; });
  bad((c) => { c.matchups[0].plans[0].incoming.push({ card_id:2,copies:1 }); },/répétée/);
  bad((c) => { c.matchups[0].plans[0].incoming.push({ card_id:1,copies:1 }); },/entrer et sortir/);
  bad((c) => { (c.matchups[0] as unknown as Record<string,unknown>).archetype=true; });
  bad((c) => { (c.matchups[0].plans[0] as unknown as Record<string,unknown>).swaps=[]; });
  bad((c) => { c.matchups=Array.from({ length:MATCHUPS_MAX+1 },() => ({ ...c.matchups[0],id:crypto.randomUUID() })); },/Trop d/);
  // 32 adversaires exactement : la borne est de représentation, pas une règle métier.
  const full=withMatchup();
  full.matchups=Array.from({ length:MATCHUPS_MAX },() => ({ ...full.matchups[0],id:crypto.randomUUID() }));
  assert.equal(parseConfiguration(full).matchups.length,MATCHUPS_MAX);
});
