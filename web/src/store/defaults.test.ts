import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { useDeck } from './deckStore.js';
import { emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { libraryState, stateFromConfiguration } from '../lib/deckConfiguration.js';
import type { Card, Library } from '../types.js';

// Annotations par défaut, partie C : le store expose les valeurs EFFECTIVES (choix > référence >
// détection) ; un geste sur une carte héritée part de la valeur affichée (bascule HOPT) et envoie
// au serveur la valeur héritée à matérialiser (aspect non-engine, D6).
vi.mock('../worker/client.js',() => ({ createEngineClient: () => ({ compute: () => ({ id: 0,promise: new Promise(() => {}),cancel() {} }),cancelAll() {},dispose() {},pendingCount: 0 }) }));
vi.mock('../lib/draft.js',() => ({ saveDraft: vi.fn(async () => {}),clearDraft: vi.fn(async () => {}),loadDraft: vi.fn(async () => null) }));
vi.mock('../lib/api.js',async (original) => {
  const actual=await original<typeof import('../lib/api.js')>();
  return { ...actual,api:{ ...actual.api,saveConfiguration:vi.fn(),setFlags:vi.fn(),resetFlags:vi.fn(),addCardCategory:vi.fn(),removeCardCategory:vi.fn() } };
});

const ASH: Card = { id: 1, name: 'Ash Blossom & Joyous Spring', type: 'Tuner Monster', description: 'When a card or effect is activated that includes any of these effects (Quick Effect): You can discard this card; negate that effect. You can only use this effect of "Ash Blossom & Joyous Spring" once per turn.' };
const FUWALOS: Card = { id: 2, name: 'Mulcharmy Fuwalos', type: 'Effect Monster', description: 'If you control no cards (Quick Effect): You can discard this card; apply these effects this turn. You can only activate 1 other "Mulcharmy" monster effect, the turn you activate this effect.' };
const library=(over: Partial<Library> = {}): Library => ({ hoptCardIds:[],categories:[],cardCategories:[],profiles:[],groups:[{ id:'g-m',name:'Mulcharmy',cap_per_turn:2,is_builtin:true }],choices:[],references:[],referencesVersion:'0',...over });
const settled=() => vi.waitFor(() => expect(useDeck.getState().libraryPending).toBe(0));

function seed(lib: Library) {
  useDeck.setState(useDeck.getInitialState(),true);
  useDeck.setState({ ...stateFromConfiguration(emptyConfiguration('Deck',[{ card_id:1,zone:'main',copies:2 },{ card_id:2,zone:'main',copies:3 }])),
    deckId:'00000000-0000-4000-8000-000000000001',revision:1,...libraryState(lib),cards:{ 1:ASH,2:FUWALOS } });
  // `addCard` (2 → 3 copies) déclenche la dérivation comme le chargement d'un deck.
  expect(useDeck.getState().addCard(ASH,1,'main')).toBe(true);
}

beforeEach(() => { vi.useFakeTimers();vi.clearAllMocks(); });
afterEach(() => { vi.clearAllTimers();vi.useRealTimers(); });

describe('Partie C — valeurs effectives dans le store',() => {
  it('sans aucun choix : HOPT et profils viennent du texte, avec leur origine ; plafond de base résolu',() => {
    seed(library());
    const s=useDeck.getState();
    expect(s.hopt.has(1)).toBe(true);
    expect(s.profiles.get(1)).toEqual({ availability:'flexible',groupId:null });
    expect(s.profiles.get(2)).toEqual({ availability:'early',groupId:'g-m' });
    expect(s.origin.get(1)).toEqual({ hopt:'detection',nonengine:'detection' });
  });

  it('une référence corrige la détection ; un choix prime sur la référence',() => {
    seed(library({ references:[{ card_id:1,is_hopt:false,nonengine_set:true,availability:'reactive',group_name:null,note:null }] }));
    expect(useDeck.getState().hopt.has(1)).toBe(false);
    expect(useDeck.getState().origin.get(1)).toEqual({ hopt:'reference',nonengine:'reference' });
    seed(library({ hoptCardIds:[1],choices:[{ card_id:1,is_hopt:true,nonengine_choice:false }],references:[{ card_id:1,is_hopt:false,nonengine_set:false,availability:null,group_name:null,note:null }] }));
    expect(useDeck.getState().hopt.has(1)).toBe(true);
    expect(useDeck.getState().origin.get(1)?.hopt).toBe('choice');
  });

  it('bascule HOPT d’une carte détectée : choix explicite « faux » ; retour au défaut : la détection revient',async () => {
    seed(library());
    vi.mocked(api.setFlags).mockResolvedValue({ ok:true,card_id:1,is_hopt:false,nonengine_choice:false,availability:null,group_id:null });
    useDeck.getState().toggleHopt(1);
    await settled();
    expect(api.setFlags).toHaveBeenCalledWith(1,{ is_hopt:false });
    expect(useDeck.getState().hopt.has(1)).toBe(false);
    expect(useDeck.getState().origin.get(1)?.hopt).toBe('choice');
    vi.mocked(api.resetFlags).mockResolvedValue({ ok:true,card_id:1,is_hopt:null,nonengine_choice:false,availability:null,group_id:null });
    useDeck.getState().resetAnnotation(1,'hopt');
    await settled();
    expect(api.resetFlags).toHaveBeenCalledWith(1,'hopt');
    expect(useDeck.getState().hopt.has(1)).toBe(true);
    expect(useDeck.getState().origin.get(1)?.hopt).toBe('detection');
  });

  it('premier geste non-engine sur une carte héritée : la valeur affichée part avec la requête',async () => {
    seed(library());
    vi.mocked(api.setFlags).mockResolvedValue({ ok:true,card_id:2,is_hopt:null,nonengine_choice:true,availability:'early',group_id:null });
    useDeck.getState().setCardGroup(2,null);
    await settled();
    expect(api.setFlags).toHaveBeenCalledWith(2,{ group_id:null,inherited:{ availability:'early',group_name:'Mulcharmy' } });
    expect(useDeck.getState().profiles.get(2)).toEqual({ availability:'early',groupId:null });
    expect(useDeck.getState().origin.get(2)?.nonengine).toBe('choice');
  });

  it('mode Non-engine combiné : poser puis retirer l’étiquette d’une carte au profil DÉTECTÉ laisse le profil hérité',async () => {
    seed(library());
    useDeck.setState({ categories:[{ id:'ht',name:'Handtrap',is_builtin:true }] });
    vi.mocked(api.addCardCategory).mockResolvedValue({} as never);
    vi.mocked(api.removeCardCategory).mockResolvedValue({} as never);
    useDeck.getState().applyNonEngine(1,'ht','flexible'); // poser : étiquette seule (profil déjà flexible)
    await settled();
    useDeck.getState().applyNonEngine(1,'ht','flexible'); // retirer : l'étiquette part, le profil hérité reste
    await settled();
    expect(api.removeCardCategory).toHaveBeenCalledWith(1,'ht');
    expect(api.setFlags).not.toHaveBeenCalled();
    expect(useDeck.getState().profiles.get(1)).toEqual({ availability:'flexible',groupId:null });
    expect(useDeck.getState().origin.get(1)?.nonengine).toBe('detection');
  });
});
