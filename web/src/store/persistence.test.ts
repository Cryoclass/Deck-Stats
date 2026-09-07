import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { clearDraft, saveDraft } from '../lib/draft.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { stateFromConfiguration } from '../lib/deckConfiguration.js';

// Client de calcul muet : aucune promesse ne se règle, aucun recalcul n'aboutit ici (étape 4 : recompute.test.ts).
vi.mock('../worker/client.js',() => ({ createEngineClient: () => ({ compute: () => ({ id: 0,promise: new Promise(() => {}),cancel() {} }),cancelAll() {},dispose() {},pendingCount: 0 }) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn(),createDeck:vi.fn(),getLibrary:vi.fn(),getDeck:vi.fn(),cardsByIds:vi.fn(async () => []),setFlags:vi.fn(),addCategory:vi.fn(),addCardCategory:vi.fn(),removeCardCategory:vi.fn(),addGroup:vi.fn(),updateGroup:vi.fn(),deleteGroup:vi.fn() } };
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
    expect(snapshot.conditions[0].source_pair_id).toBe(pair.id);
    expect(snapshot.conditions[0].condition).toEqual({ kind:'and',all:[{ kind:'remaining',card_id:3,at_least:1 }] });
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
    expect(useDeck.getState().pairs).toEqual([]);expect(useDeck.getState().startConditions).toHaveLength(1);
    expect(useDeck.getState().startConditions[0].sourceCardId).toBe(1);expect(api.saveConfiguration).not.toHaveBeenCalled();
  });

  it('une source porte un seul arbre ET/OU : clics = clauses ET, retrait de la dernière feuille = source inconditionnelle',() => {
    const s=useDeck.getState();
    s.toggleRequirement({ cardId:1 },3);s.toggleRequirement({ cardId:1 },4);
    expect(useDeck.getState().startConditions).toHaveLength(1);
    expect(useDeck.getState().startConditions[0].condition).toEqual({ kind:'and',all:[{ kind:'remaining',card_id:3,at_least:1 },{ kind:'remaining',card_id:4,at_least:1 }] });
    useDeck.getState().setCondition({ cardId:1 },{ kind:'and',all:[{ kind:'or',any:[{ kind:'remaining',card_id:3,at_least:1 },{ kind:'remaining',card_id:4,at_least:2 }] }] });
    useDeck.getState().toggleRequirement({ cardId:1 },3); // retire la feuille 3 : le OU singleton devient la feuille 4
    expect(useDeck.getState().startConditions[0].condition).toEqual({ kind:'and',all:[{ kind:'remaining',card_id:4,at_least:2 }] });
    useDeck.getState().toggleRequirement({ cardId:1 },4);
    expect(useDeck.getState().startConditions).toEqual([]);
    expect(useDeck.getState().dirty).toBe(true);
  });

  it('profil et plafond sont globaux : refus local sans étiquette (Q1) ou sans profil (Q2), sinon acquittement serveur',async () => {
    useDeck.getState().setProfile(1,'flexible');
    expect(api.setFlags).not.toHaveBeenCalled();expect(useDeck.getState().persistenceError).toMatch(/catégorie/);
    useDeck.setState({ cardCategories:new Map([[1,new Set(['cat'])]]),persistenceError:null });
    vi.mocked(api.setFlags).mockResolvedValue({ ok:true,is_hopt:false,availability:'flexible',group_id:null });
    useDeck.getState().setProfile(1,'flexible');
    await vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));
    expect(api.setFlags).toHaveBeenLastCalledWith(1,{ availability:'flexible' });
    expect(useDeck.getState().profiles.get(1)).toEqual({ availability:'flexible',groupId:null });
    expect(useDeck.getState().dirty).toBe(false); // annotation du compte : rien à enregistrer dans le deck
    useDeck.getState().setCardGroup(2,'g');
    expect(useDeck.getState().persistenceError).toMatch(/profil/);
    vi.mocked(api.setFlags).mockResolvedValue({ ok:true,is_hopt:false,availability:'flexible',group_id:'g' });
    useDeck.getState().setCardGroup(1,'g');
    await vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));
    expect(useDeck.getState().profiles.get(1)).toEqual({ availability:'flexible',groupId:'g' });
  });

  it('les disponibilités des starts sont locales ; HOPT est global et attend son acquittement',async () => {
    useDeck.getState().toggleDeadFirst(1);expect(useDeck.getState().dirty).toBe(true);expect(api.setFlags).not.toHaveBeenCalled();
    const request=deferred<{ ok:boolean;is_hopt:boolean;availability:null;group_id:null }>();vi.mocked(api.setFlags).mockReturnValue(request.promise);
    useDeck.getState().toggleHopt(1);await Promise.resolve();expect(useDeck.getState().hopt.has(1)).toBe(false);
    request.resolve({ ok:true,is_hopt:true,availability:null,group_id:null });await vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));
    expect(useDeck.getState().hopt.has(1)).toBe(true);
  });

  it('une erreur globale ne laisse pas une annotation affichée comme enregistrée',async () => {
    vi.mocked(api.setFlags).mockRejectedValue(new Error('Réseau indisponible'));
    useDeck.getState().toggleHopt(1);
    await vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));
    expect(useDeck.getState().hopt.has(1)).toBe(false);expect(useDeck.getState().persistenceError).toBe('Réseau indisponible');
  });
});

