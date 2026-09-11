import type { EngineInput, PassResult } from '../engine/types.js';
import { queryProbability, type QueryCriterion } from '../engine/query.js';
import type { ComputeMode } from '../worker/computeClient.js';
import type { DeckCard, SidePlan, SidePlanPosition } from '../types.js';
import type { EngineModelSource } from './engineModel.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';
import { ENGINE_VERSION } from './summary.js';
import { MAX_COPIES } from './ydk.js';

// ─── Plans de side (étape 10B) : le deck sidé, ses trois indicateurs et leur cache ───
// Tout est PUR ici : aucun calcul lancé, aucun appel réseau. La vue Side (10C) et la fiche (10D)
// orchestrent : `applyPlan` → `sidedSource` → `buildEngineModel` → client de calcul
// (`planComputeMode`) → passe de la position du plan (R7) → `planSummaryFromPass` →
// PUT …/matchups/:id/plans/:position/summary.
// Ce fichier est volontairement HORS de l'empreinte `__ENGINE_VERSION__` (vite.config.ts) : il ne
// périme aucun aperçu d'accueil. En échange, l'empreinte d'un plan inclut la définition sérialisée
// de ses critères : changer un indicateur invalide ses chiffres sans rien toucher à la main (R9).

/** Écart entre un plan et les zones du deck (R1, R3, R5 de docs/etape-10.md). */
export type PlanIssue =
  | { kind: 'outgoing-missing'; cardId: number; wanted: number; available: number }
  | { kind: 'incoming-missing'; cardId: number; wanted: number; available: number }
  | { kind: 'over-limit'; cardId: number; copies: number };

/** `ready` = analysable et imprimable ; `incomplete` = listes déséquilibrées (R4) ; `review` = une
 *  carte a quitté sa zone ou le main dérivé dépasse la convention 1–3 (R3, R5). Un plan qui n'est
 *  pas `ready` n'est jamais analysé : `applyPlan` ne lui rend pas de main. */
export type PlanStatus = 'ready' | 'incomplete' | 'review';

export interface AppliedPlan {
  status: PlanStatus;
  issues: PlanIssue[];
  /** Copies sortantes et entrantes. */
  outgoing: number;
  incoming: number;
  /** Taille du main après échange (base − sortantes + entrantes), toujours définie. */
  mainSize: number;
  /** Main dérivé, SEULEMENT si le plan est prêt. */
  main: DeckCard[] | null;
}

const copiesOf = (cards: readonly DeckCard[]) => new Map(cards.map((c) => [c.cardId, c.copies]));
const totalOf = (list: SidePlan['outgoing']) => list.reduce((n, c) => n + c.copies, 0);

/** Applique un plan au main du deck. Le main dérivé garde l'ordre du deck : copies retirées ou
 *  ajoutées sur place, carte tombée à 0 retirée, carte nouvelle ajoutée à la fin dans l'ordre du
 *  plan — exactement le main qu'on obtiendrait en éditant le deck à la main. */
export function applyPlan(main: readonly DeckCard[], side: readonly DeckCard[], plan: SidePlan): AppliedPlan {
  const inMain = copiesOf(main);
  const inSide = copiesOf(side);
  const issues: PlanIssue[] = [];
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
  const status: PlanStatus = issues.length > 0 ? 'review' : outgoing !== incoming ? 'incomplete' : 'ready';
  return { status, issues, outgoing, incoming, mainSize, main: status === 'ready' ? derived : null };
}

/** Source du modèle moteur du deck sidé : TOUTES les annotations du deck, inchangées (R6), sur le
 *  main dérivé — une carte de side annotée devient active en entrant, une condition dont la carte
 *  requise sort devient fausse. `null` si le plan n'est pas prêt. */
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
