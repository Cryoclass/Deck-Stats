import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { stateFromConfiguration } from '../lib/deckConfiguration.js';

// Étape 9B — mode Non-engine combiné : `applyNonEngine` rend la carte conforme au couple
// (étiquette, profil), deux requêtes au plus dans la file globale, l'étiquette avant le profil
// (le serveur exige une étiquette avant un profil, Q1 de 5B) ; conforme → retrait de l'étiquette
// puis du profil devenu orphelin. Annotations du compte : jamais « non enregistré ».
vi.mock('../worker/client.js',() => ({ createEngineClient: () => ({ compute: () => ({ id: 0,promise: new Promise(() => {}),cancel() {} }),cancelAll() {},dispose() {},pendingCount: 0 }) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn(),setFlags:vi.fn(),addCardCategory:vi.fn(),removeCardCategory:vi.fn() } };
});
const deckId='00000000-0000-4000-8000-000000000001';
const flags=(availability: 'early' | 'flexible' | null) => ({ ok:true,is_hopt:false,availability,group_id:null });
const settled=() => vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));
const order=(fn: unknown) => vi.mocked(fn as () => unknown).mock.invocationCallOrder[0];
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks();
  useDeck.setState(useDeck.getInitialState(),true);
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 }])),deckId,revision:1,
    categories:[{ id:'ht',name:'Handtrap',is_builtin:false },{ id:'bb',name:'Board breaker',is_builtin:false }] });
  vi.mocked(api.addCardCategory).mockResolvedValue({});
  vi.mocked(api.removeCardCategory).mockResolvedValue({});
});
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });

describe('Étape 9B — mode Non-engine combiné',() => {
  it('carte nue + couple (étiquette, profil) : deux requêtes, l’étiquette d’abord, puis le profil ; rien à enregistrer',async () => {
    vi.mocked(api.setFlags).mockResolvedValue(flags('early'));
    useDeck.getState().applyNonEngine(1,'ht','early');
    await settled();
    expect(api.addCardCategory).toHaveBeenCalledWith(1,'ht');
    expect(api.setFlags).toHaveBeenCalledWith(1,{ availability:'early' });
    expect(order(api.addCardCategory)).toBeLessThan(order(api.setFlags));
    expect(api.removeCardCategory).not.toHaveBeenCalled();
    expect([...useDeck.getState().cardCategories.get(1)!]).toEqual(['ht']);
    expect(useDeck.getState().profiles.get(1)).toEqual({ availability:'early',groupId:null });
    expect(useDeck.getState()).toMatchObject({ dirty:false,persistenceError:null });
    expect(api.saveConfiguration).not.toHaveBeenCalled();
  });

  it('« profil inchangé » : l’étiquette seule est posée, le profil n’est pas touché',async () => {
    useDeck.setState({ profiles:new Map([[1,{ availability:'flexible',groupId:null }]]),cardCategories:new Map([[1,new Set(['bb'])]]) });
    useDeck.getState().applyNonEngine(1,'ht',null);
    await settled();
    expect(api.addCardCategory).toHaveBeenCalledWith(1,'ht');
    expect(api.setFlags).not.toHaveBeenCalled();
    expect([...useDeck.getState().cardCategories.get(1)!].sort()).toEqual(['bb','ht']);
    expect(useDeck.getState().profiles.get(1)?.availability).toBe('flexible');
  });

  it('étiquette déjà portée mais profil différent : seul le profil est posé',async () => {
    useDeck.setState({ profiles:new Map([[1,{ availability:'flexible',groupId:null }]]),cardCategories:new Map([[1,new Set(['ht'])]]) });
    vi.mocked(api.setFlags).mockResolvedValue(flags('early'));
    useDeck.getState().applyNonEngine(1,'ht','early');
    await settled();
    expect(api.addCardCategory).not.toHaveBeenCalled();
    expect(api.setFlags).toHaveBeenCalledWith(1,{ availability:'early' });
    expect(useDeck.getState().profiles.get(1)?.availability).toBe('early');
  });

  it('carte conforme : retrait de l’étiquette, puis du profil s’il ne reste aucune étiquette',async () => {
    useDeck.setState({ profiles:new Map([[1,{ availability:'early',groupId:null }]]),cardCategories:new Map([[1,new Set(['ht'])]]) });
    vi.mocked(api.setFlags).mockResolvedValue(flags(null));
    useDeck.getState().applyNonEngine(1,'ht','early');
    await settled();
    expect(api.removeCardCategory).toHaveBeenCalledWith(1,'ht');
    expect(api.setFlags).toHaveBeenCalledWith(1,{ availability:null });
    expect(order(api.removeCardCategory)).toBeLessThan(order(api.setFlags));
    expect(useDeck.getState().cardCategories.get(1)?.size ?? 0).toBe(0);
    expect(useDeck.getState().profiles.has(1)).toBe(false);
  });

  it('carte conforme avec une autre étiquette : l’étiquette part, le profil reste',async () => {
    useDeck.setState({ profiles:new Map([[1,{ availability:'early',groupId:null }]]),cardCategories:new Map([[1,new Set(['ht','bb'])]]) });
    useDeck.getState().applyNonEngine(1,'ht',null);
    await settled();
    expect(api.removeCardCategory).toHaveBeenCalledWith(1,'ht');
    expect(api.setFlags).not.toHaveBeenCalled();
    expect([...useDeck.getState().cardCategories.get(1)!]).toEqual(['bb']);
    expect(useDeck.getState().profiles.get(1)?.availability).toBe('early');
  });

  it('un refus de l’étiquette arrête la paire : aucun profil envoyé, état inchangé, motif visible',async () => {
    vi.mocked(api.addCardCategory).mockRejectedValue(new Error('Catégorie inconnue.'));
    useDeck.getState().applyNonEngine(1,'ht','early');
    await settled();
    expect(api.setFlags).not.toHaveBeenCalled();
    expect(useDeck.getState().cardCategories.get(1)?.size ?? 0).toBe(0);
    expect(useDeck.getState().profiles.has(1)).toBe(false);
    expect(useDeck.getState().persistenceError).toBe('Catégorie inconnue.');
  });

  it('deux clics enchaînés sur la même carte se suivent dans la file : pose puis retrait',async () => {
    vi.mocked(api.setFlags).mockResolvedValueOnce(flags('early')).mockResolvedValueOnce(flags(null));
    useDeck.getState().applyNonEngine(1,'ht','early');
    useDeck.getState().applyNonEngine(1,'ht','early');
    await settled();
    expect(vi.mocked(api.addCardCategory).mock.calls).toEqual([[1,'ht']]);
    expect(vi.mocked(api.removeCardCategory).mock.calls).toEqual([[1,'ht']]);
    expect(vi.mocked(api.setFlags).mock.calls).toEqual([[1,{ availability:'early' }],[1,{ availability:null }]]);
    expect(useDeck.getState().cardCategories.get(1)?.size ?? 0).toBe(0);
    expect(useDeck.getState().profiles.has(1)).toBe(false);
  });
});