describe('Étape 6 — constructeur : convention 1–3 refusée, jamais réduite en silence (C1–C3)',() => {
  const card={ id:9,name:'Nouvelle' };
  it('C1 : le quatrième ajout est refusé avec son motif, sans modifier le deck ni le marquer modifié',() => {
    const s=useDeck.getState();
    expect([s.addCard(card),s.addCard(card),s.addCard(card)]).toEqual([true,true,true]);
    const before=useDeck.getState().editRevision;
    expect(useDeck.getState().addCard(card)).toBe(false);
    expect(useDeck.getState().main.find((m) => m.cardId===9)?.copies).toBe(3);
    expect(useDeck.getState().editRevision).toBe(before);
    expect(useDeck.getState().persistenceError).toMatch(/convention 1 à 3/);
    expect(useDeck.getState().addCard({ id:10,name:'Trop' },4)).toBe(false);
    expect(useDeck.getState().main.some((m) => m.cardId===10)).toBe(false);
  });
  it('C2 : une quantité hors convention ou non entière est refusée ; 0 reste un retrait',() => {
    const s=useDeck.getState();
    expect(s.setCopies(1,4)).toBe(false);expect(useDeck.getState().main[0].copies).toBe(3);
    expect(useDeck.getState().persistenceError).toMatch(/Quantité 4 refusée/);
    expect(useDeck.getState().setCopies(1,2.5)).toBe(false);expect(useDeck.getState().main[0].copies).toBe(3);
    expect(useDeck.getState().setCopies(1,2)).toBe(true);expect(useDeck.getState().main[0].copies).toBe(2);
    expect(useDeck.getState().persistenceError).toBeNull();
    expect(useDeck.getState().setCopies(1,0)).toBe(true);expect(useDeck.getState().main.some((m) => m.cardId===1)).toBe(false);
  });
  it('C3 : un refus du serveur à la création est rendu par son message ; seul un échec réseau vaut hors-ligne',async () => {
    const parsed={ main:new Map([[1,4]]),extra:new Map(),side:new Map() };
    vi.mocked(api.createDeck).mockRejectedValue(new ApiError(400,'Carte, zone ou quantité invalide.'));
    expect(await useDeck.getState().createDeckFromParsed('X',parsed,[])).toBeNull();
    expect(useDeck.getState()).toMatchObject({ persistenceError:'Carte, zone ou quantité invalide.',online:true });
    vi.mocked(api.createDeck).mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await useDeck.getState().createDeckFromParsed('X',parsed,[])).toBeNull();
    expect(useDeck.getState()).toMatchObject({ online:false });
    expect(useDeck.getState().persistenceError).toMatch(/indisponible/);
    vi.mocked(api.createDeck).mockResolvedValue({ id:'new' });
    expect(await useDeck.getState().createDeckFromParsed('  ',parsed,[])).toBe('new');
    expect(vi.mocked(api.createDeck).mock.calls.at(-1)).toEqual(['Deck importé',[{ card_id:1,zone:'main',copies:4 }]]); // aucune réduction côté client : le serveur tranche
  });
});
