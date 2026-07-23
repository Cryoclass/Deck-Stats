export type Relevance = 'first' | 'second' | 'both';

/**
 * Prérequis en deck (itération 5) : une source de start (starter ou arête) exige
 * qu'il reste ≥ `minInDeck` copies de la carte requise DANS LE DECK (hors main).
 * copies restantes = requiredTotal − k[requiredType]. Si la carte requise est absente
 * du deck, `requiredType = null` et `requiredTotal = 0` → prérequis jamais satisfait.
 */
export interface Prereq {
  requiredType: number | null; // index dans types[] (ou null si carte absente du deck)
  requiredTotal: number; // copies totales de la carte requise dans le deck
  minInDeck: number; // ≥ 1
}

/** Un type de carte annotée présent dans le main deck. */
export interface EngineType {
  copies: number; // 1..3 présents dans le deck
  isHopt: boolean; // §2.3 : copies multiples → 1 seul sommet
  isStarter: boolean; // §2.1 : starter 1-carte
  categories: number[]; // index dans EngineInput.categories (§2.6)
  // Lot C : carte morte selon la position → traitée comme du filler pour la passe
  // concernée (ni starter, ni sommet du graphe). Le comptage non-engine reste régi
  // par la pertinence de catégorie, inchangé.
  deadFirst?: boolean;
  deadSecond?: boolean;
  // Itération 5 : prérequis en deck portant sur le RÔLE STARTER de ce type (ET).
  starterPrereqs?: Prereq[];
}

export interface EngineCategory {
  id: string;
  relevance: Relevance;
}

/** Entrée du moteur : deck + annotations, indépendant de l'UI. */
export interface EngineInput {
  deckSize: number; // 40..60 (§D). Extra/side jamais inclus.
  types: EngineType[];
  edges: Array<[number, number]>; // paires actives, index de types, i ≠ j
  // Itération 5 : prérequis en deck portant sur une ARÊTE (paire), aligné sur `edges`.
  // edgePrereqs[e] = prérequis (ET) de l'arête e ; absent/undefined = aucun.
  edgePrereqs?: Array<Prereq[] | undefined>;
  categories: EngineCategory[];
  // §B.3 étape 5 (itération 2) — horizon de tours d'interaction : nombre de tours
  // adverses pendant lesquels une carte HOPT non-engine reste activable. Plafonne le
  // comptage non-engine des cartes HOPT à `min(copies, horizon)`, PAR PASSE. Hypothèse
  // de jeu réglable (plage 1..3) ; défauts posés dans `prepare()` : first=1, second=2.
  // N'affecte JAMAIS le graphe de combos (une carte HOPT = 1 sommet, cf. §2.3).
  horizonFirst?: number;
  horizonSecond?: number;
}

/** Résultat de l'évaluation d'une composition (une main « type »). */
export interface Outcome {
  starts: number;
  redundancy: number;
  catCounts: number[]; // par catégorie (aligné sur input.categories), copies brutes
  neFirst: number; // total non-engine pertinent going first (union §2.5, plafond HOPT §B.3.5)
  neSecond: number; // total non-engine pertinent going second (union §2.5, plafond HOPT §B.3.5)
  // Itération 7 : contributions non-engine par SIGNATURE de catégories (union
  // dédupliquée + plafond HOPT, par passe). Permet d'agréger n'importe quel groupe de
  // catégories sans double comptage (§C). Aligné sur prep.neSig{First,Second}.
  neContribFirst: number[];
  neContribSecond: number[];
}

/** Distribution d'une passe (going first = 5, going second = 6). */
export interface PassResult {
  handSize: number;
  deckSize: number;
  total: number; // C(deckSize, handSize)
  buckets: Bucket[]; // issues distinctes pondérées — sert au mode requête (§3.3)
  startsBuckets: number[]; // [P(0), P(1), P(2), P(≥3)]
  startsExact: number[]; // P(starts = i), index = i
  brick: number; // P(0 start)
  meanStarts: number;
  redundancy: number[]; // P(redondance = i)
  nonEngine: number[]; // P(total non-engine pertinent = i)
  meanNonEngine: number;
  perCategory: CategoryDist[];
  crossMatrix: number[][]; // [min(starts,3)][nonEngineTotal] = P
  // Itération 7 : signatures de catégories non-engine pour cette passe (chaque
  // signature = l'ensemble des catégories PERTINENTES partagées par un groupe de
  // cartes). `bucket.neContrib[s]` donne la contribution dédupliquée de la signature s.
  neSignatures: NonEngineSignature[];
}

export interface NonEngineSignature {
  cats: string[]; // ids des catégories (pertinentes pour la passe) de cette signature
}

export interface Bucket {
  starts: number;
  redundancy: number;
  neTotal: number; // total non-engine pertinent pour CETTE passe (= Σ neContrib)
  neContrib: number[]; // contribution par signature (aligné sur PassResult.neSignatures)
  p: number;
}

export interface CategoryDist {
  id: string;
  relevant: boolean; // pertinent pour la passe courante
  dist: number[]; // P(count = i)
  mean: number;
}

export interface EngineResult {
  first: PassResult; // main de 5
  second: PassResult; // main de 6
  /** Contribution marginale : Δ P(≥1 start) si on retire 1 copie du type i (§3.2). */
  deltas: Array<{ first: number; second: number }>;
}
