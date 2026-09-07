import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { clearDraft, saveDraft } from '../lib/draft.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { stateFromConfiguration } from '../lib/deckConfiguration.js';

vi.mock('../worker/client.js',() => ({ computeInWorker: vi.fn(() => new Promise(() => {})) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn(),getLibrary:vi.fn(),getDeck:vi.fn(),cardsByIds:vi.fn(async () => []),setFlags:vi.fn(),addCategory:vi.fn(),addCardCategory:vi.fn(),removeCardCategory:vi.fn() } };
});
const deckId='00000000-0000-4000-8000-000000000001';
function deferred<T>() { let resolve!: (value:T) => void;const promise=new Promise<T>((r) => { resolve=r; });return { promise,resolve }; }
beforeEach(() => {
  vi.useFakeTimers();vi.clearAllMocks();
  useDeck.setState(useDeck.getInitialState(),true);
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 }])),deckId,revision:1 });
});
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });

describe('Étape 3 — persistance du store',() => {
  it('les clics créent une paire locale stable, sauvegardée avec ses conditions en une seule requête',async () => {
    useDeck.getState().togglePair(2,1);
    const pair=useDeck.getState().pairs[0];
    expect(pair.card_a_id).toBe(1);expect(pair.card_b_id).toBe(2);
    expect(pair.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.saveConfiguration).not.toHaveBeenCalled();
    useDeck.getState().toggleRequirement({ pairId:pair.id },3);
    useDeck.getState().setPairExcluded(pair.id,true);
    vi.mocked(api.saveConfiguration).mockResolvedValue({ revision:2 });
    await useDeck.getState().saveDeck();
    expect(api.saveConfiguration).toHaveBeenCalledTimes(1);
    const [id,snapshot,revision]=vi.mocked(api.saveConfiguration).mock.calls[0];
    expect([id,revision]).toEqual([deckId,1]);expect(snapshot.pairs[0]).toMatchObject({ id:pair.id,disabled:true });
    expect(snapshot.requirements[0].source_pair_id).toBe(pair.id);
    expect(useDeck.getState().dirty).toBe(false);expect(useDeck.getState().revision).toBe(2);
    expect(snapshot).not.toHaveProperty('summary');
  });

  it('une édition pendant la sauvegarde conserve dirty et un brouillon distinct',async () => {
    const request=deferred<{ revision:number }>();vi.mocked(api.saveConfiguration).mockReturnValue(request.promise);
    useDeck.getState().renameDeck('Snapshot');const saving=useDeck.getState().saveDeck();
    useDeck.getState().renameDeck('Newer edit');
    await useDeck.getState().saveDeck(); // Double click does not start another request.
    expect(api.saveConfiguration).toHaveBeenCalledTimes(1);
    request.resolve({ revision:2 });await saving;
    expect(useDeck.getState()).toMatchObject({ deckName:'Newer edit',dirty:true,revision:2,saving:false });
    expect(vi.mocked(saveDraft).mock.calls.at(-1)![0].configuration.name).toBe('Newer edit');
    expect(vi.mocked(clearDraft).mock.calls.at(-1)![1]?.name).toBe('Snapshot');
  });

  it('une réponse de sauvegarde ne modifie pas le deck ouvert ensuite',async () => {
    const request=deferred<{ revision:number }>();vi.mocked(api.saveConfiguration).mockReturnValue(request.promise);
    useDeck.getState().renameDeck('A');const saving=useDeck.getState().saveDeck();
    useDeck.setState({ deckId:'other',deckName:'B',dirty:true,revision:9 });
    request.resolve({ revision:2 });await saving;
    expect(useDeck.getState()).toMatchObject({ deckId:'other',deckName:'B',dirty:true,revision:9 });
  });

  it('un conflit conserve les modifications et rend son motif visible',async () => {
    vi.mocked(api.saveConfiguration).mockRejectedValue(new ApiError(409,'Modifié ailleurs'));
    useDeck.getState().renameDeck('Keep');await useDeck.getState().saveDeck();
    expect(useDeck.getState()).toMatchObject({ dirty:true,deckName:'Keep',persistenceError:'Modifié ailleurs' });
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('supprimer une paire affecte seulement le brouillon du deck et ses références',() => {
    useDeck.getState().togglePair(1,2);const id=useDeck.getState().pairs[0].id;
    useDeck.getState().toggleRequirement({ pairId:id },3);useDeck.getState().toggleRequirement({ cardId:1 },4);
    useDeck.getState().removePairFromDeck(id);
    expect(useDeck.getState().pairs).toEqual([]);expect(useDeck.getState().startRequirements).toHaveLength(1);
    expect(useDeck.getState().startRequirements[0].sourceCardId).toBe(1);expect(api.saveConfiguration).not.toHaveBeenCalled();
  });

  it('les disponibilités des starts sont locales ; HOPT est global et attend son acquittement',async () => {
    useDeck.getState().toggleDeadFirst(1);expect(useDeck.getState().dirty).toBe(true);expect(api.setFlags).not.toHaveBeenCalled();
    const request=deferred<unknown>();vi.mocked(api.setFlags).mockReturnValue(request.promise);
    useDeck.getState().toggleHopt(1);await Promise.resolve();expect(useDeck.getState().hopt.has(1)).toBe(false);
    request.resolve({ ok:true });await vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));
    expect(useDeck.getState().hopt.has(1)).toBe(true);
  });

  it('une erreur globale ne laisse pas une annotation affichée comme enregistrée',async () => {
    vi.mocked(api.setFlags).mockRejectedValue(new Error('Réseau indisponible'));
    useDeck.getState().toggleHopt(1);
    await vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));
    expect(useDeck.getState().hopt.has(1)).toBe(false);expect(useDeck.getState().persistenceError).toBe('Réseau indisponible');
  });
});
