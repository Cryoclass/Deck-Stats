import { describe, expect, it } from 'vitest';
import { applyPlan, planFingerprint, sidedSource, type AppliedPlan, type PlanDeck } from './sidePlan.js';
import { buildEngineModel } from './engineModel.js';
import { libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { parseConfiguration } from '../../../server/src/domain/deckConfiguration.js';
import { MAX_COPIES } from './ydk.js';
import type { DeckCard, Library, SidePlan } from '../types.js';

// ─── Plans de side v2, D15 : non-régression prouvée, pas supposée ───
// Un plan existant garde exactement son statut, son main dérivé, son entrée du moteur et son
// empreinte (docs/plans-de-side-v2.md, invariant du prompt). La référence est l'`applyPlan` d'AVANT
// la refonte (commit 471fadd), recopié ici — comme `scripts/recompute-check.ts` fige l'ancien
// moteur — et jamais adapté au nouveau code. Tout plan sans carte d'Extra Deck, dont toutes les cartes
// sont de type main deck, doit rendre la même chose des deux côtés.

type LegacyIssue =
  | { kind: 'outgoing-missing'; cardId: number; wanted: number; available: number }
  | { kind: 'incoming-missing'; cardId: number; wanted: number; available: number }
  | { kind: 'over-limit'; cardId: number; copies: number };
interface LegacyApplied { status: 'ready' | 'incomplete' | 'review'; issues: LegacyIssue[]; outgoing: number; incoming: number; mainSize: number; main: DeckCard[] | null }

/** Copie figée de `applyPlan` au commit 471fadd (web/src/lib/sidePlan.ts:42-74) : logique identique ligne à
 *  ligne ; seules différences, les deux aides `copiesOf` / `totalOf` déplacées dans le corps et les types
 *  `PlanIssue` / `PlanStatus` renommés `LegacyIssue` / littéral pour ne pas dépendre du code courant. NE PAS MODIFIER. */
function legacyApplyPlan(main: readonly DeckCard[], side: readonly DeckCard[], plan: SidePlan): LegacyApplied {
  const copiesOf = (cards: readonly DeckCard[]) => new Map(cards.map((c) => [c.cardId, c.copies]));
  const totalOf = (list: SidePlan['outgoing']) => list.reduce((n, c) => n + c.copies, 0);
  const inMain = copiesOf(main);
  const inSide = copiesOf(side);
  const issues: LegacyIssue[] = [];
  for (const c of plan.outgoing) {
    const available = inMain.get(c.card_id) ?? 0;
    if (c.copies > available) issues.push({ kind: 'outgoing-missing', cardId: c.card_id, wanted: c.copies, available });
  }
  for (const c of plan.incoming) {
    const available = inSide.get(c.card_id) ?? 0;
    if (c.copies > available) issues.push({ kind: 'incoming-missing', cardId: c.card_id, wanted: c.copies, available });
  }
  const leaving = new Map(plan.outgoing.map((c) => [c.card_id, c.copies]));
  const entering = new Map(plan.incoming.map((c) => [c.card_id, c.copies]));
  const derived: DeckCard[] = [];
  for (const c of main) {
    const copies = c.copies - (leaving.get(c.cardId) ?? 0) + (entering.get(c.cardId) ?? 0);
    if (copies > 0) derived.push({ cardId: c.cardId, zone: 'main', copies });
  }
  for (const c of plan.incoming) if (!inMain.has(c.card_id)) derived.push({ cardId: c.card_id, zone: 'main', copies: c.copies });
  for (const c of derived) if (c.copies > MAX_COPIES) issues.push({ kind: 'over-limit', cardId: c.cardId, copies: c.copies });
  const outgoing = totalOf(plan.outgoing);
  const incoming = totalOf(plan.incoming);
  const mainSize = main.reduce((n, c) => n + c.copies, 0) - outgoing + incoming;
  const status = issues.length > 0 ? 'review' : outgoing !== incoming ? 'incomplete' : 'ready';
  return { status, issues, outgoing, incoming, mainSize, main: status === 'ready' ? derived : null };
}

const MAIN_ONLY = () => 'main' as const;

/** Les deux implémentations doivent coïncider sur tout ce qui existait avant la refonte. */
function expectSame(deck: PlanDeck, plan: SidePlan, label: string): AppliedPlan {
  const legacy = legacyApplyPlan(deck.main, deck.side, plan);
  const next = applyPlan(deck, plan, MAIN_ONLY);
  expect(next.status, label).toBe(legacy.status);
  expect(next.main, label).toEqual(legacy.main);
  expect(next.mainSize, label).toBe(legacy.mainSize);
  expect(next.outgoing, label).toBe(legacy.outgoing);
  expect(next.incoming, label).toBe(legacy.incoming);
  // Mêmes écarts, aux mêmes cartes, dans le même ordre (la zone `main` en plus est la seule différence de forme).
  expect(next.issues.map((i) => ('zone' in i ? (({ zone: _zone, ...rest }) => rest)(i) : i)), label).toEqual(legacy.issues);
  return next;
}

// ─── Fixture e2e : Deck A (setup.mjs) avec le side de side.mjs et de sidesheet.mjs ───
const DECK_A: Array<[number, number]> = [
  [90000001, 3], [90000002, 3], [90000003, 3], [90000004, 3], [90000005, 3], [90000006, 3],
  [90000007, 3], [90000008, 3], [90000009, 2], [90000010, 2], [90000011, 3], [90000012, 3],
  [90000013, 3], [90000014, 2], [90000015, 1],
];
const RHO = 90000017, LAMBDA = 90000011, MU = 90000012, NU = 90000013, OMICRON = 90000015, IOTA = 90000009;
const main = DECK_A.map(([cardId, copies]): DeckCard => ({ cardId, zone: 'main', copies }));
const sideOfSideScenario: DeckCard[] = [{ cardId: RHO, zone: 'side', copies: 3 }, { cardId: LAMBDA, zone: 'side', copies: 1 }];
const sideOfSheetScenario: DeckCard[] = [{ cardId: RHO, zone: 'side', copies: 3 }, { cardId: OMICRON, zone: 'side', copies: 2 }, { cardId: IOTA, zone: 'side', copies: 1 }];

const FIXTURE_PLANS: Array<{ label: string; deck: PlanDeck; plan: SidePlan }> = [
  { label: 'side.mjs : Mu ×1 sort, Rho ×1 entre (second)', deck: { main, extra: [], side: sideOfSideScenario }, plan: { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 1 }], incoming: [{ card_id: RHO, copies: 1 }] } },
  { label: 'side.mjs : état intermédiaire −2 / +2', deck: { main, extra: [], side: sideOfSideScenario }, plan: { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 2 }], incoming: [{ card_id: RHO, copies: 2 }] } },
  { label: 'side.mjs : −2 / +1, incomplet', deck: { main, extra: [], side: sideOfSideScenario }, plan: { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 2 }], incoming: [{ card_id: RHO, copies: 1 }] } },
  { label: 'side.mjs : Lambda entrant (main 3 + side 1) → à revoir', deck: { main, extra: [], side: sideOfSideScenario }, plan: { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 1 }], incoming: [{ card_id: LAMBDA, copies: 1 }] } },
  { label: 'sidesheet.mjs : premier (Mu, Nu, Lambda sortent ; Rho, Omicron, Iota entrent)', deck: { main, extra: [], side: sideOfSheetScenario }, plan: { position: 'first', note: 'n', outgoing: [{ card_id: MU, copies: 1 }, { card_id: NU, copies: 1 }, { card_id: LAMBDA, copies: 1 }], incoming: [{ card_id: RHO, copies: 1 }, { card_id: OMICRON, copies: 1 }, { card_id: IOTA, copies: 1 }] } },
  { label: 'sidesheet.mjs : second (Mu ×2, Nu ×1 sortent ; Rho ×2, Omicron ×1 entrent)', deck: { main, extra: [], side: sideOfSheetScenario }, plan: { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 2 }, { card_id: NU, copies: 1 }], incoming: [{ card_id: RHO, copies: 2 }, { card_id: OMICRON, copies: 1 }] } },
  { label: 'sidesheet.mjs : Snake-Eye second (3 sortent, 2 entrent), incomplet', deck: { main, extra: [], side: sideOfSheetScenario }, plan: { position: 'second', note: null, outgoing: [{ card_id: MU, copies: 2 }, { card_id: NU, copies: 1 }], incoming: [{ card_id: RHO, copies: 2 }] } },
  { label: 'plan vide', deck: { main, extra: [], side: sideOfSheetScenario }, plan: { position: 'first', note: null, outgoing: [], incoming: [] } },
];

