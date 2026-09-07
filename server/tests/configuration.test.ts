import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyConfiguration, parseConfiguration, upgradeConfiguration, validateCondition, type ConditionNode } from '../src/domain/deckConfiguration.js';
import { parseArchive, remapCategoryReferences } from '../src/domain/deckArchive.js';

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
