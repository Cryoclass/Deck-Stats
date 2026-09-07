import { maxMatching, countEdges, edgeKey } from './matching.js';
import type {
  AnalysisContext,
  AvailabilityProfile,
  CappedMember,
  CappedUnit,
  Condition,
  EngineInput,
  Outcome,
  Prereq,
} from './types.js';

/** Vue précompilée de l'entrée : matrice d'adjacence + flags de pertinence. */
export interface Prepared {
  input: EngineInput;
  n: number;
  filler: number; // §B.1 : taille_deck − Σ copies annotées
  typeAdj: boolean[][];
  // Type i non-engine = étiqueté ET profilé (contrat §3 ; Q1 et Q5). Une carte
  // étiquetée sans profil n'apporte aucune contribution retenue, dans les deux
  // contextes ; ses copies brutes restent comptées.
  nonEngine: boolean[];
  deadFirst: boolean[]; // starts du type i désactivés en premier → filler pour ce contexte (Lot C)
  deadSecond: boolean[]; // idem en second
  // Étape 5 : conditions ET/OU sur le deck restant, validées ; `undefined` = source
  // inconditionnelle. Anciens prérequis (ET) traduits en feuilles quand ils sont seuls.
  hasConditions: boolean; // aucune condition → chemin rapide
  starterConditions: Array<Condition | undefined>; // par type
  edgeConditions: Array<Condition | undefined>; // aligné sur input.edges
  // Itération 7 : signatures non-engine (types groupés par ensemble de catégories) —
  // permet d'agréger tout groupe de catégories sans double comptage. Une signature
  // porte ses cartes (types) et ses ids de catégories. Identiques dans les deux
  // contextes depuis l'étape 5B (les fenêtres viennent du profil, pas de l'étiquette).
  neSigs: NeSignature[];
  // Étape 5 : plafonds partagés (aligné sur input.groups) et types dont l'issue dépend
  // de leur présence en sixième carte (profils early et flexible).
  groupCaps: number[];
  sixthSensitive: boolean[];
  anySixthSensitive: boolean;
}

interface NeSignature {
  cats: string[]; // ids des catégories partagées par ces types
  types: number[]; // index des types de cette signature
}

const PROFILES: ReadonlySet<string> = new Set<AvailabilityProfile>(['early', 'flexible', 'prepared', 'breaker']);

// ─── Conditions ET/OU (contrat §4) ───

const invalidCondition = (why: string): Error =>
  new Error(`Condition de start invalide : ${why}`);

/** Valide et normalise une condition ; refuse groupe vide, opérateur inconnu, quantité
 *  ou type invalide — rien ne devient silencieusement vrai. */
export function normalizeCondition(value: unknown, typeCount: number): Condition {
  if (typeof value !== 'object' || value === null) throw invalidCondition('opérateur inconnu.');
  const c = value as Record<string, unknown>;
  switch (c.kind) {
    case 'remaining': {
      const type = c.type;
      if (type !== null && (!Number.isInteger(type) || (type as number) < 0 || (type as number) >= typeCount)) {
        throw invalidCondition('carte requise hors du modèle.');
      }
      if (!Number.isInteger(c.atLeast) || (c.atLeast as number) < 1) {
        throw invalidCondition('quantité requise entière ≥ 1 attendue.');
      }
      return { kind: 'remaining', type: type as number | null, atLeast: c.atLeast as number };
    }
    case 'and':
    case 'or': {
      const children = c.kind === 'and' ? c.all : c.any;
      if (!Array.isArray(children) || children.length === 0) {
        throw invalidCondition('groupe ET/OU vide (configuration incomplète).');
      }
      const normalized = children.map((child) => normalizeCondition(child, typeCount));
      return c.kind === 'and' ? { kind: 'and', all: normalized } : { kind: 'or', any: normalized };
    }
    default:
      throw invalidCondition('opérateur inconnu.');
  }
}