describe('D15 — un plan existant rend exactement ce qu’il rendait (fixtures e2e)', () => {
  for (const { label, deck, plan } of FIXTURE_PLANS) {
    it(label, () => {
      expectSame(deck, plan, label);
    });
  }

  it('même entrée du moteur et même empreinte pour les plans prêts de la fixture', () => {
    const library: Library = {
      hoptCardIds: [90000005, 90000006], categories: [{ id: 'ht', name: 'Handtrap', is_builtin: true }],
      cardCategories: [{ card_id: 90000005, category_id: 'ht' }, { card_id: 90000006, category_id: 'ht' }, { card_id: RHO, category_id: 'ht' }],
      profiles: [{ card_id: 90000005, availability: 'flexible', group_id: null }, { card_id: 90000006, availability: 'flexible', group_id: null }, { card_id: RHO, availability: 'reactive', group_id: null }],
      groups: [],
    };
    for (const { label, deck, plan } of FIXTURE_PLANS) {
      const config = parseConfiguration({ version: 2, name: 'A', cards: [...deck.main, ...deck.side].map((c) => ({ card_id: c.cardId, zone: c.zone, copies: c.copies })), starters: [90000001, 90000002, RHO], pairs: [{ id: '00000000-0000-4000-8000-000000000001', card_a_id: 90000003, card_b_id: 90000004, disabled: false }], conditions: [{ id: '00000000-0000-4000-8000-000000000002', source_card_id: 90000002, source_pair_id: null, condition: { kind: 'remaining', card_id: 90000014, at_least: 1 } }], deadFirst: [], deadSecond: [], params: {}, notes: null });
      const source = { ...stateFromConfiguration(config), ...libraryState(library) };
      const legacy = legacyApplyPlan(source.main, source.side, plan);
      const next = applyPlan(source, plan, MAIN_ONLY);
      if (legacy.main === null) {
        expect(next.main, label).toBeNull();
        continue;
      }
      const legacyInput = buildEngineModel({ ...source, main: legacy.main }).input;
      const nextInput = buildEngineModel(sidedSource(source, next)!).input;
      expect(nextInput, label).toEqual(legacyInput);
      expect(planFingerprint(nextInput, plan.position, 'v1'), label).toBe(planFingerprint(legacyInput, plan.position, 'v1'));
    }
  });
});

