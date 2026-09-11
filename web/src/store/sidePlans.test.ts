import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { saveDraft } from '../lib/draft.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { configurationFromState, stateFromConfiguration } from '../lib/deckConfiguration.js';
import { buildEngineModel } from '../lib/engineModel.js';
import type { EngineResult } from '../engine/types.js';

// Étape 10C — le side s'annote pour les plans de side sans recalculer le deck de base, et les
// adversaires / échanges sont des données du deck (« non enregistré », brouillon), jamais un calcul.
vi.mock('../worker/client.js',() => ({ createEngineClient: () => ({ compute: () => ({ id: 0,promise: new Promise(() => {}),cancel() {} }),cancelAll() {},dispose() {},pendingCount: 0 }) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn() } };
});
const deckId='00000000-0000-4000-8000-000000000010';
const MAIN_A=1,MAIN_B=2,SIDE=7;
const cards=[{ card_id:MAIN_A,zone:'main' as const,copies:3 },{ card_id:MAIN_B,zone:'main' as const,copies:3 },{ card_id:SIDE,zone:'side' as const,copies:2 }];

/** Le calcul du deck de base est à jour : résultat de la version demandée, rien en cours. */
function fresh() {
  const s=useDeck.getState();
  useDeck.setState({ model: buildEngineModel(s),result: {} as EngineResult,resultVersion: s.modelVersion,computing: false,stale: false });
}
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks();
  useDeck.setState(useDeck.getInitialState(),true);
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck',cards)),deckId,revision:1,starters:new Set([MAIN_A]) });
  fresh();
});
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });

describe('Étape 10C — annoter une carte de side ne recalcule pas le deck de base',() => {
  it('starter, paire avec le main, mortes premier / second : « non enregistré » + brouillon, aucun recalcul, résultat frais',() => {
    const { modelVersion }=useDeck.getState();
    const s=useDeck.getState();
    s.toggleStarter(SIDE);
    s.togglePair(SIDE,MAIN_B);
    s.toggleDeadFirst(SIDE);
    s.toggleDeadSecond(SIDE);
    expect(useDeck.getState()).toMatchObject({ dirty:true,editRevision:4,modelVersion,computing:false,stale:false });
    expect(vi.mocked(saveDraft)).toHaveBeenCalledTimes(4);
    const c=configurationFromState(useDeck.getState());
    expect(c.starters).toContain(SIDE);
    expect(c.pairs).toMatchObject([{ card_a_id:MAIN_B,card_b_id:SIDE }]);
    expect(c.deadFirst).toEqual([SIDE]);expect(c.deadSecond).toEqual([SIDE]);
  });

  it('la même annotation sur une carte du main recalcule',() => {
    const { modelVersion }=useDeck.getState();
    useDeck.getState().toggleDeadFirst(MAIN_A);
    expect(useDeck.getState()).toMatchObject({ dirty:true,modelVersion:modelVersion+1,computing:true });
  });

  it('règle exacte, pas une heuristique par carte : si l’entrée du moteur change, on recalcule',() => {
    // Condition du starter du main exigeant une carte de side : la feuille entre dans le modèle.
    const v0=useDeck.getState().modelVersion;
    useDeck.getState().toggleRequirement({ cardId: MAIN_A },SIDE);
    expect(useDeck.getState().modelVersion).toBe(v0+1);
    // Condition d'une carte de side exigeant une carte du main : celle-ci devient un type suivi.
    fresh();
    const v1=useDeck.getState().modelVersion;
    useDeck.getState().toggleRequirement({ cardId: SIDE },MAIN_B);
    expect(useDeck.getState().modelVersion).toBe(v1+1);
  });

  it('dans le doute — un calcul en cours — on recalcule',() => {
    useDeck.setState({ computing:true });
    const v=useDeck.getState().modelVersion;
    useDeck.getState().toggleStarter(SIDE);
    expect(useDeck.getState().modelVersion).toBe(v+1);
  });
});

describe('Étape 10C — adversaires et échanges',() => {
  it('données du deck : « non enregistré », jamais de recalcul ; un échange refusé nomme sa raison et ne change rien',() => {
    const { modelVersion }=useDeck.getState();
    const s=useDeck.getState();
    expect(s.addMatchup('   ')).toBeNull();
    const id=s.addMatchup('Kewl Tune')!;
    expect(useDeck.getState().swapInPlan(id,'second',[{ card_id:MAIN_A,copies:2 }],[{ card_id:SIDE,copies:1 }])).toBe(false);
    expect(useDeck.getState().persistenceError).toMatch(/2 copies sortantes pour 1 entrante/);
    expect(useDeck.getState().swapInPlan(id,'second',[{ card_id:MAIN_A,copies:2 }],[{ card_id:SIDE,copies:2 }])).toBe(true);
    expect(useDeck.getState().persistenceError).toBeNull();
    useDeck.getState().setPlanNote(id,'second','Garder Nibiru');
    useDeck.getState().copyPlan(id,'second','first');
    useDeck.getState().removeFromPlan(id,'first','incoming',SIDE);
    useDeck.getState().renameMatchup(id,'Kewl Tune 2026');
    useDeck.getState().renameMatchup(id,'  ');
    expect(useDeck.getState()).toMatchObject({ dirty:true,modelVersion,computing:false });
    const c=configurationFromState(useDeck.getState());
    expect(c.matchups).toEqual([{ id,name:'Kewl Tune 2026',sort_index:0,plans:[
      { position:'first',note:'Garder Nibiru',outgoing:[{ card_id:MAIN_A,copies:2 }],incoming:[{ card_id:SIDE,copies:1 }] },
      { position:'second',note:'Garder Nibiru',outgoing:[{ card_id:MAIN_A,copies:2 }],incoming:[{ card_id:SIDE,copies:2 }] },
    ] }]);
    expect(vi.mocked(saveDraft).mock.calls.at(-1)![0].configuration.matchups).toEqual(c.matchups);
    useDeck.getState().removeMatchup(id);
    expect(configurationFromState(useDeck.getState()).matchups).toEqual([]);
  });

  it('le cache des chiffres ne salit rien et ne part pas dans la configuration',() => {
    useDeck.getState().setPlanSummary('m','second',{ fingerprint:'x' });
    expect(useDeck.getState()).toMatchObject({ dirty:false,planSummaries:{ 'm:second':{ fingerprint:'x' } } });
    expect(configurationFromState(useDeck.getState())).not.toHaveProperty('planSummaries');
  });
});
