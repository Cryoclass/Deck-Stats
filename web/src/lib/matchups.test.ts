import { describe, expect, it } from 'vitest';
import { addMatchup, clearPlan, copyPlan, describeIssue, planOf, removeFromPlan, removeMatchup, renameMatchup, setPlanNote, swapInPlan, trySwap, undoSwap } from './matchups.js';
import { applyPlan } from './sidePlan.js';
import { parseConfiguration, emptyConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import type { DeckCard, Matchup, SidePlanCard } from '../types.js';

// ─── Étape 10C : mutations pures des adversaires et de leurs plans ───

const ASH = 1; // ×3 en main
const DROLL = 2; // ×1 en main
const FILLER = 3; // ×3 en main
const NIBIRU = 30; // ×2 en side
const RULER = 31; // ×3 en side
const BOTH = 4; // ×3 en main ET ×1 en side (9C)
const main: DeckCard[] = [{ cardId: ASH, zone: 'main', copies: 3 }, { cardId: DROLL, zone: 'main', copies: 1 }, { cardId: FILLER, zone: 'main', copies: 3 }, { cardId: BOTH, zone: 'main', copies: 3 }];
const side: DeckCard[] = [{ cardId: NIBIRU, zone: 'side', copies: 2 }, { cardId: RULER, zone: 'side', copies: 3 }, { cardId: BOTH, zone: 'side', copies: 1 }];
const name = (id: number) => `#${id}`;
// v2 : les échanges se jugent zone par zone ; ici toutes les cartes sont de type main deck (Extra en fin de fichier).
const MAIN = () => 'main' as const;
const deck = { main, extra: [], side };
const M = '00000000-0000-4000-8000-0000000000aa';
const start = (): Matchup[] => addMatchup([], '  Kewl Tune ', M);

describe('adversaires', () => {
  it('un adversaire naît avec ses deux volets vides, à la fin de la liste, nom élagué', () => {
    const list = addMatchup(start(), 'Snake-Eye', '00000000-0000-4000-8000-0000000000bb');
    expect(list.map((m) => [m.name, m.sort_index])).toEqual([['Kewl Tune', 0], ['Snake-Eye', 1]]);
    expect(list[0].plans).toEqual([{ position: 'first', note: null, outgoing: [], incoming: [] }, { position: 'second', note: null, outgoing: [], incoming: [] }]);
    // Le document produit passe le contrat tel quel.
    expect(parseConfiguration({ ...emptyConfiguration('X'), matchups: list }).matchups).toEqual(list);
    expect(renameMatchup(list, M, ' Tune ')[0].name).toBe('Tune');
    expect(removeMatchup(list, M).map((m) => m.name)).toEqual(['Snake-Eye']);
  });
});

describe('échanger', () => {
  const swap = (list: Matchup[], out: Array<[number, number]>, inn: Array<[number, number]>) =>
    swapInPlan(list, M, 'second', deck, MAIN, { outgoing: out.map(([card_id, copies]) => ({ card_id, copies })), incoming: inn.map(([card_id, copies]) => ({ card_id, copies })) }, name);

  it('ajoute les copies au plan et cumule une carte déjà engagée', () => {
    const once = swap(start(), [[ASH, 1], [DROLL, 1]], [[NIBIRU, 2]]);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = swap(once.matchups, [[ASH, 1]], [[RULER, 1]]);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    const plan = planOf(twice.matchups[0], 'second');
    expect(plan.outgoing).toEqual([{ card_id: ASH, copies: 2 }, { card_id: DROLL, copies: 1 }]);
    expect(plan.incoming).toEqual([{ card_id: NIBIRU, copies: 2 }, { card_id: RULER, copies: 1 }]);
    expect(planOf(twice.matchups[0], 'first').outgoing).toEqual([]); // l'autre volet n'a pas bougé
    expect(applyPlan(deck, plan, MAIN).status).toBe('ready');
  });

  it('refuse une sélection déséquilibrée ou vide (D10), sans rien changer', () => {
    const list = start();
    expect(swap(list, [[ASH, 2]], [[NIBIRU, 1]])).toEqual({ ok: false, reason: 'Échange refusé : 2 copies sortantes pour 1 entrante — il en faut autant de chaque côté.' });
    expect(swap(list, [], []).ok).toBe(false);
    expect(planOf(list[0], 'second').outgoing).toEqual([]);
  });

  it('refuse une carte qui entrerait et sortirait du même plan (R2)', () => {
    const r = swap(start(), [[BOTH, 1]], [[BOTH, 1]]);
    expect(r).toEqual({ ok: false, reason: 'Échange refusé : #4 entrerait et sortirait du même plan.' });
  });

  it('refuse un échange qui crée un écart avec les zones (R1, R3), en le nommant', () => {
    expect(swap(start(), [[DROLL, 2]], [[NIBIRU, 2]])).toEqual({ ok: false, reason: 'Échange refusé — #2 : 2 copies à sortir, 1 en main.' });
    expect(swap(start(), [[FILLER, 1]], [[BOTH, 1]])).toEqual({ ok: false, reason: 'Échange refusé — #4 : 4 copies dans le main après échange — convention 1 à 3.' });
    const first = swap(start(), [[ASH, 2]], [[NIBIRU, 2]]);
    if (!first.ok) throw new Error(first.reason);
    expect(swap(first.matchups, [[FILLER, 1]], [[NIBIRU, 1]])).toEqual({ ok: false, reason: 'Échange refusé — #30 : 3 copies à faire entrer, 2 en side.' });
  });

  it('un plan déjà « à revoir » accepte un échange qui n’aggrave rien', () => {
    const stale: Matchup[] = [{ ...start()[0], plans: [{ position: 'second', note: null, outgoing: [{ card_id: 99, copies: 1 }], incoming: [{ card_id: NIBIRU, copies: 1 }] }] }];
    expect(applyPlan(deck, planOf(stale[0], 'second'), MAIN).status).toBe('review');
    const r = swap(stale, [[ASH, 1]], [[RULER, 1]]);
    expect(r.ok).toBe(true);
  });
});

describe('retoucher un plan', () => {
  const ready = (): Matchup[] => {
    const r = swapInPlan(start(), M, 'second', deck, MAIN, { outgoing: [{ card_id: ASH, copies: 2 }], incoming: [{ card_id: NIBIRU, copies: 2 }] }, name);
    if (!r.ok) throw new Error(r.reason);
    return r.matchups;
  };

  it('retirer une copie rend le plan « incomplet », sans rééquilibrage silencieux (D11)', () => {
    const list = removeFromPlan(ready(), M, 'second', 'incoming', NIBIRU);
    const plan = planOf(list[0], 'second');
    expect(plan.incoming).toEqual([{ card_id: NIBIRU, copies: 1 }]);
    expect(plan.outgoing).toEqual([{ card_id: ASH, copies: 2 }]);
    expect(applyPlan(deck, plan, MAIN).status).toBe('incomplete');
    expect(planOf(removeFromPlan(list, M, 'second', 'incoming', NIBIRU)[0], 'second').incoming).toEqual([]);
  });

  it('note : vide = null ; recopie premier ← second : copie indépendante, note comprise', () => {
    const noted = setPlanNote(ready(), M, 'second', 'Attention au Droll');
    expect(planOf(noted[0], 'second').note).toBe('Attention au Droll');
    expect(planOf(setPlanNote(noted, M, 'second', '   ')[0], 'second').note).toBeNull();
    const copied = copyPlan(noted, M, 'second', 'first');
    expect(planOf(copied[0], 'first')).toEqual({ ...planOf(noted[0], 'second'), position: 'first' });
    expect(copied[0].plans.map((p) => p.position)).toEqual(['first', 'second']);
    const edited = removeFromPlan(copied, M, 'first', 'outgoing', ASH);
    expect(planOf(edited[0], 'second').outgoing).toEqual([{ card_id: ASH, copies: 2 }]); // la source n'a pas bougé
  });

  it('les messages d’écart nomment la carte et la zone', () => {
    expect(describeIssue({ kind: 'outgoing-missing', cardId: 7, zone: 'main', wanted: 1, available: 0 }, name)).toBe('#7 : 1 copie à sortir, 0 en main.');
    expect(describeIssue({ kind: 'outgoing-missing', cardId: 7, zone: 'extra', wanted: 2, available: 1 }, name)).toBe('#7 : 2 copies à sortir, 1 en extra.');
    expect(describeIssue({ kind: 'incoming-missing', cardId: 8, zone: 'main', wanted: 3, available: 2 }, name)).toBe('#8 : 3 copies à faire entrer, 2 en side.');
    expect(describeIssue({ kind: 'over-limit', cardId: 9, zone: 'extra', copies: 4 }, name)).toBe('#9 : 4 copies dans le extra après échange — convention 1 à 3.');
    expect(describeIssue({ kind: 'unknown-zone', cardId: 5 }, name)).toBe('#5 : zone inconnue (type de carte absent du catalogue) — main ou extra ?');
  });
});

describe('v2 — annuler un échange, vider le plan (D13)', () => {
  const twoSwaps = (): { list: Matchup[]; first: { outgoing: SidePlanCard[]; incoming: SidePlanCard[] } } => {
    const first = { outgoing: [{ card_id: ASH, copies: 2 }], incoming: [{ card_id: NIBIRU, copies: 2 }] };
    const a = swapInPlan(start(), M, 'second', deck, MAIN, first, name);
    if (!a.ok) throw new Error(a.reason);
    const b = swapInPlan(a.matchups, M, 'second', deck, MAIN, { outgoing: [{ card_id: ASH, copies: 1 }, { card_id: DROLL, copies: 1 }], incoming: [{ card_id: RULER, copies: 2 }] }, name);
    if (!b.ok) throw new Error(b.reason);
    return { list: b.matchups, first };
  };

  it('annuler le premier échange retire exactement ses copies, le second reste', () => {
    const { list, first } = twoSwaps();
    const undone = planOf(undoSwap(list, M, 'second', first)[0], 'second');
    expect(undone.outgoing).toEqual([{ card_id: ASH, copies: 1 }, { card_id: DROLL, copies: 1 }]);
    expect(undone.incoming).toEqual([{ card_id: RULER, copies: 2 }]);
    expect(applyPlan(deck, undone, MAIN).status).toBe('ready');
  });

  it('annuler après une retouche : jamais sous zéro, le plan peut rester incomplet — rien n’est rééquilibré', () => {
    const { list, first } = twoSwaps();
    const retouched = removeFromPlan(list, M, 'second', 'outgoing', ASH, 2); // 2 des 3 Ash retirées à la main : il en reste 1
    const undone = planOf(undoSwap(retouched, M, 'second', first)[0], 'second');
    expect(undone.outgoing).toEqual([{ card_id: DROLL, copies: 1 }]); // 1 − 2 ne donne pas « −1 copie » : la carte disparaît
    expect(undone.incoming).toEqual([{ card_id: RULER, copies: 2 }]);
    expect(applyPlan(deck, undone, MAIN).status).toBe('incomplete');
  });

  it('vider le plan retire tous les échanges et garde la note ; l’autre volet ne bouge pas', () => {
    const { list } = twoSwaps();
    const noted = setPlanNote(copyPlan(list, M, 'second', 'first'), M, 'second', 'Garder Droll');
    const cleared = clearPlan(noted, M, 'second');
    expect(planOf(cleared[0], 'second')).toEqual({ position: 'second', note: 'Garder Droll', outgoing: [], incoming: [] });
    expect(planOf(cleared[0], 'first').outgoing).toEqual([{ card_id: ASH, copies: 3 }, { card_id: DROLL, copies: 1 }]);
    expect(applyPlan(deck, planOf(cleared[0], 'second'), MAIN).status).toBe('ready');
  });

  it('retirer toutes les copies d’une carte d’un coup (liste « Sort » / « Entre »)', () => {
    const { list } = twoSwaps();
    expect(planOf(removeFromPlan(list, M, 'second', 'outgoing', ASH, Infinity)[0], 'second').outgoing).toEqual([{ card_id: DROLL, copies: 1 }]);
  });
});

describe('v2 — un échange reste dans sa zone (S5, S6)', () => {
  const FUSION = 40; // ×2 en extra
  const SIDE_FUSION = 41; // ×1 en side, type Extra Deck
  const zoneOf = (id: number) => (id === 999 ? null : id === FUSION || id === SIDE_FUSION ? ('extra' as const) : ('main' as const));
  const deck2 = { main, extra: [{ cardId: FUSION, zone: 'extra' as const, copies: 2 }], side: [...side, { cardId: SIDE_FUSION, zone: 'side' as const, copies: 1 }, { cardId: 999, zone: 'side' as const, copies: 1 }] };
  const swap2 = (delta: { outgoing: SidePlanCard[]; incoming: SidePlanCard[] }) => swapInPlan(start(), M, 'first', deck2, zoneOf, delta, name);

  it('une carte du main ne s’échange pas contre une carte d’Extra : refus nommé, zone par zone', () => {
    expect(swap2({ outgoing: [{ card_id: ASH, copies: 1 }], incoming: [{ card_id: SIDE_FUSION, copies: 1 }] })).toEqual({ ok: false, reason: 'Échange refusé : main 1 copie sortante pour 0 entrante ; extra 0 copie sortante pour 1 entrante — il en faut autant de chaque côté, zone par zone.' });
    expect(swap2({ outgoing: [{ card_id: FUSION, copies: 2 }], incoming: [{ card_id: SIDE_FUSION, copies: 1 }] })).toMatchObject({ ok: false, reason: expect.stringMatching(/^Échange refusé : extra 2 copies sortantes pour 1 entrante/) });
  });

  it('un échange d’Extra équilibré est accepté, seul ou avec un échange de main dans le même geste', () => {
    const alone = swap2({ outgoing: [{ card_id: FUSION, copies: 1 }], incoming: [{ card_id: SIDE_FUSION, copies: 1 }] });
    expect(alone.ok).toBe(true);
    if (!alone.ok) return;
    expect(applyPlan(deck2, planOf(alone.matchups[0], 'first'), zoneOf)).toMatchObject({ status: 'ready', zones: { main: { outgoing: 0, incoming: 0 }, extra: { outgoing: 1, incoming: 1 } } });
    const both = swap2({ outgoing: [{ card_id: FUSION, copies: 1 }, { card_id: ASH, copies: 1 }], incoming: [{ card_id: SIDE_FUSION, copies: 1 }, { card_id: NIBIRU, copies: 1 }] });
    expect(both.ok).toBe(true);
  });

  it('une carte de zone inconnue est refusée avant toute autre règle, nommée', () => {
    expect(swap2({ outgoing: [{ card_id: ASH, copies: 1 }], incoming: [{ card_id: 999, copies: 1 }] })).toEqual({ ok: false, reason: 'Échange refusé : #999 — zone inconnue (type de carte absent du catalogue), impossible de dire si la carte va au main ou à l’extra.' });
    expect(trySwap(planOf(start()[0], 'first'), deck2, zoneOf, { outgoing: [], incoming: [] }, name)).toEqual({ ok: false, reason: 'Échange refusé : aucune copie sélectionnée.' });
  });
});
