import type { Matchup, SidePlan, SidePlanCard, SidePlanPosition } from '../types.js';
import { SIDE_PLAN_POSITIONS } from '../../../server/src/domain/deckConfiguration.js';
import type { DeckZone } from '../../../server/src/domain/cardDefaults.js';
import { applyPlan, type PlanDeck, type PlanIssue, type ZoneOf } from './sidePlan.js';

// ─── Adversaires et plans de side (étape 10C, refondus le 22 septembre 2026) : mutations PURES,
// rendues au store ───
// Aucune ne touche au deck de base ni ne recalcule : un plan n'entre jamais dans le modèle moteur
// du deck (il est calculé à part, lib/sidePlan.ts). Un refus est un message, jamais une réduction
// silencieuse ; une retouche peut déséquilibrer un plan (D11), c'est l'état « incomplet ».
// v2 : un échange est jugé zone par zone (S5, S6) — les cartes d'Extra Deck s'échangent entre elles,
// celles du main entre elles, jamais l'une contre l'autre ; `trySwap` est la règle UNIQUE de
// l'échange, partagée par le geste « Échanger » et par l'aperçu (lib/swapPreview.ts).

export type PlanDirection = 'outgoing' | 'incoming';

/** Un échange = les deux listes ajoutées à un plan ; c'est aussi l'unité d'« Annuler l'échange ». */
export interface SwapDelta {
  outgoing: SidePlanCard[];
  incoming: SidePlanCard[];
}

export const emptyPlan = (position: SidePlanPosition): SidePlan => ({ position, note: null, outgoing: [], incoming: [] });

/** Plan d'une position ; un volet absent vaut un plan vide. */
export const planOf = (matchup: Matchup, position: SidePlanPosition): SidePlan =>
  matchup.plans.find((p) => p.position === position) ?? emptyPlan(position);

const copyList = (list: readonly SidePlanCard[]): SidePlanCard[] => list.map((c) => ({ ...c }));
export const countOf = (list: readonly SidePlanCard[]): number => list.reduce((n, c) => n + c.copies, 0);

/** Remplace le plan d'une position, volets toujours rangés premier puis second. */
function withPlan(list: readonly Matchup[], id: string, position: SidePlanPosition, update: (plan: SidePlan) => SidePlan): Matchup[] {
  return list.map((m) => {
    if (m.id !== id) return m;
    const next = update(planOf(m, position));
    const plans = SIDE_PLAN_POSITIONS.map((p) => (p === position ? next : m.plans.find((x) => x.position === p))).filter((p): p is SidePlan => p !== undefined);
    return { ...m, plans };
  });
}

/** Un adversaire porte toujours ses deux volets, vides à la création (docs/etape-10.md §1) ; il
 *  prend place à la fin (ordre d'ajout, Q4). */
export function addMatchup(list: readonly Matchup[], name: string, id: string): Matchup[] {
  const sort_index = list.reduce((max, m) => Math.max(max, m.sort_index + 1), 0);
  return [...list, { id, name: name.trim(), sort_index, plans: SIDE_PLAN_POSITIONS.map(emptyPlan) }];
}

export const renameMatchup = (list: readonly Matchup[], id: string, name: string): Matchup[] =>
  list.map((m) => (m.id === id ? { ...m, name: name.trim() } : m));

export const removeMatchup = (list: readonly Matchup[], id: string): Matchup[] => list.filter((m) => m.id !== id);

const ZONE_WORD: Record<DeckZone, string> = { main: 'main', extra: 'extra' };
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Message d'un écart entre un plan et les zones (R1, R3, R5, S5), pour un refus ou un plan « à revoir ». */
export function describeIssue(issue: PlanIssue, name: (cardId: number) => string): string {
  switch (issue.kind) {
    case 'outgoing-missing':
      return `${name(issue.cardId)} : ${plural(issue.wanted, 'copie')} à sortir, ${issue.available} en ${ZONE_WORD[issue.zone]}.`;
    case 'incoming-missing':
      return `${name(issue.cardId)} : ${plural(issue.wanted, 'copie')} à faire entrer, ${issue.available} en side.`;
    case 'over-limit':
      return `${name(issue.cardId)} : ${issue.copies} copies dans le ${ZONE_WORD[issue.zone]} après échange — convention 1 à 3.`;
    case 'unknown-zone':
      return `${name(issue.cardId)} : zone inconnue (type de carte absent du catalogue) — main ou extra ?`;
  }
}

