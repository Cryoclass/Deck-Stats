/**
 * Contexte d'analyse (contrat §3) — PARAMÈTRE UNIQUE du moteur, étape 5.
 *   • `first`  : les 5 cartes initiales ; starts sur ces 5 ; fenêtre non-engine = le
 *                premier tour adverse qui suit.
 *   • `second` : les 5 cartes initiales ET une sixième pioche identifiée ; starts sur
 *                les 6 ; fenêtres = tour adverse initial puis son propre premier tour.
 * Matrice, contributions marginales, requêtes et mur de mains en dérivent tous.
 */
export type AnalysisContext = 'first' | 'second';

/**
 * Profil de disponibilité non-engine (contrat §3, tableau des profils). Annotation
 * manuelle par carte ; le moteur ne connaît aucun nom de carte.
 *   • early     (type Mulcharmy)     : rien en premier ; tour adverse initial en second
 *                                      pour une carte initiale ; rien pour la sixième.
 *   • flexible  (type handtrap)      : tour adverse suivant en premier ; tour adverse
 *                                      initial OU son propre tour en second ; son propre
 *                                      tour seulement pour la sixième.
 *   • prepared  (type magie rapide)  : tour adverse suivant en premier (après pose) ;
 *                                      son propre tour en second (initiale ou sixième).
 *   • breaker   (board breaker)      : rien en premier ; son propre tour en second.
 */
export type AvailabilityProfile = 'early' | 'flexible' | 'prepared' | 'breaker';

/**
 * Prérequis en deck (itération 5, REPRÉSENTATION ANCIENNE) : une source de start
 * (starter ou arête) exige qu'il reste ≥ `minInDeck` copies de la carte requise DANS LE
 * DECK après le tirage observé. `requiredTotal` est reconstruit par `prepare` depuis la
 * composition courante ; si la carte requise est absente du deck, `requiredType = null`
 * → jamais satisfait. Une liste = conjonction (ET). Depuis l'étape 5B, l'application ne
 * produit plus que des `Condition` ; ce type reste accepté seul (tests historiques) et
 * `prepare` REFUSE une source portant les deux représentations (Q3 : une seule).
 */
export interface Prereq {
  requiredType: number | null; // index dans types[] (ou null si carte absente du deck)
  requiredTotal: number; // copies totales de la carte requise dans le deck
  minInDeck: number; // ≥ 1
}

/**
 * Condition ET/OU sur le deck restant (contrat §4). Une feuille « il reste au moins
 * `atLeast` copies du type `type` dans le main deck APRÈS le tirage observé » : en
 * premier on retire les 5 cartes, en second les 5 et la sixième. `type = null` désigne
 * une carte absente du deck : jamais satisfaite. Un groupe explicitement vide est une
 * configuration incomplète : `prepare` la refuse, elle ne devient jamais vraie. Une
 * alternative satisfaite plusieurs fois compte une seule fois (valeur booléenne).
 */
export type Condition =
  | { kind: 'remaining'; type: number | null; atLeast: number }
  | { kind: 'and'; all: Condition[] }
  | { kind: 'or'; any: Condition[] };

/** Plafond PARTAGÉ par tour (contrat §3 « Copies, HOPT et plafonds ») : les membres du
 *  groupe cumulent au plus `capPerTurn` contributions sur chaque tour observé. Distinct
 *  du HOPT individuel (une contribution par identité et par tour). */
export interface EngineGroup {
  id: string;
  capPerTurn: number; // entier ≥ 1
}

/** Un type de carte annotée présent dans le main deck. */
export interface EngineType {
  copies: number; // 1..3 présents dans le deck
  isHopt: boolean; // §2.3 : copies multiples → 1 seul sommet ; 1 contribution par tour
  isStarter: boolean; // §2.1 : starter 1-carte
  categories: number[]; // index dans EngineInput.categories (§2.6) — étiquettes
  // Lot C : starts désactivés selon la position → traitée comme du filler pour le
  // contexte concerné (ni starter, ni sommet du graphe). Distinct des profils non-engine.
  deadFirst?: boolean;
  deadSecond?: boolean;
  // Représentation ancienne des prérequis (ET) sur le RÔLE STARTER de ce type.
  // Acceptée seule ; refusée si `starterCondition` est aussi présent (Q3).
  starterPrereqs?: Prereq[];
  // Étape 5 : condition ET/OU sur le rôle starter de ce type.
  starterCondition?: Condition;
  // Étape 5 : profil de disponibilité non-engine. Une carte étiquetée SANS profil
  // apporte zéro contribution retenue (Q5) tout en restant comptée dans les copies
  // brutes (`catCounts`) ; l'application la signale, le moteur ne devine rien.
  availability?: AvailabilityProfile;
  // Étape 5 : index dans EngineInput.groups (plafond partagé). Exige `availability`.
  group?: number;
}

