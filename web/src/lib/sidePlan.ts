import type { EngineInput, PassResult } from '../engine/types.js';
import { queryProbability, type QueryCriterion } from '../engine/query.js';
import type { ComputeMode } from '../worker/computeClient.js';
import type { ComboPair, ConditionNode, DeckCard, SidePlan, SidePlanCard, SidePlanPosition, StartCondition } from '../types.js';
import type { EngineModelSource } from './engineModel.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';
import type { DeckZone } from '../../../server/src/domain/cardDefaults.js';
import { ENGINE_VERSION } from './summary.js';
import { MAX_COPIES } from './ydk.js';

// ─── Plans de side (étape 10B, refondus le 22 septembre 2026) : le deck sidé, ses trois
// indicateurs et leur cache ───
// Tout est PUR ici : aucun calcul lancé, aucun appel réseau. Le store (deck étudié, aperçu), la vue
// Side, la fiche et le comparateur orchestrent : `applyPlan` → `sidedSource` → `buildEngineModel` →
// client de calcul (`planComputeMode`) → passe de la position du plan (R7) → `planSummaryFromPass` →
// PUT …/matchups/:id/plans/:position/summary.
// Ce fichier est volontairement HORS de l'empreinte `__ENGINE_VERSION__` (vite.config.ts) : il ne
// périme aucun aperçu d'accueil. En échange, l'empreinte d'un plan inclut la définition sérialisée
// de ses critères : changer un indicateur invalide ses chiffres sans rien toucher à la main (R9).
//
// Plans de side v2 (docs/plans-de-side-v2.md, S5–S7) : un plan fait sortir des cartes du main ET de
// l'Extra Deck, et entrer des cartes du side ; la zone de jeu d'une carte est DÉDUITE de son type
// (`zoneOf`, jamais stockée), un échange reste dans sa zone, l'équilibre se juge zone par zone. Les
// cartes d'Extra d'un plan ne changent ni le main dérivé ni l'entrée du moteur : un plan sans carte
// d'Extra rend exactement ce qu'il rendait avant la refonte (garde `sidePlanLegacy.test.ts`).

/** Zone de jeu d'une carte (`main` ou `extra`), `null` si elle est inconnue : jamais devinée. */
export type ZoneOf = (cardId: number) => DeckZone | null;
/** Les trois zones du deck de base, telles que le store et `sourceFromDetail` les portent. */
export interface PlanDeck {
  main: readonly DeckCard[];
  extra: readonly DeckCard[];
  side: readonly DeckCard[];
}

/** Écart entre un plan et les zones du deck (R1, R3, R5 de docs/etape-10.md ; S5 de la v2). */
export type PlanIssue =
  | { kind: 'outgoing-missing'; cardId: number; zone: DeckZone; wanted: number; available: number }
  | { kind: 'incoming-missing'; cardId: number; zone: DeckZone; wanted: number; available: number }
  | { kind: 'over-limit'; cardId: number; zone: DeckZone; copies: number }
  | { kind: 'unknown-zone'; cardId: number };

/** `ready` = analysable et imprimable ; `incomplete` = listes déséquilibrées dans une zone (R4, S6) ;
 *  `review` = une carte a quitté sa zone, sa zone est inconnue, ou la zone dérivée dépasse la
 *  convention 1–3 (R3, R5, S5). Un plan qui n'est pas `ready` n'est jamais analysé : `applyPlan` ne
 *  lui rend ni main ni extra. */
export type PlanStatus = 'ready' | 'incomplete' | 'review';

export interface ZoneBalance {
  outgoing: number;
  incoming: number;
}

export interface AppliedPlan {
  status: PlanStatus;
  issues: PlanIssue[];
  /** Copies sortantes et entrantes, toutes zones confondues (fiche : nombre de cartes du plan). */
  outgoing: number;
  incoming: number;
  /** Copies sortantes et entrantes par zone (S6 : l'équilibre se juge zone par zone). */
  zones: Record<DeckZone, ZoneBalance>;
  /** Taille du main après échange (base − sortantes + entrantes du main), toujours définie. */
  mainSize: number;
  /** Taille de l'Extra Deck après échange, toujours définie. */
  extraSize: number;
  /** Main dérivé, SEULEMENT si le plan est prêt. C'est lui, et lui seul, qui entre dans le moteur. */
  main: DeckCard[] | null;
  /** Extra dérivé, SEULEMENT si le plan est prêt ; jamais dans le moteur (S7), pour la fiche. */
  extra: DeckCard[] | null;
}