/** Ajoute des copies à une liste du plan ; une carte déjà engagée cumule. */
export function addCopies(list: readonly SidePlanCard[], add: readonly SidePlanCard[]): SidePlanCard[] {
  const out = copyList(list);
  for (const a of add) {
    const found = out.find((c) => c.card_id === a.card_id);
    if (found) found.copies += a.copies;
    else out.push({ ...a });
  }
  return out;
}

/** Retire des copies d'une liste du plan ; une carte tombée à 0 disparaît. */
export function removeCopies(list: readonly SidePlanCard[], remove: readonly SidePlanCard[]): SidePlanCard[] {
  return copyList(list)
    .map((c) => ({ ...c, copies: c.copies - (remove.find((r) => r.card_id === c.card_id)?.copies ?? 0) }))
    .filter((c) => c.copies > 0);
}

/** Le plan augmenté d'un échange (aussi le « plan + sélection » de l'aperçu). */
export const withSwap = (plan: SidePlan, delta: SwapDelta): SidePlan =>
  ({ ...plan, outgoing: addCopies(plan.outgoing, delta.outgoing), incoming: addCopies(plan.incoming, delta.incoming) });

const issueKey = (i: PlanIssue): string => `${i.kind}:${i.cardId}`;

/** Copies d'une liste par zone de jeu ; les cartes de zone inconnue sont nommées à part. */
export function countByZone(list: readonly SidePlanCard[], zoneOf: ZoneOf): { counts: Record<DeckZone, number>; unknown: number[] } {
  const counts: Record<DeckZone, number> = { main: 0, extra: 0 };
  const unknown: number[] = [];
  for (const c of list) {
    const zone = zoneOf(c.card_id);
    if (zone === null) unknown.push(c.card_id);
    else counts[zone] += c.copies;
  }
  return { counts, unknown };
}

export type SwapResult = { ok: true; plan: SidePlan } | { ok: false; reason: string };

/** La règle de l'échange, UNIQUE (geste « Échanger » et aperçu) : refusé si vide, si une carte a une
 *  zone inconnue (S5), si une zone n'est pas équilibrée (D10, S6 : autant de sortantes que d'entrantes
 *  dans le main, et de même dans l'extra), si une carte entrerait et sortirait du même plan (R2), ou
 *  si l'échange CRÉE un écart avec les zones (R1, R3) — un écart déjà là (plan « à revoir ») ne bloque
 *  pas un échange qui ne l'aggrave pas. */
export function trySwap(current: SidePlan, deck: PlanDeck, zoneOf: ZoneOf, delta: SwapDelta, name: (cardId: number) => string): SwapResult {
  const out = countByZone(delta.outgoing, zoneOf);
  const inn = countByZone(delta.incoming, zoneOf);
  const unknown = [...out.unknown, ...inn.unknown];
  if (unknown.length > 0) {
    return { ok: false, reason: `Échange refusé : ${unknown.map(name).join(', ')} — zone inconnue (type de carte absent du catalogue), impossible de dire si la carte va au main ou à l’extra.` };
  }
  const total = countOf(delta.outgoing) + countOf(delta.incoming);
  if (total === 0) return { ok: false, reason: 'Échange refusé : aucune copie sélectionnée.' };
  const unbalanced = (['main', 'extra'] as const).filter((z) => out.counts[z] !== inn.counts[z]);
  if (unbalanced.length > 0) {
    const touched = (['main', 'extra'] as const).filter((z) => out.counts[z] + inn.counts[z] > 0);
    const detail = (z: DeckZone) => `${plural(out.counts[z], 'copie')} sortante${out.counts[z] > 1 ? 's' : ''} pour ${inn.counts[z]} entrante${inn.counts[z] > 1 ? 's' : ''}`;
    const reason = touched.length === 1 && touched[0] === 'main'
      ? `Échange refusé : ${detail('main')} — il en faut autant de chaque côté.`
      : `Échange refusé : ${unbalanced.map((z) => `${ZONE_WORD[z]} ${detail(z)}`).join(' ; ')} — il en faut autant de chaque côté, zone par zone.`;
    return { ok: false, reason };
  }
  const next = withSwap(current, delta);
  const both = next.incoming.find((c) => next.outgoing.some((o) => o.card_id === c.card_id));
  if (both) return { ok: false, reason: `Échange refusé : ${name(both.card_id)} entrerait et sortirait du même plan.` };
  const before = new Set(applyPlan(deck, current, zoneOf).issues.map(issueKey));
  const created = applyPlan(deck, next, zoneOf).issues.find((i) => !before.has(issueKey(i)));
  if (created) return { ok: false, reason: `Échange refusé — ${describeIssue(created, name)}` };
  return { ok: true, plan: next };
}

