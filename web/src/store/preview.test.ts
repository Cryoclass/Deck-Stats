import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { stateFromConfiguration } from '../lib/deckConfiguration.js';
import { buildEngineModel } from '../lib/engineModel.js';
import { ENGINE_VERSION, summaryFromPass } from '../lib/summary.js';
import { computeAll } from '../engine/index.js';

// ─── Étape 9, point 1 : le résumé joint à l'enregistrement vient du résultat FRAIS, jamais
// d'un résultat périmé ou en cours ; absent sinon (l'accueil recalcule). Client de calcul muet,
// comme persistence.test.ts : l'état de calcul est posé directement. ───
vi.mock('../worker/client.js',() => ({ createEngineClient: () => ({ compute: () => ({ id: 0,promise: new Promise(() => {}),cancel() {} }),cancelAll() {},dispose() {},pendingCount: 0 }) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn(async () => ({ revision:2 })) } };
});
const deckId='00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks();
  useDeck.setState(useDeck.getInitialState(),true);
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 }])),deckId,revision:1,starters:new Set([1]) });
});
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });

const summaryArg = () => vi.mocked(api.saveConfiguration).mock.calls[0][3];
function freshResult() {
  const s=useDeck.getState();
  const result=computeAll(buildEngineModel(s).input);
  const version=s.modelVersion+1;
  useDeck.setState({ result,resultContext:{ deckId,deckSize:6,categories:[],unprofiledCardIds:[] },modelVersion:version,resultVersion:version,stale:false,computing:false });
  return result;
}

describe('Étape 9 — aperçu joint à l’enregistrement',() => {
  it('joint le résumé du résultat frais, avec la version du moteur du build',async () => {
    const result=freshResult();
    useDeck.getState().renameDeck('Frais');
    await useDeck.getState().saveDeck();
    const sent=summaryArg()!;
    expect(sent).toMatchObject({ engineVersion:ENGINE_VERSION,mainSize:6,startRateFirst:summaryFromPass(result.first,6)!.startRateFirst,brickRate:result.first.brick });
    expect(useDeck.getState().dirty).toBe(false);
  });
  it('n’envoie aucun résumé sans résultat (calcul initial jamais rendu)',async () => {
    useDeck.getState().renameDeck('Sans résultat');
    await useDeck.getState().saveDeck();
    expect(summaryArg()).toBeNull();
  });
  it('n’envoie aucun résumé d’un résultat périmé par une mutation de calcul',async () => {
    freshResult();
    useDeck.getState().toggleStarter(2); // invalidation immédiate : stale, version demandée > version calculée
    expect(useDeck.getState().stale).toBe(true);
    await useDeck.getState().saveDeck();
    expect(summaryArg()).toBeNull();
  });
  it('n’envoie aucun résumé d’une autre ouverture (résultat d’un deck précédent)',async () => {
    freshResult();
    useDeck.setState({ resultContext:{ deckId:'00000000-0000-4000-8000-000000000009',deckSize:6,categories:[],unprofiledCardIds:[] } });
    useDeck.getState().renameDeck('Autre');
    await useDeck.getState().saveDeck();
    expect(summaryArg()).toBeNull();
  });
});