/** Anciens prérequis (ET) → feuilles « restant ≥ q ». Le total requis est reconstruit
 *  depuis la composition courante (étape 2), la feuille ne porte donc que le type. */
function prereqsToCondition(prereqs: Prereq[], typeCount: number): Condition {
  return normalizeCondition(
    {
      kind: 'and',
      all: prereqs.map((p) => ({ kind: 'remaining', type: p.requiredType, atLeast: p.minInDeck })),
    },
    typeCount,
  );
}

/** Q3 (étape 5B) : une seule représentation par source. Les deux présentes = incohérence
 *  signalée, jamais combinée silencieusement. */
function singleRepresentation(
  legacy: Condition | undefined,
  modern: Condition | undefined,
  where: string,
): Condition | undefined {
  if (legacy && modern) {
    throw invalidCondition(`${where} porte à la fois d'anciens prérequis et une condition ET/OU (une seule représentation attendue).`);
  }
  return modern ?? legacy;
}

/**
 * Condition satisfaite pour le tirage observé `k` ? Copies restantes en deck =
 * copies totales − copies observées (les 5 en premier ; les 5 et la sixième en second).
 * Valeur booléenne : plusieurs alternatives vraies n'ajoutent rien ; les cibles ne sont
 * pas consommées ; répéter « B ≥ 1 » ne devient pas « B ≥ 2 ».
 */
export function conditionHolds(c: Condition, k: number[], copies: number[]): boolean {
  switch (c.kind) {
    case 'remaining': {
      if (c.type === null) return false;
      return copies[c.type] - (k[c.type] ?? 0) >= c.atLeast;
    }
    case 'and':
      for (const child of c.all) if (!conditionHolds(child, k, copies)) return false;
      return true;
    case 'or':
      for (const child of c.any) if (conditionHolds(child, k, copies)) return true;
      return false;
  }
}

// ─── Préparation ───