export type SwapInPlanResult = { ok: true; matchups: Matchup[] } | { ok: false; reason: string };

/** Le geste « Échanger » : `trySwap` appliqué au plan d'un adversaire. */
export function swapInPlan(
  list: readonly Matchup[],
  id: string,
  position: SidePlanPosition,
  deck: PlanDeck,
  zoneOf: ZoneOf,
  delta: SwapDelta,
  name: (cardId: number) => string,
): SwapInPlanResult {
  const matchup = list.find((m) => m.id === id);
  if (!matchup) return { ok: false, reason: 'Échange refusé : adversaire introuvable.' };
  const r = trySwap(planOf(matchup, position), deck, zoneOf, delta, name);
  if (!r.ok) return r;
  return { ok: true, matchups: withPlan(list, id, position, () => r.plan) };
}

/** « Annuler l'échange » (D13) : retire du plan exactement les copies d'un échange passé. Si le plan a
 *  été retouché entre-temps, seules les copies encore présentes sont retirées, jamais moins que zéro. */
export function undoSwap(list: readonly Matchup[], id: string, position: SidePlanPosition, delta: SwapDelta): Matchup[] {
  return withPlan(list, id, position, (p) => ({ ...p, outgoing: removeCopies(p.outgoing, delta.outgoing), incoming: removeCopies(p.incoming, delta.incoming) }));
}

/** « Vider le plan » (D13) : plus aucun échange ; la note, elle, est un texte de l'utilisateur et reste. */
export const clearPlan = (list: readonly Matchup[], id: string, position: SidePlanPosition): Matchup[] =>
  withPlan(list, id, position, (p) => ({ ...p, outgoing: [], incoming: [] }));

/** Retire des copies d'une liste du plan (clic sur une copie engagée) ; le plan peut devenir
 *  « incomplet » (D11) : c'est voulu, rien n'est rééquilibré en silence. `copies` = Infinity retire
 *  toutes les copies de la carte (D13). */
export function removeFromPlan(list: readonly Matchup[], id: string, position: SidePlanPosition, direction: PlanDirection, cardId: number, copies = 1): Matchup[] {
  return withPlan(list, id, position, (p) => ({
    ...p,
    [direction]: p[direction].map((c) => (c.card_id === cardId ? { ...c, copies: c.copies - copies } : c)).filter((c) => c.copies > 0),
  }));
}

export const setPlanNote = (list: readonly Matchup[], id: string, position: SidePlanPosition, note: string): Matchup[] =>
  withPlan(list, id, position, (p) => ({ ...p, note: note.trim() ? note : null }));

/** Recopie un volet sur l'autre (« Recopier depuis premier ») : copie indépendante, note comprise. */
export function copyPlan(list: readonly Matchup[], id: string, from: SidePlanPosition, to: SidePlanPosition): Matchup[] {
  const matchup = list.find((m) => m.id === id);
  if (!matchup || from === to) return [...list];
  const source = planOf(matchup, from);
  return withPlan(list, id, to, () => ({ position: to, note: source.note, outgoing: copyList(source.outgoing), incoming: copyList(source.incoming) }));
}
