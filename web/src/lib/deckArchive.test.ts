import { describe,expect,it } from 'vitest';
import { buildDeckJson,parseDeckJson } from './exportDeck.js';
import { configurationFromState,stateFromConfiguration,sourceFromDetail } from './deckConfiguration.js';
import { buildEngineModel } from './engineModel.js';
import { computePass } from '../engine/enumerate.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { validDraft } from './draft.js';

describe('Étape 3 — formats et références',() => {
  it('conserve les paires inactives, leurs conditions, notes et requêtes dans un aller-retour JSON',() => {
    const c=emptyConfiguration('Portable');const pairId=crypto.randomUUID();
    c.pairs=[{ id:pairId,card_a_id:1,card_b_id:2,disabled:true,note:'Dormant' }];
    c.requirements=[{ id:crypto.randomUUID(),source_card_id:null,source_pair_id:pairId,required_card_id:3,min_in_deck:2 }];
    c.starters=[7];c.deadFirst=[7];c.notes='Notes';
    c.params={ statsView:'cat',savedQueries:[{ id:'q',name:'Q',criteria:[{ id:'c',subject:{ kind:'group',categoryIds:['cat'] },min:1,max:2 }] }] };
    const json=buildDeckJson(c,{ hoptCardIds:[1,99],categories:[{ id:'cat',name:'Label',relevance:'both',is_builtin:false }],cardCategories:[{ card_id:2,category_id:'cat' }] });
    expect(parseDeckJson(JSON.stringify(json))).toEqual(json);expect(json.configuration).toEqual(c);
    expect(json.library.hoptCardIds).toEqual([1]);expect(json.library.categories).toHaveLength(1);
    const state=stateFromConfiguration(c);expect(configurationFromState(state).requirements).toEqual(c.requirements);
    expect(configurationFromState(state).pairs).toEqual(c.pairs);
  });
  it('rejette les anciennes versions sans ressusciter les paires globales',() => {
    expect(parseDeckJson(JSON.stringify({ format:'ygo-proba-deck',version:1,pairs:[{ a:1,b:2 }] }))).toBeNull();
    expect(validDraft({ deckId:'old',pairExclusions:[] })).toBeNull();
    const configuration=emptyConfiguration('New');
    expect(validDraft({ version:2,deckId:'new',baseRevision:1,updatedAt:1,configuration })?.configuration).toEqual(configuration);
  });
  it('signale les références de catégories absentes au lieu de perdre les critères exportés',() => {
    const c=emptyConfiguration('Broken');c.params={ statsView:'missing' };
    expect(() => buildDeckJson(c,{ hoptCardIds:[],categories:[],cardCategories:[] })).toThrow();
  });
  it('éditeur et comparateur utilisent les paires du deck et la même bibliothèque',() => {
    const c=emptyConfiguration('Compare',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 }]);
    c.pairs=[{ id:crypto.randomUUID(),card_a_id:1,card_b_id:2,disabled:false }];
    const library={ hoptCardIds:[],categories:[],cardCategories:[] };
    const detail={ id:'d',revision:1,configuration_version:2 as const,name:c.name,cards:c.cards,starters:c.starters,pairs:c.pairs,pair_exclusions:[],start_requirements:c.requirements,deadFirst:c.deadFirst,deadSecond:c.deadSecond,params:c.params };
    const compared=buildEngineModel(sourceFromDetail(detail,library));
    const edited=buildEngineModel({ ...stateFromConfiguration(c),hopt:new Set<number>(),categories:[],cardCategories:new Map() });
    expect(compared).toEqual(edited);
    expect(computePass(compared.input,5).brick).toBe(0);
    detail.pairs=[];
    expect(computePass(buildEngineModel(sourceFromDetail(detail,library)).input,5).brick).toBe(1);
  });
});
