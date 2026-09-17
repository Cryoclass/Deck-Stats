import { describe, expect, it } from 'vitest';
import { effectiveLibrary, effectiveOf, type RawLibrary } from './effectiveLibrary.js';
import type { Card, CardReference } from '../types.js';

// ─── Annotations par défaut, partie C : choix > référence > détection (R1), par aspect (D6) ───

const ASH: Card = { id: 1, name: 'Ash Blossom & Joyous Spring', type: 'Tuner Monster', description: 'When a card or effect is activated that includes any of these effects (Quick Effect): You can discard this card; negate that effect. You can only use this effect of "Ash Blossom & Joyous Spring" once per turn.' };
const FUWALOS: Card = { id: 2, name: 'Mulcharmy Fuwalos', type: 'Effect Monster', description: 'If you control no cards (Quick Effect): You can discard this card; apply these effects this turn. You can only activate 1 other "Mulcharmy" monster effect, the turn you activate this effect.' };
const VANILLA: Card = { id: 3, name: 'Vanilla', type: 'Normal Monster', description: 'A dragon.' };
const DROLL: Card = { id: 4, name: 'Droll & Lock Bird', type: 'Effect Monster', description: 'If a card(s) is added from the Main Deck to your opponent\'s hand, except during the Draw Phase (Quick Effect): You can send this card from your hand to the GY; for the rest of this turn, cards cannot be added from either player\'s Main Deck to the hand.' };
const cards: Record<number, Card> = { 1: ASH, 2: FUWALOS, 3: VANILLA, 4: DROLL };
const raw = (over: Partial<RawLibrary> = {}): RawLibrary => ({ hopt: new Set(), choices: new Map(), chosenProfiles: new Map(), groups: [{ id: 'g-m', name: 'Mulcharmy', cap_per_turn: 2, is_builtin: true }], references: new Map(), ...over });
const ref = (card_id: number, over: Partial<CardReference>): CardReference => ({ card_id, is_hopt: null, nonengine_set: false, availability: null, group_name: null, note: null, ...over });

describe('effectiveOf — détection seule', () => {
  it('HOPT et profil viennent du texte ; le plafond « Mulcharmy » se résout vers le groupe du compte', () => {
    expect(effectiveOf(raw(), 1, ASH)).toEqual({ isHopt: true, profile: { availability: 'flexible', groupId: null }, origin: { hopt: 'detection', nonengine: 'detection' }, inherited: { availability: 'flexible', group_name: null } });
    expect(effectiveOf(raw(), 2, FUWALOS)).toEqual({ isHopt: false, profile: { availability: 'early', groupId: 'g-m' }, origin: { hopt: null, nonengine: 'detection' }, inherited: { availability: 'early', group_name: 'Mulcharmy' } });
    expect(effectiveOf(raw(), 4, DROLL).profile?.availability).toBe('reactive');
    expect(effectiveOf(raw(), 4, DROLL).isHopt).toBe(false); // aucune limite écrite : au référent (Q5)
    // Sans groupe de ce nom : profil conservé, plafond tombé.
    expect(effectiveOf(raw({ groups: [] }), 2, FUWALOS).profile).toEqual({ availability: 'early', groupId: null });
    // Vanille : rien ; carte absente du catalogue : rien, jamais une erreur.
    expect(effectiveOf(raw(), 3, VANILLA)).toEqual({ isHopt: false, profile: null, origin: { hopt: null, nonengine: null }, inherited: { availability: null, group_name: null } });
    expect(effectiveOf(raw(), 99, undefined)).toEqual({ isHopt: false, profile: null, origin: { hopt: null, nonengine: null }, inherited: { availability: null, group_name: null } });
  });
});

