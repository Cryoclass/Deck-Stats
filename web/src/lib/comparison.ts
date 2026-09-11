import type { EngineInput, PassResult } from '../engine/types.js';
import type { Library, SidePlanPosition } from '../types.js';
import type { DeckDetail } from './api.js';
import type { EngineModelSource } from './engineModel.js';
import { configurationFromDetail, libraryState, stateFromConfiguration } from './deckConfiguration.js';
import { applyPlan, sidedSource } from './sidePlan.js';
import { planOf } from './matchups.js';
import {
  scenarioCounts,
  toComparisonMatrix,
  type ComparisonDeck,
  type ComparisonWarning,
} from '../engine/compare.js';

// ─── Assemblage d'un deck du comparateur (étape 7) ───
// Extrait de ComparePage.tsx sans changement : ce que le comparateur soumet à
// `compareDecks` est construit ici, en pur, pour que le test d'identité des données
// (dataIdentity.test.ts) suive exactement le chemin de l'écran. `compare.ts` (moteur)
// n'est pas modifié.

/** Deux passes (mode `passes` du worker : sans contributions marginales). */
export interface Passes {
  first: PassResult;
  second: PassResult;
}

export function comparisonDeckOf(name: string, input: EngineInput, passes: Passes): ComparisonDeck {
  return {
    name,
    matrices: {
      going_first: toComparisonMatrix(passes.first, 'going_first', scenarioCounts(input, 'going_first')),
      going_second: toComparisonMatrix(passes.second, 'going_second', scenarioCounts(input, 'going_second')),
    },
  };
}

/** Q5 : une carte étiquetée sans profil compte zéro dans le potentiel — à dire en
 *  clair, sinon un écart non-engine pourrait venir de l'annotation, pas des cartes.
 *  Renvoie `null` s'il n'y a rien à signaler. */
export function unprofiledWarning(name: string, unprofiledCardIds: number[]): ComparisonWarning | null {
  const n = unprofiledCardIds.length;
  if (n === 0) return null;
  const s = n > 1 ? 's' : '';
  return {
    severity: 'warning',
    code: 'unprofiled',
    message: `« ${name} » : ${n} carte${s} non-engine sans profil, non comptée${s} dans le potentiel.`,
  };
}

// ─── Étape 10D : comparer un deck à son deck sidé ───
// Un côté du comparateur peut être un deck avec le plan d'un adversaire appliqué : segment d'URL
// `deck~adversaire~position`. Seul un plan prêt se compare (R4, R5) ; le deck sidé porte toutes les
// annotations du deck (R6) et un nom qui le dit. Le moteur et `compare.ts` ne changent pas.

export interface CompareTarget {
  deckId: string;
  plan: { matchupId: string; position: SidePlanPosition } | null;
}

export const compareSegment = (deckId: string, matchupId: string, position: SidePlanPosition): string => `${deckId}~${matchupId}~${position}`;

export function parseCompareTarget(segment: string): CompareTarget {
  const [deckId, matchupId, position, ...rest] = segment.split('~');
  if (matchupId === undefined) return { deckId, plan: null };
  if (!matchupId || (position !== 'first' && position !== 'second') || rest.length > 0) {
    throw new Error('Adresse de comparaison invalide : deck~adversaire~position attendu.');
  }
  return { deckId, plan: { matchupId, position } };
}

export interface CompareSide {
  name: string;
  source: EngineModelSource;
  plan: { matchupName: string; position: SidePlanPosition } | null;
}

const POSITION_WORD: Record<SidePlanPosition, string> = { first: 'premier', second: 'second' };

export function compareSideOf(detail: DeckDetail, library: Library, target: CompareTarget): CompareSide {
  const state = { ...stateFromConfiguration(configurationFromDetail(detail)), ...libraryState(library) };
  if (!target.plan) return { name: detail.name, source: state, plan: null };
  const { matchupId, position } = target.plan;
  const matchup = state.matchups.find((m) => m.id === matchupId);
  if (!matchup) throw new Error(`« ${detail.name} » : adversaire introuvable (supprimé depuis ?).`);
  const applied = applyPlan(state.main, state.side, planOf(matchup, position));
  const sided = sidedSource(state, applied);
  if (!sided) {
    throw new Error(`Plan ${POSITION_WORD[position]} contre « ${matchup.name} » ${applied.status === 'incomplete' ? 'incomplet' : 'à revoir'} : rien à comparer tant qu’il n’est pas prêt.`);
  }
  return { name: `${detail.name} — ${matchup.name} (${POSITION_WORD[position]})`, source: sided, plan: { matchupName: matchup.name, position } };
}

/** Note d'information d'un côté sidé : son plan ne vaut que dans sa position (R7). */
export function sidedNotice(side: CompareSide): ComparisonWarning | null {
  if (!side.plan) return null;
  const pos = POSITION_WORD[side.plan.position];
  const other = POSITION_WORD[side.plan.position === 'first' ? 'second' : 'first'];
  return {
    severity: 'info',
    code: 'sided',
    message: `« ${side.name} » : deck après le plan ${pos} contre « ${side.plan.matchupName} » — seul le scénario ${pos} correspond à ce plan, le scénario ${other} est donné pour information.`,
  };
}