export function prepare(input: EngineInput): Prepared {
  const n = input.types.length;
  const typeAdj: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  for (const [a, b] of input.edges) {
    if (a === b) continue; // auto-combo hors périmètre (§D)
    if (a < 0 || b < 0 || a >= n || b >= n) continue;
    typeAdj[a][b] = true;
    typeAdj[b][a] = true;
  }

  const groups = input.groups ?? [];
  const groupCaps = groups.map((g, gi) => {
    if (!Number.isInteger(g.capPerTurn) || g.capPerTurn < 1) {
      throw new Error(`Plafond de groupe invalide (« ${g.id ?? gi} ») : entier ≥ 1 attendu.`);
    }
    return g.capPerTurn;
  });

  const nonEngine = new Array<boolean>(n).fill(false);
  const deadFirst = new Array<boolean>(n).fill(false);
  const deadSecond = new Array<boolean>(n).fill(false);
  const sixthSensitive = new Array<boolean>(n).fill(false);
  const starterConditions = new Array<Condition | undefined>(n).fill(undefined);
  let hasConditions = false;
  for (let i = 0; i < n; i++) {
    const t = input.types[i];
    const profile = t.availability;
    if (profile !== undefined && !PROFILES.has(profile)) {
      throw new Error(`Profil de disponibilité inconnu : « ${String(profile)} ».`);
    }
    if (t.group !== undefined) {
      if (!Number.isInteger(t.group) || t.group < 0 || t.group >= groups.length) {
        throw new Error('Plafond de groupe : référence hors du modèle.');
      }
      if (profile === undefined) {
        // Q2 : un plafond partagé n'a pas de sens sans fenêtres définies ; refusé,
        // jamais ignoré. L'interface ne propose un groupe qu'à une carte profilée.
        throw new Error('Plafond de groupe sans profil de disponibilité : configuration incomplète.');
      }
    }
    for (const c of t.categories) {
      if (!Number.isInteger(c) || c < 0 || c >= input.categories.length) {
        throw new Error('Catégorie non-engine : référence hors du modèle.');
      }
    }
    // Contrat §3 : le profil détermine les fenêtres, l'étiquette dit ce qui est compté.
    // Profil sans étiquette (Q1) ou étiquette sans profil (Q5) : aucune contribution.
    nonEngine[i] = profile !== undefined && t.categories.length > 0;
    sixthSensitive[i] = nonEngine[i] && (profile === 'early' || profile === 'flexible');
    deadFirst[i] = !!t.deadFirst;
    deadSecond[i] = !!t.deadSecond;
    const legacy = t.starterPrereqs && t.starterPrereqs.length > 0 ? prereqsToCondition(t.starterPrereqs, n) : undefined;
    const modern = t.starterCondition !== undefined ? normalizeCondition(t.starterCondition, n) : undefined;
    const condition = singleRepresentation(legacy, modern, `le starter n° ${i}`);
    if (condition) {
      starterConditions[i] = condition;
      hasConditions = true;
    }
  }

  const edgeConditions = input.edges.map((_, e) => {
    const ep = input.edgePrereqs?.[e];
    const legacy = ep && ep.length > 0 ? prereqsToCondition(ep, n) : undefined;
    const ec = input.edgeConditions?.[e];
    const modern = ec !== undefined ? normalizeCondition(ec, n) : undefined;
    const condition = singleRepresentation(legacy, modern, `la paire n° ${e}`);
    if (condition) hasConditions = true;
    return condition;
  });

  const usedCopies = input.types.reduce((s, t) => s + t.copies, 0);
  const filler = Math.max(0, input.deckSize - usedCopies);

  // Signatures non-engine : types profilés groupés par ensemble d'étiquettes.
  const sigMap = new Map<string, NeSignature>();
  for (let i = 0; i < n; i++) {
    if (!nonEngine[i]) continue;
    const cats = input.types[i].categories.map((c) => input.categories[c].id).sort();
    const key = cats.join('|');
    const sig = sigMap.get(key) ?? { cats, types: [] };
    sig.types.push(i);
    sigMap.set(key, sig);
  }

  return {
    input,
    n,
    filler,
    typeAdj,
    nonEngine,
    deadFirst,
    deadSecond,
    hasConditions,
    starterConditions,
    edgeConditions,
    neSigs: [...sigMap.values()],
    groupCaps,
    sixthSensitive,
    anySixthSensitive: sixthSensitive.some(Boolean),
  };
}

// ─── Potentiel non-engine (contrat §3 et §5) ───

/**
 * Capacités d'un type profilé pour l'issue : [tour adverse, tour propre, copies ayant
 * au moins une fenêtre]. `initial` = copies parmi les 5 initiales ; `sixth` = 1 si la
 * sixième carte est de ce type (second seulement). Le HOPT limite chaque tour à une
 * contribution par identité ; il ne crée jamais une fenêtre.
 */
function capacities(
  profile: AvailabilityProfile,
  isHopt: boolean,
  context: AnalysisContext,
  initial: number,
  sixth: number,
): CappedMember {
  let opp = 0;
  let own = 0;
  let total = 0;
  if (context === 'first') {
    // Une seule fenêtre observée : le tour adverse qui suit. early/breaker : aucune.
    if (profile === 'flexible' || profile === 'prepared') {
      opp = initial;
      total = initial;
    }
  } else {
    switch (profile) {
      case 'early':
        opp = initial; // la sixième arrive après le tour adverse initial : zéro fenêtre
        total = initial;
        break;
      case 'flexible':
        opp = initial; // seule une carte initiale peut servir au tour adverse initial
        own = initial + sixth;
        total = initial + sixth;
        break;
      case 'prepared':
      case 'breaker':
        own = initial + sixth;
        total = initial + sixth;
        break;
    }
  }
  if (isHopt) {
    opp = Math.min(opp, 1);
    own = Math.min(own, 1);
  }
  return [0, opp, own, total];
}