/** Catégorie non-engine = étiquette manuelle (contrat §3) ; aucune pertinence par
 *  contexte : les fenêtres viennent du profil de la carte. */
export interface EngineCategory {
  id: string;
}

/** Entrée du moteur : deck + annotations, indépendant de l'UI. */
export interface EngineInput {
  deckSize: number; // 40..60 (§D). Extra/side jamais inclus.
  types: EngineType[];
  edges: Array<[number, number]>; // paires actives, index de types, i ≠ j
  // Représentation ancienne des prérequis (ET) portant sur une ARÊTE, alignée sur
  // `edges`. Acceptée seule ; refusée si `edgeConditions[e]` est aussi présent (Q3).
  edgePrereqs?: Array<Prereq[] | undefined>;
  // Étape 5 : condition ET/OU par arête, alignée sur `edges`.
  edgeConditions?: Array<Condition | undefined>;
  categories: EngineCategory[];
  // Étape 5 : groupes à plafond partagé, référencés par `EngineType.group`.
  groups?: EngineGroup[];
}

/** Membre d'une unité couplée : [signature, capacité tour adverse, capacité tour
 *  propre, copies disposant d'au moins une fenêtre]. */
export type CappedMember = [sig: number, opp: number, own: number, total: number];

/**
 * Unité couplée par un plafond partagé (contrat §3) : le potentiel d'un sous-ensemble
 * de catégories n'est PAS additif entre ses membres (« additionner les résultats des
 * catégories peut dépasser celui de leur union »). Conservée telle quelle dans les
 * buckets pour que chaque requête mesure son propre potentiel sous les mêmes plafonds.
 */
export interface CappedUnit {
  cap: number; // plafond par tour du groupe
  members: CappedMember[];
}

/** Résultat de l'évaluation d'une issue (composition observée + sixième identifiée). */
export interface Outcome {
  starts: number;
  redundancy: number;
  catCounts: number[]; // par catégorie (aligné sur input.categories), copies brutes
  ne: number; // potentiel non-engine U du contexte (fenêtres et plafonds appliqués)
  // Contributions par SIGNATURE de catégories (union dédupliquée), partie ADDITIVE :
  // types sans plafond partagé. Aligné sur prep.neSig{First,Second}.
  neContrib: number[];
  // Unités couplées par un plafond partagé, à ajouter à `neContrib` selon les
  // signatures sélectionnées (voir `cappedPotential`).
  neCapped: CappedUnit[];
}

/** Distribution d'un contexte (premier = 5 cartes, second = 5 + sixième). */
export interface PassResult {
  unavailableReason?: string;
  context: AnalysisContext;
  handSize: number; // 5 | 6 — nombre de cartes observées
  deckSize: number;
  /** Mains distinctes C(deckSize, handSize). Second : C(D,6). */
  total: number;
  /** Issues pondérées Z (contrat §5) : premier C(D,5) ; second C(D,5)·(D−5) = 6·C(D,6).
   *  Dénominateur de `Bucket.weight`, des probabilités et de la note /10. */
  outcomes: number;
  buckets: Bucket[]; // issues distinctes pondérées — sert au mode requête (§3.3)
  startsBuckets: number[]; // [P(0), P(1), P(2), P(≥3)]
  startsExact: number[]; // P(starts = i), index = i
  brick: number; // P(0 start)
  meanStarts: number;
  redundancy: number[]; // P(redondance = i)
  nonEngine: number[]; // P(potentiel non-engine U = i)
  meanNonEngine: number;
  perCategory: CategoryDist[];
  crossMatrix: number[][]; // [min(starts,3)][U] = P
  // Itération 7 : signatures de catégories non-engine pour ce contexte (chaque
  // signature = l'ensemble des catégories partagées par un groupe de cartes).
  // `bucket.neContrib[s]` donne la contribution dédupliquée de la signature s.
  neSignatures: NonEngineSignature[];
}

export interface NonEngineSignature {
  cats: string[]; // ids des catégories de cette signature
}

export interface Bucket {
  /** Integer mass before normalization, retained for exact percentile rounding. */
  weight?: number;
  starts: number;
  redundancy: number;
  neTotal: number; // potentiel U du contexte (= Σ neContrib + Σ unités couplées)
  neContrib: number[]; // contribution par signature (aligné sur PassResult.neSignatures)
  neCapped?: CappedUnit[]; // unités couplées (absent ou vide = aucun plafond partagé)
  p: number;
}

export interface CategoryDist {
  id: string;
  dist: number[]; // P(count = i) — copies brutes, sans plafond ni perte de la sixième
  mean: number;
}

export interface EngineResult {
  first: PassResult; // premier · 5 cartes
  second: PassResult; // second · 5 cartes + pioche
  /** Contribution marginale : Δ P(≥1 start) si on retire 1 copie du type i (§3.2),
   *  par contexte. */
  deltas: Array<{ first: number; second: number }>;
}
