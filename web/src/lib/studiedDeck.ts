import type { DeckCard, Matchup, SidePlan, SidePlanPosition } from '../types.js';
import { SIDE_PLAN_POSITIONS } from '../../../server/src/domain/deckConfiguration.js';
import type { EngineModelSource } from './engineModel.js';
import { describeIssue, planOf } from './matchups.js';
import { applyPlan, sidedSource, type AppliedPlan, type ZoneOf } from './sidePlan.js';

// ─── Deck étudié (plans de side v2, D1, D2, D16, S1, S2) ───
// L'éditeur étudie le deck de base, ou un adversaire : contre un adversaire, la position « premier »
// étudie le deck après le plan premier, la position « second » le deck après le plan second. Tout
// chiffre de l'éditeur porte sur le deck étudié de sa position et le nomme (S1). Une position dont le
// plan n'est pas prêt n'a AUCUNE source : jamais le deck de base à sa place (S2).
// Ce module est pur et HORS de `__ENGINE_VERSION__` ; c'est l'unique point de greffe de « Mains
// types » (D16) : tout consommateur de chiffres passe par `studiedDecks`.

export interface StudySource extends EngineModelSource {
  extra: DeckCard[];
  side: DeckCard[];
  matchups: Matchup[];
}

export interface StudiedDeck {
  position: SidePlanPosition;
  /** `base` = le deck de base ; `sided` = le deck après le plan de cet adversaire dans cette position. */
  kind: 'base' | 'sided';
  matchup: { id: string; name: string } | null;
  plan: SidePlan | null;
  applied: AppliedPlan | null;
  /** Source du moteur ; `null` si le plan n'est pas prêt (S2). */
  source: EngineModelSource | null;
  /** Nom court du deck étudié (S1) : « Deck de base » ou « contre Kewl Tune · premier ». */
  label: string;
  /** Pourquoi il n'y a pas de source, en clair ; `null` quand il y en a une. */
  unavailableReason: string | null;
}

export const POSITION_WORD: Record<SidePlanPosition, string> = { first: 'premier', second: 'second' };
const defaultName = (cardId: number): string => `#${cardId}`;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Pourquoi un plan n'a pas de chiffres (S2) : déséquilibre dit zone par zone, écarts nommés (S5). */
export function unavailableReasonOf(applied: AppliedPlan, position: SidePlanPosition, name: (cardId: number) => string = defaultName): string | null {
  if (applied.status === 'ready') return null;
  if (applied.status === 'review') return `Plan ${POSITION_WORD[position]} à revoir — ${applied.issues.map((i) => describeIssue(i, name)).join(' ')} Aucun chiffre tant qu’il n’est pas corrigé.`;
  const zones = (['main', 'extra'] as const).filter((z) => applied.zones[z].outgoing !== applied.zones[z].incoming);
  const detail = zones.map((z) => `${z} ${plural(applied.zones[z].outgoing, 'sortante')} pour ${applied.zones[z].incoming} entrante${applied.zones[z].incoming > 1 ? 's' : ''}`).join(', ');
  return `Plan ${POSITION_WORD[position]} incomplet : ${detail} — aucun chiffre tant que chaque zone ne s’équilibre pas.`;
}

export const BASE_LABEL = 'Deck de base';
export const studyLabel = (matchupName: string | null, position: SidePlanPosition): string =>
  matchupName === null ? BASE_LABEL : `contre ${matchupName} · ${POSITION_WORD[position]}`;

function baseDeck(state: StudySource, position: SidePlanPosition): StudiedDeck {
  return { position, kind: 'base', matchup: null, plan: null, applied: null, source: state, label: BASE_LABEL, unavailableReason: null };
}

/** Le deck étudié d'une position. Un adversaire inconnu (supprimé, autre deck) retombe sur le deck de
 *  base : l'appelant compare `matchup` à ce qu'il a demandé pour le dire. */
export function studiedDeck(state: StudySource, matchupId: string | null, position: SidePlanPosition, zoneOf: ZoneOf, name: (cardId: number) => string = defaultName): StudiedDeck {
  if (matchupId === null) return baseDeck(state, position);
  const matchup = state.matchups.find((m) => m.id === matchupId);
  if (!matchup) return baseDeck(state, position);
  const plan = planOf(matchup, position);
  const applied = applyPlan({ main: state.main, extra: state.extra, side: state.side }, plan, zoneOf);
  const source = sidedSource(state, applied);
  return { position, kind: 'sided', matchup: { id: matchup.id, name: matchup.name }, plan, applied, source, label: studyLabel(matchup.name, position), unavailableReason: unavailableReasonOf(applied, position, name) };
}

/** Les deux decks étudiés d'un contexte (D2 : deux colonnes, un plan chacune). */
export function studiedDecks(state: StudySource, matchupId: string | null, zoneOf: ZoneOf, name: (cardId: number) => string = defaultName): Record<SidePlanPosition, StudiedDeck> {
  return Object.fromEntries(SIDE_PLAN_POSITIONS.map((p) => [p, studiedDeck(state, matchupId, p, zoneOf, name)])) as Record<SidePlanPosition, StudiedDeck>;
}

/** Deux decks étudiés ont la même composition de main : leur entrée du moteur est identique, un seul
 *  calcul suffit (D4). Comparaison du main dérivé, pas de l'étiquette — un plan vide vaut le deck de
 *  base, deux plans aux mêmes échanges valent le même deck. */
export function sameMain(a: readonly DeckCard[] | null, b: readonly DeckCard[] | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(a.map((c) => [c.cardId, c.copies])) === JSON.stringify(b.map((c) => [c.cardId, c.copies]));
}
