import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyConfiguration, parseConfiguration } from '../src/domain/deckConfiguration.js';
import { parseArchive, remapCategoryReferences } from '../src/domain/deckArchive.js';

test('empty or incomplete decks are valid, quantities and zones are not silently clamped', () => {
  assert.equal(parseConfiguration(emptyConfiguration('Empty')).cards.length,0);
  for (const copies of [-1,0,1.5,4,NaN]) assert.throws(() => parseConfiguration(emptyConfiguration('Bad',[{ card_id: 1,zone: 'main',copies }])));
  const c=emptyConfiguration('Duplicates',[{ card_id: 1,zone: 'main',copies: 1 },{ card_id: 1,zone: 'main',copies: 2 }]);
  assert.throws(() => parseConfiguration(c));
  c.cards[1].zone='side';assert.equal(parseConfiguration(c).cards.length,2);
});
test('a condition must reference a local source; unsupported versions are rejected', () => {
  const c=emptyConfiguration('X');
  c.requirements=[{ id:'00000000-0000-4000-8000-000000000001',source_card_id:null,source_pair_id:'00000000-0000-4000-8000-000000000002',required_card_id:1,min_in_deck:1 }];
  assert.throws(() => parseConfiguration(c));
  c.requirements[0].source_pair_id=null;c.requirements[0].source_card_id=2;
  assert.equal(parseConfiguration(c).requirements.length,1);
  assert.throws(() => parseConfiguration({ ...c,version:3 }));
  assert.throws(() => parseArchive({ format:'ygo-proba-deck',version:1 }));
});
test('query and view category references are remapped without changing their criteria', () => {
  const params={ statsView:'old',savedQueries:[{ id:'q',name:'Any',criteria:[{ id:'c',subject:{ kind:'group',categoryIds:['old'] },min:1,max:null }] }] };
  const mapped=remapCategoryReferences(params,new Map([['old','new']]));
  assert.equal(mapped.statsView,'new');assert.equal(params.statsView,'old');
  assert.match(JSON.stringify(mapped),/"categoryIds":\["new"\]/);
  assert.throws(() => remapCategoryReferences(params,new Map()));
  assert.throws(() => parseConfiguration({ ...emptyConfiguration('Bad'),params:{ savedQueries:[{ ...params.savedQueries[0],criteria:[{ id:'c',subject:{ kind:'unknown' },min:null,max:null }] }] } }));
});
test('archives validate the entire payload before any persistence', () => {
  const configuration=emptyConfiguration('X');
  assert.throws(() => parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ hoptCardIds:[],categories:[],cardCategories:[{ card_id:1,category_id:'missing' }] } }));
  assert.equal(parseArchive({ format:'ygo-proba-deck',version:2,configuration,library:{ hoptCardIds:[],categories:[],cardCategories:[] } }).configuration.name,'X');
});
