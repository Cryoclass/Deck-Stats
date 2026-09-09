import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { saveDraft } from '../lib/draft.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { configurationFromState, stateFromConfiguration } from '../lib/deckConfiguration.js';
import { buildEngineModel } from '../lib/engineModel.js';
import { EXTRA_SIDE_SOFT_LIMIT, overSoftLimit } from '../lib/zones.js';
import type { Card } from '../types.js';

// Étape 9C — extra et side éditables : zones distinctes (convention 1–3 par carte ET par zone),
// mutations marquées « non enregistré » (brouillon compris) SANS recalcul, jamais dans le modèle
// moteur (contrat §2) ; 0 copie = retrait avec toast portant la zone, annulation dans la même zone.
vi.mock('../worker/client.js',() => ({ createEngineClient: () => ({ compute: () => ({ id: 0,promise: new Promise(() => {}),cancel() {} }),cancelAll() {},dispose() {},pendingCount: 0 }) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn() } };
});
const deckId='00000000-0000-4000-8000-000000000009';
const cards=[{ card_id:1,zone:'main' as const,copies:3 },{ card_id:2,zone:'main' as const,copies:3 }];
const UN: Card={ id:1,name:'Un' };
const RHO: Card={ id:7,name:'Side Rho' };
const PI: Card={ id:8,name:'Extra Pi' };
const zones=() => { const s=useDeck.getState();return { main:s.main,extra:s.extra,side:s.side }; };
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks();
  useDeck.setState(useDeck.getInitialState(),true);
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck',cards)),deckId,revision:1,starters:new Set([1]) });
});
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });

