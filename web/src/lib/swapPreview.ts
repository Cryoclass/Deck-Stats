import type { DeckCard, SidePlan, SidePlanCard } from '../types.js';
import type { DeckZone } from '../../../server/src/domain/cardDefaults.js';
import type { EngineInput } from '../engine/types.js';
import { buildEngineModel, type EngineModelSource } from './engineModel.js';
import { countByZone, countOf, trySwap, withSwap, type PlanDirection, type SwapDelta } from './matchups.js';
import { applyPlan, sidedSource, type AppliedPlan, type PlanDeck, type PlanIndicators, type ZoneOf } from './sidePlan.js';
import { sameMain } from './studiedDeck.js';

// ─── Aperçu en direct et écarts de candidats (plans de side v2, D5, D6, S3, S4) ───
// Pur : aucun calcul lancé. Le store orchestre (client de calcul, annulation, seuils).
// Une SÉLECTION est un échange en préparation : des copies du main ou de l'extra à sortir, des copies
// du side à faire entrer. Équilibrée zone par zone, elle donne un APERÇU : le deck « plan +
// sélection », marqué aperçu, jamais enregistré, jamais « non enregistré » (S3). À une copie près dans
// le main, chaque carte candidate reçoit l'écart d'un échange avec elle (S4).

export type Selection = SwapDelta;
export const EMPTY_SELECTION: Selection = { outgoing: [], incoming: [] };
export const isSelectionEmpty = (s: Selection): boolean => countOf(s.outgoing) + countOf(s.incoming) === 0;

export type Preview =
  /** Sélection vide : rien à montrer, la colonne garde le plan. */
  | { kind: 'none' }
  /** Une zone n'est pas équilibrée : pas d'aperçu, la raison est dite (S3). */
  | { kind: 'unbalanced'; reason: string }
  /** L'échange serait refusé (zone inconnue, écart créé) : pas d'aperçu, la raison est celle du refus. */
  | { kind: 'refused'; reason: string }
  /** L'échange est acceptable mais le plan résultant n'est pas prêt (il ne l'était déjà pas : incomplet
   *  ou à revoir, et l'échange ne l'aggrave pas) : pas de deck à montrer, le statut est dit. */
  | { kind: 'not-ready'; applied: AppliedPlan }
  /** Le deck « plan + sélection », prêt. `affectsEngine` = son main diffère de celui du plan ; une
   *  sélection d'Extra seule ne change aucun chiffre (S7). */
  | { kind: 'ready'; plan: SidePlan; applied: AppliedPlan; affectsEngine: boolean };

/** L'aperçu d'une sélection sur un plan. La règle est celle du geste « Échanger » (`trySwap`) : un
 *  aperçu montre exactement ce que donnerait l'échange, et rien qu'il refuserait. */
export function previewOf(deck: PlanDeck, plan: SidePlan, selection: Selection, zoneOf: ZoneOf, name: (cardId: number) => string): Preview {
  if (isSelectionEmpty(selection)) return { kind: 'none' };
  const out = countByZone(selection.outgoing, zoneOf);
  const inn = countByZone(selection.incoming, zoneOf);
  const r = trySwap(plan, deck, zoneOf, selection, name);
  if (!r.ok) {
    const unbalanced = out.unknown.length === 0 && inn.unknown.length === 0 && (out.counts.main !== inn.counts.main || out.counts.extra !== inn.counts.extra);
    return unbalanced ? { kind: 'unbalanced', reason: r.reason } : { kind: 'refused', reason: r.reason };
  }
  const applied = applyPlan(deck, r.plan, zoneOf);
  if (applied.status !== 'ready') return { kind: 'not-ready', applied };
  const current = applyPlan(deck, plan, zoneOf);
  return { kind: 'ready', plan: r.plan, applied, affectsEngine: !sameMain(applied.main, current.main) };
}

/** Un candidat (S4) : la carte qui compléterait la sélection à une copie près, avec le deck que
 *  donnerait cet échange. Seul le main a des candidats : l'Extra n'a aucun effet sur les chiffres. */
export interface Candidate {
  cardId: number;
  direction: PlanDirection;
  /** Le plan « actuel + sélection + ce candidat », prêt. */
  plan: SidePlan;
  applied: AppliedPlan;
}

export interface Candidates {
  /** Sens des candidats : `incoming` = cartes du side à faire entrer ; `outgoing` = cartes du main à sortir. */
  direction: PlanDirection;
  candidates: Candidate[];
}

const engagedIn = (list: readonly SidePlanCard[], cardId: number): number => list.find((c) => c.card_id === cardId)?.copies ?? 0;

/** Les candidats d'une sélection (D6) : quand la sélection du main a exactement une copie sortante
 *  de plus que d'entrantes, chaque carte du side de type main ayant encore une copie libre ;
 *  symétriquement, une entrante de plus → chaque carte du main ayant encore une copie libre. Un
 *  candidat n'est retenu que si l'échange « plan + partie main de la sélection + candidat » serait
 *  accepté (même règle que « Échanger »). La partie Extra de la sélection est laissée de côté : elle
 *  ne change aucun chiffre (S7), et une sélection d'Extra encore déséquilibrée ne doit pas priver le
 *  main de ses écarts. `null` quand la sélection n'est pas à une copie près. Ordre = celui des zones. */
