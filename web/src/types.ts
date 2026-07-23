export type Zone = 'main' | 'extra' | 'side';
export type Relevance = 'first' | 'second' | 'both';

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

export interface Category {
  id: string;
  name: string;
  relevance: Relevance;
  is_builtin: boolean;
}

/** Snapshot de la bibliothèque globale (§5). */
export interface Library {
  hoptCardIds: number[];
  pairs: ComboPair[];
  categories: Category[];
  cardCategories: Array<{ card_id: number; category_id: string }>;
}

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
