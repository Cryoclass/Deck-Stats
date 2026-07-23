import type { Card, Library, Relevance, Zone } from '../types.js';

const BASE = '/api';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface DeckSummary {
  id: string;
  name: string;
  main_count: number;
  updated_at: string;
}
export interface DeckDetail {
  id: string;
  name: string;
  cards: Array<{ card_id: number; zone: Zone; copies: number }>;
  starters: number[];
  pair_exclusions: string[];
}

export const api = {
  health: () => j<{ ok: boolean; cards: number }>('/health'),

  // Catalogue
  cardsByIds: (ids: number[]) =>
    ids.length ? j<Card[]>(`/cards?ids=${ids.join(',')}`) : Promise.resolve([]),
  searchCards: (q: string) => j<Card[]>(`/cards/search?q=${encodeURIComponent(q)}`),

  // Decks
  listDecks: () => j<DeckSummary[]>('/decks'),
  getDeck: (id: string) => j<DeckDetail>(`/decks/${id}`),
  createDeck: (name: string, cards: DeckDetail['cards']) =>
    j<{ id: string }>('/decks', { method: 'POST', body: JSON.stringify({ name, cards }) }),
  updateDeck: (id: string, patch: { name?: string; cards?: DeckDetail['cards'] }) =>
    j<{ ok: boolean }>(`/decks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  setStarters: (id: string, cardIds: number[]) =>
    j(`/decks/${id}/starters`, { method: 'PUT', body: JSON.stringify({ cardIds }) }),
  setPairExclusions: (id: string, pairIds: string[]) =>
    j(`/decks/${id}/pair-exclusions`, { method: 'PUT', body: JSON.stringify({ pairIds }) }),

  // Bibliothèque globale
  getLibrary: () => j<Library>('/library'),
  setFlags: (
    cardId: number,
    flags: { is_hopt?: boolean; dead_first?: boolean; dead_second?: boolean },
  ) => j(`/library/flags/${cardId}`, { method: 'PUT', body: JSON.stringify(flags) }),
  addPair: (a: number, b: number, note?: string) =>
    j<{ id: string; card_a_id: number; card_b_id: number; note: string | null }>('/library/pairs', {
      method: 'POST',
      body: JSON.stringify({ card_a_id: a, card_b_id: b, note }),
    }),
  deletePair: (id: string) => j(`/library/pairs/${id}`, { method: 'DELETE' }),
  addCategory: (name: string, relevance: Relevance) =>
    j<{ id: string; name: string; relevance: Relevance; is_builtin: boolean }>(
      '/library/categories',
      { method: 'POST', body: JSON.stringify({ name, relevance }) },
    ),
  deleteCategory: (id: string) => j(`/library/categories/${id}`, { method: 'DELETE' }),
  addCardCategory: (cardId: number, categoryId: string) =>
    j('/library/card-categories', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, category_id: categoryId }),
    }),
  removeCardCategory: (cardId: number, categoryId: string) =>
    j(`/library/card-categories/${cardId}/${categoryId}`, { method: 'DELETE' }),
};
