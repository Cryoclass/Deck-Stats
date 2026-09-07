import { describe,expect,it } from 'vitest';
import { buildDeckJson,parseDeckJson } from './exportDeck.js';
import { configurationFromState,stateFromConfiguration,sourceFromDetail } from './deckConfiguration.js';
import { buildEngineModel } from './engineModel.js';
import { computePass } from '../engine/enumerate.js';
import { emptyConfiguration, upgradeConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { validDraft } from './draft.js';
import type { Library } from '../types.js';

const emptyLibrary: Library = { hoptCardIds:[],categories:[],cardCategories:[],profiles:[],groups:[] };

describe('Étape 3 — formats et références',() => {
  it('conserve les paires inactives, leurs conditions ET/OU, notes, profils, plafonds et requêtes dans un aller-retour JSON',() => {
    const c=emptyConfiguration('Portable');const pairId=crypto.randomUUID();
    c.pairs=[{ id:pairId,card_a_id:1,card_b_id:2,disabled:true,note:'Dormant' }];
    c.conditions=[{ id:crypto.randomUUID(),source_card_id:null,source_pair_id:pairId,condition:{ kind:'and',all:[{ kind:'remaining',card_id:3,at_least:2 },{ kind:'or',any:[{ kind:'remaining',card_id:4,at_least:1 },{ kind:'remaining',card_id:5,at_least:1 }] }] } }];
    c.starters=[7];c.deadFirst=[7];c.notes='Notes';
    c.params={ statsView:'cat',savedQueries:[{ id:'q',name:'Q',criteria:[{ id:'c',subject:{ kind:'group',categoryIds:['cat'] },min:1,max:2 }] }] };
    const library: Library={ hoptCardIds:[1,99],categories:[{ id:'cat',name:'Label',is_builtin:false }],cardCategories:[{ card_id:2,category_id:'cat' }],
      profiles:[{ card_id:2,availability:'flexible',group_id:'g1' },{ card_id:99,availability:'early',group_id:null }],groups:[{ id:'g1',name:'Mulcharmy',cap_per_turn:2 },{ id:'g2',name:'Inutilisé',cap_per_turn:1 }] };
    const json=buildDeckJson(c,library);
    expect(parseDeckJson(JSON.stringify(json))).toEqual(json);expect(json.configuration).toEqual(c);
    expect(json.library.hoptCardIds).toEqual([1]);expect(json.library.categories).toEqual([{ id:'cat',name:'Label' }]);
    // Cartes 3, 4 et 5 requises par la condition : présentes dans le périmètre de l'archive.
    expect(json.library.profiles).toEqual([{ card_id:2,availability:'flexible',group_id:'g1' }]);
    expect(json.library.groups).toEqual([{ id:'g1',name:'Mulcharmy',cap_per_turn:2 }]);
    const state=stateFromConfiguration(c);expect(configurationFromState(state).conditions).toEqual(c.conditions);
    expect(configurationFromState(state).pairs).toEqual(c.pairs);
  });
  it('rejette les anciennes versions sans ressusciter les paires globales, avec le motif exact (étape 6, C4)',() => {
    expect(() => parseDeckJson(JSON.stringify({ format:'ygo-proba-deck',version:1,pairs:[{ a:1,b:2 }] }))).toThrow(/Version JSON non prise en charge/);
    expect(() => parseDeckJson('{ pas du json')).toThrow(/illisible/);
    expect(() => parseDeckJson(JSON.stringify({ format:'ygo-proba-deck',version:2,configuration:emptyConfiguration('X'),library:{ hoptCardIds:[],categories:[{ id:'a',name:'Dup' },{ id:'b',name:'Dup' }],cardCategories:[] } }))).toThrow(/Catégorie dupliquée/);
    expect(validDraft({ deckId:'old',pairExclusions:[] })).toBeNull();
    const configuration=emptyConfiguration('New');
    expect(validDraft({ version:2,deckId:'new',baseRevision:1,updatedAt:1,configuration })?.configuration).toEqual(configuration);
  });
  it('convertit explicitement les prérequis ET plats antérieurs à l’étape 5B (archives et brouillons), jamais l’API',() => {
    const legacy={ ...emptyConfiguration('Old'),params:{ horizonFirst:1,horizonSecond:2,importance:0.5 },
      requirements:[
        { id:'00000000-0000-4000-8000-000000000002',source_card_id:1,source_pair_id:null,required_card_id:3,min_in_deck:1 },
        { id:'00000000-0000-4000-8000-000000000001',source_card_id:1,source_pair_id:null,required_card_id:2,min_in_deck:2 },
      ] } as Record<string,unknown>;
    delete legacy.conditions;
    const upgraded=upgradeConfiguration(legacy) as { conditions:unknown[];params:Record<string,unknown> };
    expect(upgraded.conditions).toEqual([{ id:'00000000-0000-4000-8000-000000000001',source_card_id:1,source_pair_id:null,
      condition:{ kind:'and',all:[{ kind:'remaining',card_id:2,at_least:2 },{ kind:'remaining',card_id:3,at_least:1 }] } }]);
    expect(upgraded.params).toEqual({ importance:0.5 });
    const draft=validDraft({ version:2,deckId:'d',baseRevision:1,updatedAt:1,configuration:legacy });
    expect(draft?.configuration.conditions).toEqual(upgraded.conditions);
    const archive=parseDeckJson(JSON.stringify({ format:'ygo-proba-deck',version:2,configuration:legacy,library:{ hoptCardIds:[],categories:[{ id:'c',name:'Old',relevance:'first' }],cardCategories:[] } }));
    expect(archive.configuration.conditions).toEqual(upgraded.conditions);
    expect(archive.library.categories).toEqual([{ id:'c',name:'Old' }]);
    expect(archive.library.profiles).toEqual([]);
    // L'API (configurationFromState → parseConfiguration) refuse l'ancien format : un client périmé doit recharger.
    expect(() => configurationFromState({ ...stateFromConfiguration(emptyConfiguration('X')),startConditions:[{ id:'not-a-uuid',sourceCardId:1,sourcePairId:null,condition:{ kind:'and',all:[] } }] })).toThrow();
  });
  it('signale les références de catégories absentes au lieu de perdre les critères exportés',() => {
    const c=emptyConfiguration('Broken');c.params={ statsView:'missing' };
    expect(() => buildDeckJson(c,emptyLibrary)).toThrow();
  });
  it('éditeur et comparateur utilisent les paires du deck et la même bibliothèque',() => {
    const c=emptyConfiguration('Compare',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 }]);
    c.pairs=[{ id:crypto.randomUUID(),card_a_id:1,card_b_id:2,disabled:false }];
    const detail={ id:'d',revision:1,configuration_version:2 as const,name:c.name,cards:c.cards,starters:c.starters,pairs:c.pairs,pair_exclusions:[],conditions:c.conditions,deadFirst:c.deadFirst,deadSecond:c.deadSecond,params:c.params };
    const compared=buildEngineModel(sourceFromDetail(detail,emptyLibrary));
    const edited=buildEngineModel({ ...stateFromConfiguration(c),hopt:new Set<number>(),categories:[],cardCategories:new Map(),profiles:new Map(),groups:[] });
    expect(compared).toEqual(edited);
    expect(computePass(compared.input,5).brick).toBe(0);
    detail.pairs=[];
    expect(computePass(buildEngineModel(sourceFromDetail(detail,emptyLibrary)).input,5).brick).toBe(1);
  });
});