/**
 * Potentiel d'une unité (flot maximum = coupe minimale) sur deux fenêtres : chaque
 * copie contribue au plus une fois ; par tour, ≤ capacité de chaque membre (HOPT) et
 * ≤ `cap` pour l'ensemble. `keep` restreint l'unité aux membres retenus (sous-ensemble
 * de catégories mesuré sous les mêmes plafonds). En premier, la fenêtre propre n'existe
 * pas (own = 0) : la formule se réduit à min(Σ opp, cap).
 */
export function cappedPotential(unit: CappedUnit, keep?: (member: CappedMember) => boolean): number {
  let each = 0;
  let opp = 0;
  let own = 0;
  for (const m of unit.members) {
    if (keep && !keep(m)) continue;
    each += Math.min(m[3], m[1] + m[2]);
    opp += m[1];
    own += m[2];
  }
  return Math.min(each, unit.cap + own, unit.cap + opp, 2 * unit.cap);
}

/**
 * Évalue une issue (§B.3 / contrat §4–§5). `k[i]` = copies du type i parmi TOUTES les
 * cartes observées (5 en premier ; 5 + sixième en second) ; en second, `sixth` identifie
 * le type de la sixième carte (−1 : carte non annotée). Les conditions sont évaluées
 * sur le deck restant après ces cartes ; les sources non satisfaites sont neutralisées
 * AVANT les étapes 2 et 3 (starter non compté, arête retirée du graphe et de la
 * redondance). Le potentiel non-engine applique fenêtres et plafonds du contexte.
 */
export function evaluate(prep: Prepared, context: AnalysisContext, k: number[], sixth?: number): Outcome {
  const { input, typeAdj } = prep;
  if (context === 'second') {
    if (sixth === undefined || !Number.isInteger(sixth) || sixth < -1 || sixth >= prep.n) {
      throw new Error('Contexte second : la sixième carte doit être identifiée (index de type ou −1).');
    }
    if (sixth >= 0 && (k[sixth] ?? 0) < 1) throw new Error('Contexte second : la sixième carte doit figurer dans le tirage.');
  } else if (sixth !== undefined && sixth !== -1) {
    throw new Error('Contexte premier : aucune sixième carte.');
  }
  const sixthType = context === 'second' ? (sixth as number) : -1;
  const dead = context === 'first' ? prep.deadFirst : prep.deadSecond;
  const copies = input.types.map((t) => t.copies);

  // 0. Conditions — chemin rapide sauté si aucune source conditionnelle.
  let disabled: Set<number> | undefined;
  const starterOff = (ti: number): boolean => {
    const c = prep.starterConditions[ti];
    return c !== undefined && !conditionHolds(c, k, copies);
  };
  if (prep.hasConditions) {
    for (let e = 0; e < input.edges.length; e++) {
      const ec = prep.edgeConditions[e];
      if (ec && !conditionHolds(ec, k, copies)) {
        const [a, b] = input.edges[e];
        (disabled ??= new Set()).add(edgeKey(a, b));
      }
    }
  }

  // 1. Sommets : ki sommets, ou 1 seul si HOPT (§2.3). Starts désactivés ignorés.
  const vertices: number[] = [];
  for (let i = 0; i < k.length; i++) {
    if (k[i] <= 0 || dead[i]) continue;
    const t = input.types[i];
    const count = t.isHopt ? 1 : k[i];
    for (let v = 0; v < count; v++) vertices.push(i);
  }

  // 2. Starters 1-carte : retirés d'abord, +1 chacun — sauf condition non satisfaite,
  //    auquel cas le sommet redevient une pièce ordinaire disponible pour le couplage.
  let starts = 0;
  const nonStarter: number[] = [];
  for (const ti of vertices) {
    if (input.types[ti].isStarter && !(prep.hasConditions && starterOff(ti))) starts += 1;
    else nonStarter.push(ti);
  }

  // 3. Couplage maximum sur les sommets restants (arêtes non satisfaites retirées).
  starts += maxMatching(nonStarter, typeAdj, disabled);

  // 4. Redondance = arêtes présentes (§2.4) APRÈS retrait des arêtes non satisfaites.
  const redundancy = countEdges(vertices, typeAdj, disabled);

  // 5. Copies brutes par catégorie : toutes les cartes observées, sans plafond ni
  //    perte de la sixième (contrat §5).
  const catCounts = new Array<number>(input.categories.length).fill(0);
  for (let i = 0; i < k.length; i++) {
    if (k[i] <= 0) continue;
    for (const c of input.types[i].categories) catCounts[c] += k[i];
  }

  // 6. Potentiel non-engine U : par signature (union dédupliquée), fenêtres du profil
  //    et plafonds appliqués. Seuls les types profilés et étiquetés y figurent (Q5 : une
  //    étiquette sans profil vaut zéro contribution, copies brutes intactes). Les
  //    groupes à plafond partagé sont des unités couplées, évaluées ensemble et
  //    conservées pour les requêtes.
  const sigs = prep.neSigs;
  const neContrib = new Array<number>(sigs.length).fill(0);
  let units: Map<number, CappedUnit> | undefined;
  for (let s = 0; s < sigs.length; s++) {
    for (const t of sigs[s].types) {
      if (k[t] <= 0) continue;
      const type = input.types[t];
      const isSixth = sixthType === t ? 1 : 0;
      const member = capacities(type.availability!, type.isHopt, context, k[t] - isSixth, isSixth);
      member[0] = s;
      if (type.group === undefined) {
        neContrib[s] += Math.min(member[3], member[1] + member[2]);
      } else {
        units ??= new Map();
        const unit = units.get(type.group) ?? { cap: prep.groupCaps[type.group], members: [] };
        unit.members.push(member);
        units.set(type.group, unit);
      }
    }
  }
  let ne = 0;
  for (let s = 0; s < neContrib.length; s++) ne += neContrib[s];
  const neCapped: CappedUnit[] = [];
  if (units) {
    for (const [, unit] of [...units.entries()].sort((a, b) => a[0] - b[0])) {
      unit.members.sort(compareMembers);
      neCapped.push(unit);
      ne += cappedPotential(unit);
    }
  }

  return { starts, redundancy, catCounts, ne, neContrib, neCapped };
}

