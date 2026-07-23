import { describe, it, expect } from 'vitest';
import { prepare, evaluate } from './evaluate.js';
import { computePass, computeAll } from './enumerate.js';
import { binom } from './binomial.js';
import type { EngineInput, EngineType } from './types.js';

// Helpers ---------------------------------------------------------------
const T = (over: Partial<EngineType> = {}): EngineType => ({
  copies: 1,
  isHopt: false,
  isStarter: false,
  categories: [],
  ...over,
});

// ─── §C — Valeurs de contrôle (hypergéométrique via un starter 1-carte) ───
// Un starter non-HOPT donne starts = nombre de copies en main, donc
// P(≥1 start) = P(≥1 copie) et P(starts=k) = P(exactement k copies).
//
// On compare la PROBABILITÉ exacte (indépendamment recalculée par binômes), pas
// l'affichage à 2 décimales : deux lignes de §C sont des arrondis ambigus.
//  - « 33,75 % » : la valeur exacte est 222111/658008 = 33,7551 %, qui s'arrondit
//    à 33,76 % (arrondi au plus proche). §C a tronqué la demi-unité.
//  - « 3,29 % » pour P(exactement 2) est une coquille : la valeur exacte est
//    C(3,2)·C(37,3)/C(40,5) = 3,5425 %. Les autres lignes matchent. (Signalé.)
describe('§C — valeurs de contrôle hypergéométriques', () => {
  it('Deck 40, 3 copies, main 5, P(≥1 copie) [§C: 33,75 % → exact 33,7551 %]', () => {
    const input: EngineInput = {
      deckSize: 40,
      types: [T({ copies: 3, isStarter: true })],
      edges: [],
      categories: [],
    };
    const r = computePass(input, 5);
    const exact = 1 - binom(37, 5) / binom(40, 5); // = 0.3375506… (§C: « 33,75 % »)
    expect(1 - r.brick).toBeCloseTo(exact, 12);
    expect(1 - r.brick).toBeCloseTo(0.33755, 4);
  });

  it('Deck 40, 3 copies, main 6, P(≥1 copie) = 39,43 %', () => {
    const input: EngineInput = {
      deckSize: 40,
      types: [T({ copies: 3, isStarter: true })],
      edges: [],
      categories: [],
    };
    const r = computePass(input, 6);
    const exact = 1 - binom(37, 6) / binom(40, 6);
    expect(1 - r.brick).toBeCloseTo(exact, 12);
    expect(1 - r.brick).toBeCloseTo(0.3943, 4);
  });

  it('Deck 40, 1 copie, main 5, P(la voir) = 12,50 %', () => {
    const input: EngineInput = {
      deckSize: 40,
      types: [T({ copies: 1, isStarter: true })],
      edges: [],
      categories: [],
    };
    const r = computePass(input, 5);
    expect(1 - r.brick).toBeCloseTo(0.125, 12);
  });

  it('Deck 40, 3 copies, main 5, P(exactement 2 copies) = 3,54 % [§C: 3,29 %, coquille]', () => {
    const input: EngineInput = {
      deckSize: 40,
      types: [T({ copies: 3, isStarter: true })],
      edges: [],
      categories: [],
    };
    const r = computePass(input, 5);
    const exact = (binom(3, 2) * binom(37, 3)) / binom(40, 5); // = 0.0354251… (3,54 %)
    expect(r.startsExact[2]).toBeCloseTo(exact, 12);
    expect(r.startsExact[2]).toBeCloseTo(0.0354, 4);
  });

  it('La distribution des starts somme à 1', () => {
    const input: EngineInput = {
      deckSize: 40,
      types: [T({ copies: 3, isStarter: true }), T({ copies: 2 }), T({ copies: 1 })],
      edges: [[1, 2]],
      categories: [],
    };
    const r = computePass(input, 6);
    const sum = r.startsExact.reduce((s, p) => s + (p ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(r.startsBuckets.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
  });

  it('Deck sans aucune annotation : 0 start partout, aucun crash', () => {
    const input: EngineInput = { deckSize: 40, types: [], edges: [], categories: [] };
    const r5 = computePass(input, 5);
    const r6 = computePass(input, 6);
    expect(r5.brick).toBeCloseTo(1, 10);
    expect(r6.brick).toBeCloseTo(1, 10);
    expect(r5.meanStarts).toBe(0);
    expect(() => computeAll(input)).not.toThrow();
  });
});

// ─── §C — Cas de couplage (test décisif du modèle, dont HOPT) ───
describe('§C — couplage maximum & redondance', () => {
  // Types : Saji=0, Murakumo=1, Ritual=2, Habakiri=3.
  const evalHand = (
    types: EngineType[],
    edges: Array<[number, number]>,
    k: number[],
  ) => {
    const prep = prepare({ deckSize: 40, types, edges, categories: [] });
    return evaluate(prep, k, prep.deadFirst); // aucune carte morte par défaut
  };

  it('Saji, Murakumo, Ritual → 1 start, redondance 2', () => {
    const out = evalHand(
      [T(), T(), T(), T({ copies: 0 })],
      [
        [0, 1],
        [2, 1],
      ],
      [1, 1, 1, 0],
    );
    expect(out.starts).toBe(1);
    expect(out.redundancy).toBe(2);
  });

  it('+ Habakiri, + Saji+Habakiri → 2 starts, redondance 3', () => {
    const out = evalHand(
      [T(), T(), T(), T()],
      [
        [0, 1],
        [2, 1],
        [0, 3],
      ],
      [1, 1, 1, 1],
    );
    expect(out.starts).toBe(2);
    expect(out.redundancy).toBe(3);
  });

  it('2× Murakumo (non-HOPT), Saji, Ritual → 2 starts, redondance 4', () => {
    const out = evalHand(
      [T(), T({ copies: 2 }), T(), T({ copies: 0 })],
      [
        [0, 1],
        [2, 1],
      ],
      [1, 2, 1, 0],
    );
    expect(out.starts).toBe(2);
    expect(out.redundancy).toBe(4);
  });

  it('2× Murakumo (HOPT), Saji, Ritual → 1 start, redondance 2 (test décisif)', () => {
    const out = evalHand(
      [T(), T({ copies: 2, isHopt: true }), T(), T({ copies: 0 })],
      [
        [0, 1],
        [2, 1],
      ],
      [1, 2, 1, 0],
    );
    expect(out.starts).toBe(1);
    expect(out.redundancy).toBe(2);
  });
});

// ─── Couplage maximum : couvre le cas où starter + paire n'a pas d'arbitrage ───
describe('§B.3 — starter solo aussi pièce de paire', () => {
  it('A starter solo + paire A-B, main {A,B} → 2 starts (A seul + B libéré ? non, B seul non couplé)', () => {
    // A=0 (starter solo, aussi paire avec B=1). Main = A, B.
    // Étape 2 retire A (starter) → +1. B reste seul, pas de couplage → total 1.
    const prep = prepare({
      deckSize: 40,
      types: [T({ isStarter: true }), T()],
      edges: [[0, 1]],
      categories: [],
    });
    const out = evaluate(prep, [1, 1], prep.deadFirst);
    expect(out.starts).toBe(1);
    expect(out.redundancy).toBe(1); // le combo A-B est présent
  });
});

// ─── Lot C — cartes mortes selon la position ───
describe('Lot C — dead_first / dead_second (traitées comme filler)', () => {
  it('une carte dead_first ne compte ni comme starter ni comme sommet going first', () => {
    // Type 0 : starter solo mais mort going first. Type 1 : combote avec 0.
    const prep = prepare({
      deckSize: 40,
      types: [
        T({ isStarter: true, deadFirst: true }),
        T({}),
      ],
      edges: [[0, 1]],
      categories: [],
    });
    // Going first : 0 est filler → pas de start, pas d'arête utilisable.
    expect(evaluate(prep, [1, 1], prep.deadFirst).starts).toBe(0);
    expect(evaluate(prep, [1, 1], prep.deadFirst).redundancy).toBe(0);
    // Going second : 0 est vivant → starter compte.
    expect(evaluate(prep, [1, 1], prep.deadSecond).starts).toBe(1);
  });

  it('dead_first n’affecte pas le comptage non-engine (régi par la catégorie)', () => {
    const prep = prepare({
      deckSize: 40,
      types: [T({ deadFirst: true, categories: [0] })],
      edges: [],
      categories: [{ id: 'ht', relevance: 'both' }],
    });
    // Morte pour le graphe, mais toujours comptée comme handtrap going first.
    const out = evaluate(prep, [1], prep.deadFirst);
    expect(out.catCounts[0]).toBe(1);
    expect(out.neFirst).toBe(1);
  });
});

// ─── Lot A (itération 2) — horizon d'interaction : plafond HOPT du non-engine ───
describe('Lot A — horizon d’interaction (plafond HOPT non-engine, §B.3.5)', () => {
  // Carte X : HOPT, catégorie de pertinence `both`, seule annotation du deck.
  // Défauts d'horizon : going first = 1, going second = 2.
  const xPrep = (over: Partial<EngineType> = {}) =>
    prepare({
      deckSize: 40,
      types: [T({ copies: 3, isHopt: true, categories: [0], ...over })],
      edges: [],
      categories: [{ id: 'x', relevance: 'both' }],
    });

  it('Carte X HOPT, going first (horizon 1) : 1/2/3 copies → toujours 1 non-engine', () => {
    const prep = xPrep();
    expect(evaluate(prep, [1], prep.deadFirst).neFirst).toBe(1);
    expect(evaluate(prep, [2], prep.deadFirst).neFirst).toBe(1);
    expect(evaluate(prep, [3], prep.deadFirst).neFirst).toBe(1);
  });

  it('Carte X HOPT, going second (horizon 2) : 2 → 2, 3 → 2', () => {
    const prep = xPrep();
    expect(evaluate(prep, [1], prep.deadSecond).neSecond).toBe(1);
    expect(evaluate(prep, [2], prep.deadSecond).neSecond).toBe(2);
    expect(evaluate(prep, [3], prep.deadSecond).neSecond).toBe(2);
  });

  it('Carte Y NON-HOPT : le plafond ne s’applique jamais (3 → 3 aux deux passes)', () => {
    const prep = prepare({
      deckSize: 40,
      types: [T({ copies: 3, isHopt: false, categories: [0] })],
      edges: [],
      categories: [{ id: 'y', relevance: 'both' }],
    });
    const out = evaluate(prep, [3], prep.deadFirst);
    expect(out.neFirst).toBe(3);
    expect(out.neSecond).toBe(3);
  });

  it('Horizon réglable : first=2 → 3 copies HOPT plafonnées à 2 ; valeurs hors [1,3] bornées', () => {
    const prep2 = prepare({
      deckSize: 40,
      types: [T({ copies: 3, isHopt: true, categories: [0] })],
      edges: [],
      categories: [{ id: 'x', relevance: 'both' }],
      horizonFirst: 2,
      horizonSecond: 3,
    });
    expect(evaluate(prep2, [3], prep2.deadFirst).neFirst).toBe(2);
    expect(evaluate(prep2, [3], prep2.deadSecond).neSecond).toBe(3);

    // Horizon 5 → borné à 3 ; horizon 0 → borné à 1.
    const clamped = prepare({
      deckSize: 40,
      types: [T({ copies: 3, isHopt: true, categories: [0] })],
      edges: [],
      categories: [{ id: 'x', relevance: 'both' }],
      horizonFirst: 0,
      horizonSecond: 5,
    });
    expect(evaluate(clamped, [3], clamped.deadFirst).neFirst).toBe(1);
    expect(evaluate(clamped, [3], clamped.deadSecond).neSecond).toBe(3);
  });

  it('catCounts (ventilation par catégorie) reste en copies brutes, non plafonné', () => {
    const prep = xPrep();
    // 3 copies HOPT en main : le total non-engine plafonne à 1 (going first) mais la
    // ventilation par catégorie compte les 3 copies physiques (P(≥1) reste invariant).
    const out = evaluate(prep, [3], prep.deadFirst);
    expect(out.neFirst).toBe(1);
    expect(out.catCounts[0]).toBe(3);
  });

  it('Le plafond ne touche AUCUNE distribution de starts', () => {
    // Carte HOPT à la fois starter (graphe) et non-engine (catégorie) : changer
    // l'horizon déplace la distribution non-engine mais laisse les starts intacts.
    const base: EngineInput = {
      deckSize: 40,
      types: [T({ copies: 3, isHopt: true, isStarter: true, categories: [0] })],
      edges: [],
      categories: [{ id: 'x', relevance: 'both' }],
    };
    const h1 = computePass({ ...base, horizonFirst: 1 }, 5);
    const h3 = computePass({ ...base, horizonFirst: 3 }, 5);
    expect(h3.startsExact).toEqual(h1.startsExact); // starts strictement inchangés
    expect(h3.startsBuckets).toEqual(h1.startsBuckets);
    expect(h3.meanNonEngine).toBeGreaterThan(h1.meanNonEngine); // non-engine, lui, bouge
  });
});