export function candidatesOf(deck: PlanDeck, plan: SidePlan, selection: Selection, zoneOf: ZoneOf, name: (cardId: number) => string): Candidates | null {
  const out = countByZone(selection.outgoing, zoneOf);
  const inn = countByZone(selection.incoming, zoneOf);
  if (out.unknown.length > 0 || inn.unknown.length > 0) return null;
  const diff = out.counts.main - inn.counts.main;
  if (diff !== 1 && diff !== -1) return null;
  const mainOnly = (list: readonly SidePlanCard[]) => list.filter((c) => zoneOf(c.card_id) === 'main');
  const mainSelection: Selection = { outgoing: mainOnly(selection.outgoing), incoming: mainOnly(selection.incoming) };
  const direction: PlanDirection = diff === 1 ? 'incoming' : 'outgoing';
  const pool = direction === 'incoming' ? deck.side : deck.main;
  const engaged = direction === 'incoming' ? plan.incoming : plan.outgoing;
  const selected = direction === 'incoming' ? mainSelection.incoming : mainSelection.outgoing;
  const candidates: Candidate[] = [];
  const seen = new Set<number>();
  for (const c of pool) {
    if (seen.has(c.cardId) || zoneOf(c.cardId) !== 'main') continue;
    seen.add(c.cardId);
    const free = c.copies - engagedIn(engaged, c.cardId) - engagedIn(selected, c.cardId);
    if (free <= 0) continue;
    const one: SidePlanCard = { card_id: c.cardId, copies: 1 };
    const delta: SwapDelta = direction === 'incoming'
      ? { outgoing: mainSelection.outgoing, incoming: [...mainSelection.incoming, one] }
      : { outgoing: [...mainSelection.outgoing, one], incoming: mainSelection.incoming };
    const r = trySwap(plan, deck, zoneOf, delta, name);
    if (!r.ok) continue;
    const applied = applyPlan(deck, r.plan, zoneOf);
    if (applied.status !== 'ready') continue;
    candidates.push({ cardId: c.cardId, direction, plan: r.plan, applied });
  }
  return { direction, candidates };
}

/** Entrées du moteur des candidats, dédoublonnées : deux candidats neutres donnent la même entrée et
 *  ne se calculent qu'une fois (D6 ; mesuré : 34 candidats → 19 entrées sur le deck le plus lourd). */
export function candidateInputs(source: EngineModelSource, candidates: readonly Candidate[]): { byCard: Map<number, string>; inputs: Map<string, EngineInput> } {
  const byCard = new Map<number, string>();
  const inputs = new Map<string, EngineInput>();
  for (const c of candidates) {
    const sided = sidedSource(source, c.applied);
    if (!sided) continue;
    const input = buildEngineModel(sided).input;
    const key = JSON.stringify(input);
    byCard.set(c.cardId, key);
    if (!inputs.has(key)) inputs.set(key, input);
  }
  return { byCard, inputs };
}

/** Indicateur affiché sur les tuiles candidates (Q4) : « main forte » par défaut, I1 / I2 au choix. */
export type Indicator = keyof PlanIndicators;
export const DEFAULT_INDICATOR: Indicator = 'strongHand';
export const INDICATOR_LABEL: Record<Indicator, string> = { startOne: '≥ 1 départ', nonEngineTwo: '≥ 2 non-engine', strongHand: 'Main forte' };

/** L'écart d'un candidat (S4) : indicateur(plan + sélection + candidat) − indicateur(plan), dans la
 *  position ouverte. La référence est le PLAN, pas le deck de base : c'est le coût du prochain geste. */
export const candidateDelta = (candidate: PlanIndicators, plan: PlanIndicators, indicator: Indicator): number => candidate[indicator] - plan[indicator];

/** Budget des écarts de candidats (Q5) : au-delà de cette estimation, le calcul est à la demande. */
export const CANDIDATES_AUTO_MS = 3000;
/** Estimation du coût : entrées distinctes × durée de la dernière passe de cette position. */
export const estimateCandidatesMs = (distinctInputs: number, lastPassMs: number): number => distinctInputs * lastPassMs;

/** Les cartes d'une zone encore libres pour la sélection (ni engagées dans le plan, ni sélectionnées). */
export function freeCopies(cards: readonly DeckCard[], engaged: readonly SidePlanCard[], selected: readonly SidePlanCard[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of cards) out.set(c.cardId, Math.max(0, c.copies - engagedIn(engaged, c.cardId) - engagedIn(selected, c.cardId)));
  return out;
}

/** Sélection augmentée d'une copie (clic) ou réduite d'une (clic droit) ; jamais au-delà des copies
 *  libres, jamais sous zéro. */
export function adjustSelection(selection: Selection, direction: PlanDirection, cardId: number, delta: 1 | -1, free: number): Selection {
  const list = selection[direction];
  const current = engagedIn(list, cardId);
  const next = Math.max(0, Math.min(free, current + delta));
  if (next === current) return selection;
  const updated = next === 0 ? list.filter((c) => c.card_id !== cardId) : current === 0 ? [...list, { card_id: cardId, copies: next }] : list.map((c) => (c.card_id === cardId ? { ...c, copies: next } : c));
  return { ...selection, [direction]: updated };
}

/** Le plan qu'affiche la colonne pendant une sélection : l'aperçu s'il est prêt, sinon le plan. */
export const shownPlan = (plan: SidePlan, preview: Preview): SidePlan => (preview.kind === 'ready' ? preview.plan : plan);

/** Zone d'une sélection pour l'affichage : `main`, `extra`, ou les deux. */
export const zonesTouched = (selection: Selection, zoneOf: ZoneOf): DeckZone[] => {
  const out = countByZone(selection.outgoing, zoneOf).counts;
  const inn = countByZone(selection.incoming, zoneOf).counts;
  return (['main', 'extra'] as const).filter((z) => out[z] + inn[z] > 0);
};

/** Plan augmenté d'une sélection, sans règle (pour un affichage « ce que contiendrait le plan »). */
export const planWithSelection = (plan: SidePlan, selection: Selection): SidePlan => withSwap(plan, selection);