function compareMembers(a: CappedMember, b: CappedMember): number {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Prédicat rapide « starts ≥ 1 » pour la contribution marginale (§3.2). Sans condition,
 * comportement strictement identique à avant. Avec conditions : un starter compte s'il
 * est présent ET sa condition satisfaite ; une arête suffit si ses deux extrémités sont
 * présentes ET sa condition satisfaite (à ce stade aucun starter « comptant » n'est
 * présent, sinon la première boucle aurait déjà renvoyé vrai). Les starts ne dépendent
 * pas de l'identité de la sixième carte : `k` couvre toutes les cartes observées.
 */
export function startsAtLeastOne(prep: Prepared, k: number[], dead: boolean[]): boolean {
  const { input } = prep;
  const hc = prep.hasConditions;
  const copies = hc ? input.types.map((t) => t.copies) : [];
  for (let i = 0; i < k.length; i++) {
    if (k[i] > 0 && !dead[i] && input.types[i].isStarter) {
      if (!hc) return true;
      const c = prep.starterConditions[i];
      if (!c || conditionHolds(c, k, copies)) return true;
    }
  }
  for (let e = 0; e < input.edges.length; e++) {
    const [a, b] = input.edges[e];
    if (a === b) continue;
    if (k[a] > 0 && k[b] > 0 && !dead[a] && !dead[b]) {
      if (!hc) {
        if (!input.types[a].isStarter && !input.types[b].isStarter) return true;
      } else {
        const c = prep.edgeConditions[e];
        if (!c || conditionHolds(c, k, copies)) return true;
      }
    }
  }
  return false;
}
