import type { DeckCard, Matchup, SidePlan, SidePlanCard, SidePlanPosition } from '../types.js';
import { SIDE_PLAN_POSITIONS } from '../../../server/src/domain/deckConfiguration.js';
import { applyPlan, type PlanIssue } from './sidePlan.js';

// ─── Adversaires et plans de side (étape 10C) : mutations PURES, rendues au store ───
// Aucune ne touche au deck de base ni ne recalcule : un plan n'entre jamais dans le modèle moteur
// du deck (il est calculé à part, lib/sidePlan.ts). Un refus est un message, jamais une réduction
// silencieuse ; une retouche peut déséquilibrer un plan (D11), c'est l'état « incomplet ».

export type PlanDirection = 'outgoing' | 'incoming';

export const emptyPlan = (position: SidePlanPosition): SidePlan => ({ position, note: null, outgoing: [], incoming: [] });

/** Plan d'une position ; un volet absent vaut un plan vide. */
export const planOf = (matchup: Matchup, position: SidePlanPosition): SidePlan =>
  matchup.plans.find((p) => p.position === position) ?? emptyPlan(position);

const copyList = (list: readonly SidePlanCard[]): SidePlanCard[] => list.map((c) => ({ ...c }));
const countOf = (list: readonly SidePlanCard[]): number => list.reduce((n, c) => n + c.copies, 0);

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

/** Message d'un écart entre un plan et les zones (R1, R3, R5), pour un refus ou un plan « à revoir ». */
export function describeIssue(issue: PlanIssue, name: (cardId: number) => string): string {
  switch (issue.kind) {
    case 'outgoing-missing':
      return `${name(issue.cardId)} : ${issue.wanted} copie${issue.wanted > 1 ? 's' : ''} à sortir, ${issue.available} en main.`;
    case 'incoming-missing':
      return `${name(issue.cardId)} : ${issue.wanted} copie${issue.wanted > 1 ? 's' : ''} à faire entrer, ${issue.available} en side.`;
    case 'over-limit':
      return `${name(issue.cardId)} : ${issue.copies} copies dans le main après échange — convention 1 à 3.`;
  }
}

function addCopies(list: readonly SidePlanCard[], add: readonly SidePlanCard[]): SidePlanCard[] {
  const out = copyList(list);
  for (const a of add) {
    const found = out.find((c) => c.card_id === a.card_id);
    if (found) found.copies += a.copies;
    else out.push({ ...a });
  }
  return out;
}

const issueKey = (i: PlanIssue): string => `${i.kind}:${i.cardId}`;

export type SwapResult = { ok: true; matchups: Matchup[] } | { ok: false; reason: string };

/** Le geste « Échanger » : ajoute des copies sortantes et entrantes au plan. Refusé si la
 *  sélection n'est pas équilibrée (D10), si une carte entrerait et sortirait du même plan (R2), ou
 *  si l'échange CRÉE un écart avec les zones (R1, R3) — un écart déjà là (plan « à revoir ») ne
 *  bloque pas un échange qui ne l'aggrave pas. */
export function swapInPlan(
  list: readonly Matchup[],
  id: string,
  position: SidePlanPosition,
  main: readonly DeckCard[],
  side: readonly DeckCard[],
  outgoing: readonly SidePlanCard[],
  incoming: readonly SidePlanCard[],
  name: (cardId: number) => string,
): SwapResult {
  const out = countOf(outgoing);
  const inn = countOf(incoming);
  if (out === 0 || out !== inn) {
    return { ok: false, reason: `Échange refusé : ${out} copie${out > 1 ? 's' : ''} sortante${out > 1 ? 's' : ''} pour ${inn} entrante${inn > 1 ? 's' : ''} — il en faut autant de chaque côté.` };
  }
  const matchup = list.find((m) => m.id === id);
  if (!matchup) return { ok: false, reason: 'Échange refusé : adversaire introuvable.' };
  const current = planOf(matchup, position);
  const next: SidePlan = { ...current, outgoing: addCopies(current.outgoing, outgoing), incoming: addCopies(current.incoming, incoming) };
  const both = next.incoming.find((c) => next.outgoing.some((o) => o.card_id === c.card_id));
  if (both) return { ok: false, reason: `Échange refusé : ${name(both.card_id)} entrerait et sortirait du même plan.` };
  const before = new Set(applyPlan(main, side, current).issues.map(issueKey));
  const created = applyPlan(main, side, next).issues.find((i) => !before.has(issueKey(i)));
  if (created) return { ok: false, reason: `Échange refusé — ${describeIssue(created, name)}` };
  return { ok: true, matchups: withPlan(list, id, position, () => next) };
}

/** Retire des copies d'une liste du plan (clic sur une copie engagée) ; le plan peut devenir
 *  « incomplet » (D11) : c'est voulu, rien n'est rééquilibré en silence. */
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