// ─── Plans synthétiques : générateur déterministe (LCG), tous les statuts atteints ───
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('D15 — plans synthétiques sans carte d’Extra : mêmes statuts, mêmes mains dérivés', () => {
  const rnd = lcg(20260922);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const seen = { ready: 0, incomplete: 0, review: 0 };

  it('500 plans tirés au sort : statut, main dérivé, taille et écarts identiques', () => {
    for (let n = 0; n < 500; n++) {
      // Deck : 12 à 18 cartes de main (1–3 copies), 3 à 6 cartes de side, dont parfois une carte déjà en main (9C).
      const mainIds = Array.from({ length: int(12, 18) }, (_, i) => 100 + i);
      const deckMain: DeckCard[] = mainIds.map((cardId) => ({ cardId, zone: 'main', copies: int(1, 3) }));
      const sideIds = [...Array.from({ length: int(2, 5) }, (_, i) => 200 + i), ...(rnd() < 0.5 ? [pick(mainIds)] : [])];
      const deckSide: DeckCard[] = sideIds.map((cardId) => ({ cardId, zone: 'side', copies: int(1, 3) }));
      const deck: PlanDeck = { main: deckMain, extra: [], side: deckSide };
      // Plan : 0–4 sortantes prises dans le main (ou une carte absente, 10 %), 0–4 entrantes prises dans le side.
      const outgoing = Array.from({ length: int(0, 4) }, () => ({ card_id: rnd() < 0.1 ? 999 : pick(mainIds), copies: int(1, 3) }));
      const incoming = Array.from({ length: int(0, 4) }, () => ({ card_id: rnd() < 0.1 ? 998 : pick(sideIds), copies: int(1, 3) }));
      const dedupe = (list: typeof outgoing) => [...new Map(list.map((c) => [c.card_id, c])).values()];
      const out = dedupe(outgoing);
      const inn = dedupe(incoming).filter((c) => !out.some((o) => o.card_id === c.card_id)); // R2 : jamais des deux côtés
      const plan: SidePlan = { position: pick(['first', 'second'] as const), note: null, outgoing: out, incoming: inn };
      const next = expectSame(deck, plan, `plan synthétique #${n}`);
      seen[next.status] += 1;
    }
    // Le tirage a bien exercé les trois statuts.
    expect(seen.ready).toBeGreaterThan(20);
    expect(seen.incomplete).toBeGreaterThan(20);
    expect(seen.review).toBeGreaterThan(20);
  });
});