describe('Étape 9C — extra et side éditables',() => {
  it('les zones sont distinctes : convention 1–3 par carte et par zone, refus nommant la zone, main intact',() => {
    const s=useDeck.getState();
    expect(s.addCard(RHO,1,'side')).toBe(true);
    expect(zones()).toMatchObject({ side:[{ cardId:7,zone:'side',copies:1 }],extra:[] });
    expect(zones().main).toHaveLength(2);
    expect(s.addCard(RHO,1,'side')).toBe(true);expect(s.addCard(RHO,1,'side')).toBe(true);
    expect(s.addCard(RHO,1,'side')).toBe(false); // quatrième copie refusée, aucune réduction
    expect(useDeck.getState().persistenceError).toMatch(/Side Rho : déjà 3 copies en side deck — convention 1 à 3/);
    expect(zones().side).toEqual([{ cardId:7,zone:'side',copies:3 }]);
    // La même carte peut être en main (3) et en side (1) : la convention est par zone.
    expect(s.addCard(UN,1,'side')).toBe(true);
    expect(zones().side.map((c) => [c.cardId,c.copies])).toEqual([[7,3],[1,1]]);
    expect(zones().main.find((c) => c.cardId===1)?.copies).toBe(3);
    expect(s.setCopies(7,4,'side')).toBe(false);
    expect(useDeck.getState().persistenceError).toMatch(/Quantité 4 refusée en side deck/);
    expect(s.setCopies(7,2,'side')).toBe(true);
    expect(zones().side[0].copies).toBe(2);
    expect(zones().main).toEqual([{ cardId:1,zone:'main',copies:3 },{ cardId:2,zone:'main',copies:3 }]);
    const configuration=configurationFromState(useDeck.getState());
    expect(configuration.cards).toEqual([
      { card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 },
      { card_id:7,zone:'side',copies:2 },{ card_id:1,zone:'side',copies:1 },
    ]);
  });

  it('une mutation de l’extra ou du side marque « non enregistré » et écrit le brouillon, sans recalcul ni entrée dans le modèle moteur',() => {
    const { modelVersion }=useDeck.getState();
    const reference=buildEngineModel(useDeck.getState());
    expect(reference.input.deckSize).toBe(6);
    const s=useDeck.getState();
    expect(s.addCard(PI,1,'extra')).toBe(true);
    expect(useDeck.getState()).toMatchObject({ dirty:true,editRevision:1,modelVersion,computing:false });
    expect(vi.mocked(saveDraft).mock.calls.at(-1)![0].configuration.cards).toContainEqual({ card_id:8,zone:'extra',copies:1 });
    expect(s.setCopies(8,3,'extra')).toBe(true);
    s.addCard(RHO,1,'side');
    s.removeCard(8,'extra');
    expect(useDeck.getState()).toMatchObject({ dirty:true,editRevision:4,modelVersion });
    // Le modèle moteur ne voit que le main deck (contrat §2) : strictement identique.
    expect(buildEngineModel(useDeck.getState())).toEqual(reference);
    // Une mutation du main recalcule toujours.
    s.addCard(PI,1,'main');
    expect(useDeck.getState().modelVersion).toBe(modelVersion+1);
    expect(buildEngineModel(useDeck.getState()).input.deckSize).toBe(7);
  });

  it('0 copie = retrait avec toast portant la zone ; Annuler restaure la carte dans la même zone, à sa place',() => {
    const s=useDeck.getState();
    s.addCard(RHO,1,'side');s.addCard(PI,1,'side');
    const { modelVersion }=useDeck.getState();
    expect(s.setCopies(7,0,'side')).toBe(true);
    expect(zones().side.map((c) => c.cardId)).toEqual([8]);
    expect(useDeck.getState().removalToast).toMatchObject({ card:{ cardId:7,zone:'side',copies:1 },index:0 });
    expect(zones().main).toHaveLength(2);
    s.undoRemove();
    expect(zones().side.map((c) => c.cardId)).toEqual([7,8]);
    expect(useDeck.getState()).toMatchObject({ removalToast:null,dirty:true,modelVersion });
    s.removeCard(1,'side'); // absente du side : rien, même si elle est en main
    expect(useDeck.getState().removalToast).toBeNull();
    expect(zones().main).toHaveLength(2);
    s.removeCard(1); // zone par défaut : main → recalcul
    expect(useDeck.getState().removalToast).toMatchObject({ card:{ cardId:1,zone:'main',copies:3 } });
    expect(useDeck.getState().modelVersion).toBe(modelVersion+1);
    expect(zones().side.map((c) => c.cardId)).toEqual([7,8]);
  });

  it('l’enregistrement envoie les trois zones en une seule configuration',async () => {
    const s=useDeck.getState();
    s.addCard(RHO,1,'side');s.addCard(PI,2,'extra');
    vi.mocked(api.saveConfiguration).mockResolvedValue({ revision:2 });
    await s.saveDeck();
    const [,snapshot,revision]=vi.mocked(api.saveConfiguration).mock.calls[0];
    expect(revision).toBe(1);
    expect(snapshot.cards).toEqual([
      { card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 },
      { card_id:8,zone:'extra',copies:2 },{ card_id:7,zone:'side',copies:1 },
    ]);
    expect(useDeck.getState()).toMatchObject({ dirty:false,revision:2 });
  });

  it('repère de 15 cartes en extra et en side : avertissement seulement, jamais un refus (Q5)',() => {
    expect(EXTRA_SIDE_SOFT_LIMIT).toBe(15);
    expect(overSoftLimit('side',15)).toBe(false);
    expect(overSoftLimit('side',16)).toBe(true);
    expect(overSoftLimit('extra',16)).toBe(true);
    expect(overSoftLimit('main',61)).toBe(false); // le main garde son repère 40–60 ailleurs
    const s=useDeck.getState();
    for (let id=100;id<106;id++) for (let k=0;k<3;k++) expect(s.addCard({ id,name:`Extra ${id}` },1,'extra')).toBe(true);
    expect(zones().extra.reduce((n,c) => n+c.copies,0)).toBe(18);
    expect(useDeck.getState().persistenceError).toBeNull();
  });
});