const copiesOf = (cards: readonly DeckCard[]) => new Map(cards.map((c) => [c.cardId, c.copies]));
const totalOf = (list: readonly SidePlanCard[]) => list.reduce((n, c) => n + c.copies, 0);
export const zoneSize = (cards: readonly DeckCard[]): number => cards.reduce((n, c) => n + c.copies, 0);

/** Dérive une zone du deck de base : copies retirées ou ajoutées sur place, carte tombée à 0 retirée,
 *  carte nouvelle ajoutée à la fin dans l'ordre du plan — exactement la zone qu'on obtiendrait en
 *  éditant le deck à la main. */
function deriveZone(zone: DeckZone, base: readonly DeckCard[], leaving: Map<number, number>, entering: Map<number, number>, incoming: readonly SidePlanCard[]): DeckCard[] {
  const present = copiesOf(base);
  const derived: DeckCard[] = [];
  for (const c of base) {
    const copies = c.copies - (leaving.get(c.cardId) ?? 0) + (entering.get(c.cardId) ?? 0);
    if (copies > 0) derived.push({ cardId: c.cardId, zone, copies });
  }
  for (const c of incoming) if (entering.has(c.card_id) && !present.has(c.card_id)) derived.push({ cardId: c.card_id, zone, copies: c.copies });
  return derived;
}

/** Applique un plan aux zones du deck. Chaque carte du plan est rangée dans sa zone de jeu par
 *  `zoneOf` ; une zone inconnue met le plan « à revoir » (S5). Les sortantes sont prises dans leur
 *  zone du deck de base, les entrantes dans le side ; l'équilibre est jugé zone par zone (S6). */
export function applyPlan(deck: PlanDeck, plan: SidePlan, zoneOf: ZoneOf): AppliedPlan {
  const base: Record<DeckZone, Map<number, number>> = { main: copiesOf(deck.main), extra: copiesOf(deck.extra) };
  const inSide = copiesOf(deck.side);
  const issues: PlanIssue[] = [];
  const zones: Record<DeckZone, ZoneBalance> = { main: { outgoing: 0, incoming: 0 }, extra: { outgoing: 0, incoming: 0 } };
  const leaving: Record<DeckZone, Map<number, number>> = { main: new Map(), extra: new Map() };
  const entering: Record<DeckZone, Map<number, number>> = { main: new Map(), extra: new Map() };
  const unknown = new Set<number>();
  const zoneOrUnknown = (cardId: number): DeckZone | null => {
    const z = zoneOf(cardId);
    if (z === null && !unknown.has(cardId)) {
      unknown.add(cardId);
      issues.push({ kind: 'unknown-zone', cardId });
    }
    return z;
  };
  for (const c of plan.outgoing) {
    const zone = zoneOrUnknown(c.card_id);
    if (zone === null) continue;
    zones[zone].outgoing += c.copies;
    leaving[zone].set(c.card_id, c.copies);
    const available = base[zone].get(c.card_id) ?? 0;
    if (c.copies > available) issues.push({ kind: 'outgoing-missing', cardId: c.card_id, zone, wanted: c.copies, available });
  }
  for (const c of plan.incoming) {
    const zone = zoneOrUnknown(c.card_id);
    if (zone === null) continue;
    zones[zone].incoming += c.copies;
    entering[zone].set(c.card_id, c.copies);
    const available = inSide.get(c.card_id) ?? 0;
    if (c.copies > available) issues.push({ kind: 'incoming-missing', cardId: c.card_id, zone, wanted: c.copies, available });
  }
  const derived: Record<DeckZone, DeckCard[]> = {
    main: deriveZone('main', deck.main, leaving.main, entering.main, plan.incoming),
    extra: deriveZone('extra', deck.extra, leaving.extra, entering.extra, plan.incoming),
  };
  for (const zone of ['main', 'extra'] as const) {
    for (const c of derived[zone]) if (c.copies > MAX_COPIES) issues.push({ kind: 'over-limit', cardId: c.cardId, zone, copies: c.copies });
  }
  const outgoing = totalOf(plan.outgoing);
  const incoming = totalOf(plan.incoming);
  const balanced = zones.main.outgoing === zones.main.incoming && zones.extra.outgoing === zones.extra.incoming;
  const status: PlanStatus = issues.length > 0 ? 'review' : !balanced ? 'incomplete' : 'ready';
  return {
    status,
    issues,
    outgoing,
    incoming,
    zones,
    mainSize: zoneSize(deck.main) - zones.main.outgoing + zones.main.incoming,
    extraSize: zoneSize(deck.extra) - zones.extra.outgoing + zones.extra.incoming,
    main: status === 'ready' ? derived.main : null,
    extra: status === 'ready' ? derived.extra : null,
  };
}

