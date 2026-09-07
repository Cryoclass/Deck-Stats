import type { Availability, ConditionNode } from '../../server/src/domain/deckConfiguration.js';

export type Zone = 'main' | 'extra' | 'side';
export type { Availability, ConditionNode };

export interface Card {
  id: number;
  name: string;
  type?: string | null;
  race?: string | null;
  attribute?: string | null;
  atk?: number | null;
  def?: number | null;
  level?: number | null;
  description?: string | null;
  image_url?: string | null;
  image_url_small?: string | null;
  image_url_cropped?: string | null;
}

export interface DeckCard {
  cardId: number;
  zone: Zone;
  copies: number;
}

export interface ComboPair {
  id: string;
  card_a_id: number;
  card_b_id: number;
  note?: string | null;
}

/** Catégorie non-engine = étiquette manuelle du compte (contrat §3). La pertinence
 *  historique n'existe plus (Q4) : les fenêtres viennent du profil de la carte. */
export interface Category {
  id: string;
  name: string;
  is_builtin: boolean;
}

/** Profil de disponibilité d'une carte pour ce compte, avec son plafond partagé éventuel. */
export interface CardProfile {
  availability: Availability;
  groupId: string | null;
}

/** Plafond partagé par tour (contrat §3), commun aux decks du compte. */
export interface NonEngineGroup {
  id: string;
  name: string;
  cap_per_turn: number;
}

/** Condition ET/OU (étape 5) — locale au deck. Exactement une source (carte starter
 *  OU paire de combo) ; l'arbre porte des feuilles « il reste ≥ n copies en deck ». */
export interface StartCondition {
  id: string;
  sourceCardId: number | null;
  sourcePairId: string | null;
  condition: ConditionNode;
}

/** Snapshot de la bibliothèque globale (§5). */
export interface Library {
  hoptCardIds: number[];
  categories: Category[];
  cardCategories: Array<{ card_id: number; category_id: string }>;
  profiles: Array<{ card_id: number; availability: Availability; group_id: string | null }>;
  groups: NonEngineGroup[];
}

/** Libellés français des profils (contrat §3, tableau des profils). */
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  early: 'Précoce',
  flexible: 'Flexible',
  prepared: 'Préparée',
  breaker: 'Board breaker',
};
export const AVAILABILITY_SHORT: Record<Availability, string> = {
  early: 'Pc',
  flexible: 'Fx',
  prepared: 'Pp',
  breaker: 'Bb',
};
export const AVAILABILITY_HINT: Record<Availability, string> = {
  early: 'Type Mulcharmy : tour adverse initial en second seulement ; rien en premier, rien en sixième carte.',
  flexible: 'Type handtrap : tour adverse suivant en premier ; tour adverse ou tour propre en second (sixième : tour propre).',
  prepared: 'Type magie rapide à poser : tour adverse suivant en premier ; tour propre en second.',
  breaker: 'Utile en second seulement (tour propre) ; aucune fenêtre retenue en premier.',
};

/** Image dérivée de l'id — le CDN suit toujours ce schéma (reutiliser-la-bdd.md). */
export function imageSmall(id: number): string {
  return `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`;
}
export function imageCropped(id: number): string {
  return `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`;
}

/** Clé canonique d'une paire (a<=b), cohérente avec la contrainte SQL (§A). */
export function pairKey(a: number, b: number): string {
  return a <= b ? `${a}:${b}` : `${b}:${a}`;
}
