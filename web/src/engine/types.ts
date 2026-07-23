export type Relevance = 'first' | 'second' | 'both';

/** Un type de carte annotée présent dans le main deck. */
export interface EngineType {
  copies: number; // 1..3 présents dans le deck
  isHopt: boolean; // §2.3 : copies multiples → 1 seul sommet
  isStarter: boolean; // §2.1 : starter 1-carte
  categories: number[]; // index dans EngineInput.categories (§2.6)
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
  categories: EngineCategory[];
}

/** Résultat de l'évaluation d'une composition (une main « type »). */
export interface Outcome {
  starts: number;
  redundancy: number;
  catCounts: number[]; // par catégorie (aligné sur input.categories)
  neFirst: number; // total non-engine pertinent going first (union, §2.5)
  neSecond: number; // total non-engine pertinent going second
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
}

export interface Bucket {
  starts: number;
  redundancy: number;
  catCounts: number[];
  neTotal: number; // total non-engine pertinent pour CETTE passe
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