/** Source du modèle moteur du deck sidé : TOUTES les annotations du deck, inchangées (R6), sur le
 *  main dérivé — une carte de side annotée devient active en entrant, une condition dont la carte
 *  requise sort devient fausse. L'Extra dérivé n'y entre jamais (S7). `null` si le plan n'est pas prêt. */
export function sidedSource<S extends EngineModelSource>(source: S, applied: AppliedPlan): S | null {
  return applied.main ? { ...source, main: applied.main } : null;
}

/** Mode de calcul minimal pour une position (R7). Le worker n'a pas de mode « second seul » :
 *  un plan second calcule les deux passes, coût ×2 accepté pour 14 plans au plus (D15). */
export function planComputeMode(position: SidePlanPosition): Extract<ComputeMode, 'first' | 'passes'> {
  return position === 'first' ? 'first' : 'passes';
}

export interface PlanIndicators {
  /** I1 = P(S ≥ 1). */
  startOne: number;
  /** I2 = P(U ≥ 2). */
  nonEngineTwo: number;
  /** I3 « main forte » = P(S ≥ 2 et U ≥ 1) en premier, P(S ≥ 2 et U ≥ 2) en second. */
  strongHand: number;
}

const atLeast = (id: string, subject: 'starts' | 'nonengine', min: number): QueryCriterion =>
  ({ id, subject: subject === 'starts' ? { kind: 'starts' } : { kind: 'nonengine' }, min, max: null });

/** Les trois indicateurs d'un plan (R8), exprimés comme des requêtes du mode Requête : mêmes
 *  sujets, mêmes bornes, même évaluation — ce sont au bit près les chiffres du panneau. */
export function indicatorCriteria(position: SidePlanPosition): Record<keyof PlanIndicators, QueryCriterion[]> {
  return {
    startOne: [atLeast('s', 'starts', 1)],
    nonEngineTwo: [atLeast('u', 'nonengine', 2)],
    strongHand: [atLeast('s', 'starts', 2), atLeast('u', 'nonengine', position === 'first' ? 1 : 2)],
  };
}

/** Indicateurs d'une passe ; `null` si la passe est indisponible. La passe doit être celle de la
 *  position du plan (R7) : l'inverse est une erreur de programmation, jamais un chiffre. */
export function planIndicators(pass: PassResult, position: SidePlanPosition): PlanIndicators | null {
  if (pass.context !== position) throw new Error(`Plan « ${position} » : passe « ${pass.context} » fournie (R7).`);
  const criteria = indicatorCriteria(position);
  const startOne = queryProbability(pass, criteria.startOne);
  const nonEngineTwo = queryProbability(pass, criteria.nonEngineTwo);
  const strongHand = queryProbability(pass, criteria.strongHand);
  if (startOne === null || nonEngineTwo === null || strongHand === null) return null;
  return { startOne, nonEngineTwo, strongHand };
}

/** FNV-1a 64 bits : clé de cache, pas une signature. 16 caractères hexadécimaux. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Empreinte des chiffres d'un plan (R9) : version du moteur, position, définition des critères
 *  et entrée COMPLÈTE du moteur pour le deck sidé — composition, annotations du deck, profils,
 *  plafonds, étiquettes et HOPT du compte y figurent déjà. Toute modification qui change un
 *  chiffre change donc l'empreinte ; échanger une carte neutre contre une autre ne la change pas,
 *  et c'est juste : le moteur ne les distingue pas. `criteria` n'est un paramètre que pour prouver
 *  qu'une nouvelle définition périme les chiffres. */
export function planFingerprint(input: EngineInput, position: SidePlanPosition, engineVersion = ENGINE_VERSION, criteria = indicatorCriteria(position)): string {
  return fnv1a64(JSON.stringify({ engineVersion, position, criteria, input }));
}