describe('effectiveOf — référence puis choix, aspect par aspect', () => {
  it('une référence corrige la détection ; un choix prime sur la référence ; chaque aspect séparément', () => {
    const references = new Map([[4, ref(4, { is_hopt: true, nonengine_set: true, availability: 'reactive', group_name: null })], [1, ref(1, { is_hopt: false })]]);
    // Droll : HOPT et profil de référence.
    expect(effectiveOf(raw({ references }), 4, DROLL)).toMatchObject({ isHopt: true, profile: { availability: 'reactive', groupId: null }, origin: { hopt: 'reference', nonengine: 'reference' } });
    // Ash : HOPT retiré par référence, profil toujours détecté (aspect non touché par la référence).
    expect(effectiveOf(raw({ references }), 1, ASH)).toMatchObject({ isHopt: false, profile: { availability: 'flexible', groupId: null }, origin: { hopt: 'reference', nonengine: 'detection' } });
    // Référence « pas non-engine » explicite : profil null, origine référence.
    const none = new Map([[1, ref(1, { nonengine_set: true, availability: null })]]);
    expect(effectiveOf(raw({ references: none }), 1, ASH)).toMatchObject({ isHopt: true, profile: null, origin: { hopt: 'detection', nonengine: 'reference' } });
    // Choix HOPT explicite (true / false) et choix non-engine matérialisé (avec ou sans profil).
    const choices = new Map([[4, { card_id: 4, is_hopt: false, nonengine_choice: true }], [1, { card_id: 1, is_hopt: null, nonengine_choice: true }]]);
    const chosenProfiles = new Map([[1, { availability: 'early' as const, groupId: 'g-m' }]]);
    expect(effectiveOf(raw({ references, choices, chosenProfiles }), 4, DROLL)).toMatchObject({ isHopt: false, profile: null, origin: { hopt: 'choice', nonengine: 'choice' }, inherited: { availability: null, group_name: null } });
    expect(effectiveOf(raw({ references, choices, chosenProfiles }), 1, ASH)).toMatchObject({ isHopt: false, profile: { availability: 'early', groupId: 'g-m' }, origin: { hopt: 'reference', nonengine: 'choice' }, inherited: { availability: 'early', group_name: 'Mulcharmy' } });
  });

  it('`inherited` décrit ce que le serveur matérialisera : la valeur effective courante, par son nom de plafond', () => {
    expect(effectiveOf(raw(), 2, FUWALOS).inherited).toEqual({ availability: 'early', group_name: 'Mulcharmy' });
    const references = new Map([[2, ref(2, { nonengine_set: true, availability: 'flexible', group_name: 'Mulcharmy' })]]);
    expect(effectiveOf(raw({ references }), 2, FUWALOS).inherited).toEqual({ availability: 'flexible', group_name: 'Mulcharmy' });
  });
});

describe('effectiveLibrary — ensembles', () => {
  it('produit hopt, profils et origines pour les cartes demandées seulement', () => {
    const lib = effectiveLibrary(raw({ choices: new Map([[3, { card_id: 3, is_hopt: true, nonengine_choice: false }]]) }), cards, [1, 2, 3, 3]);
    expect([...lib.hopt].sort()).toEqual([1, 3]);
    expect([...lib.profiles.keys()].sort()).toEqual([1, 2]);
    expect(lib.origin.get(3)).toEqual({ hopt: 'choice', nonengine: null });
    expect(lib.origin.has(4)).toBe(false);
  });
});

describe('sourceFromDetail — les consommateurs hors éditeur appliquent la bibliothèque effective',() => {
  it('accueil, comparateur et fiche : détection, référence et choix entrent dans le modèle du moteur',async () => {
    const { sourceFromDetail } = await import('./deckConfiguration.js');
    const { buildEngineModel } = await import('./engineModel.js');
    const { emptyConfiguration } = await import('../../../server/src/domain/deckConfiguration.js');
    const c = emptyConfiguration('D',[{ card_id:1,zone:'main',copies:3 },{ card_id:2,zone:'main',copies:3 },{ card_id:3,zone:'main',copies:3 }]);
    const detail = { id:'d',revision:1,configuration_version:2 as const,name:c.name,cards:c.cards,starters:c.starters,pairs:c.pairs,pair_exclusions:[],conditions:c.conditions,deadFirst:c.deadFirst,deadSecond:c.deadSecond,params:c.params };
    const library = { hoptCardIds:[],categories:[],cardCategories:[],profiles:[],groups:[{ id:'g-m',name:'Mulcharmy',cap_per_turn:2,is_builtin:true }],choices:[],references:[],referencesVersion:'0' };
    const source = sourceFromDetail(detail,library,cards);
    expect([...source.hopt]).toEqual([1]);
    expect(source.profiles.get(2)).toEqual({ availability:'early',groupId:'g-m' });
    expect(buildEngineModel(source).input).not.toEqual(buildEngineModel(sourceFromDetail(detail,library,{})).input);
    // Une référence « pas HOPT » l'emporte sur la détection.
    const referenced = sourceFromDetail(detail,{ ...library,references:[ref(1,{ is_hopt:false })] },cards);
    expect(referenced.hopt.has(1)).toBe(false);
  });
});