/** Chiffres d'un plan à persister ; `null` si la passe est indisponible. */
export function planSummaryFromPass(pass: PassResult, input: EngineInput, position: SidePlanPosition, engineVersion = ENGINE_VERSION, now = new Date()): PlanSummary | null {
  const indicators = planIndicators(pass, position);
  if (!indicators) return null;
  return { engineVersion, fingerprint: planFingerprint(input, position, engineVersion), mainSize: input.deckSize, ...indicators, computedAt: now.toISOString() };
}

const PLAN_SUMMARY_KEYS = ['engineVersion', 'fingerprint', 'mainSize', 'startOne', 'nonEngineTwo', 'strongHand', 'computedAt'] as const;
const rate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** Des chiffres stockés ne sont affichables que s'ils ont la forme attendue ET l'empreinte du deck
 *  sidé COURANT (même moteur, même position, mêmes critères, même entrée). Sinon `null` : on
 *  recalcule, on n'affiche jamais un chiffre périmé — et rien de périmé ne s'imprime. */
export function usablePlanSummary(value: unknown, input: EngineInput, position: SidePlanPosition, engineVersion = ENGINE_VERSION): PlanSummary | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  if (!PLAN_SUMMARY_KEYS.every((k) => k in s)) return null;
  if (s.engineVersion !== engineVersion || s.fingerprint !== planFingerprint(input, position, engineVersion)) return null;
  if (s.mainSize !== input.deckSize || !rate(s.startOne) || !rate(s.nonEngineTwo) || !rate(s.strongHand) || typeof s.computedAt !== 'string') return null;
  return { engineVersion, fingerprint: s.fingerprint, mainSize: s.mainSize, startOne: s.startOne, nonEngineTwo: s.nonEngineTwo, strongHand: s.strongHand, computedAt: s.computedAt };
}

/** Source de start que le plan rend inconditionnellement fausse (Q3). */
export type NeutralizedSource =
  | { kind: 'starter'; cardId: number }
  | { kind: 'pair'; pairId: string; cardA: number; cardB: number };

interface SourceState {
  starters: Set<number>;
  pairs: ComboPair[];
  pairExclusions: Set<string>;
  startConditions: StartCondition[];
}

/** Une condition ne peut JAMAIS être vraie : une feuille « il reste ≥ n copies » d'une carte qui en
 *  a moins de n dans le deck est fausse quel que soit le tirage ; ET faux dès qu'un enfant l'est,
 *  OU faux si tous le sont. */
function alwaysFalse(node: ConditionNode, copies: Map<number, number>): boolean {
  if (node.kind === 'remaining') return (copies.get(node.card_id) ?? 0) < node.at_least;
  return node.kind === 'and' ? node.all.some((c) => alwaysFalse(c, copies)) : node.any.every((c) => alwaysFalse(c, copies));
}

/** Sources de start qu'un plan neutralise (Q3) : actives dans le deck sidé, leur condition pouvait
 *  être vraie dans le deck de base et ne le peut plus après échange — une carte requise sort, ou
 *  n'y reste plus en assez d'exemplaires. Première cause d'un chiffre qui s'effondre ; une source
 *  déjà impossible dans le deck de base n'est pas imputée au plan. */
export function neutralizedSources(state: SourceState, baseMain: readonly DeckCard[], sidedMain: readonly DeckCard[]): NeutralizedSource[] {
  const base = copiesOf(baseMain);
  const sided = copiesOf(sidedMain);
  const out: NeutralizedSource[] = [];
  for (const r of state.startConditions) {
    if (!alwaysFalse(r.condition, sided) || alwaysFalse(r.condition, base)) continue;
    if (r.sourceCardId !== null) {
      if (state.starters.has(r.sourceCardId) && sided.has(r.sourceCardId)) out.push({ kind: 'starter', cardId: r.sourceCardId });
      continue;
    }
    const p = state.pairs.find((x) => x.id === r.sourcePairId);
    if (p && !state.pairExclusions.has(p.id) && sided.has(p.card_a_id) && sided.has(p.card_b_id)) out.push({ kind: 'pair', pairId: p.id, cardA: p.card_a_id, cardB: p.card_b_id });
  }
  return out;
}
