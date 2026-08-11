import type { Card, Library, Relevance, Zone } from '../types.js';

const BASE = '/api';

/** Erreur API typée : `status` permet de distinguer un 401 (session) d'un 4xx métier. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Session absente ou expirée sur une route protégée (itération 8). À distinguer du
// mode « hors-ligne » (panne réseau, fetch qui REJETTE) : ici le backend répond, il
// refuse. La couche auth écoute cet événement et renvoie à la page de connexion.
export const UNAUTHORIZED_EVENT = 'ygo:unauthorized';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  // Ne déclarer le content-type JSON QUE s'il y a un corps : sinon Fastify rejette une
  // requête sans corps (DELETE, POST duplicate…) avec FST_ERR_CTP_EMPTY_JSON_BODY (400).
  const hasBody = init?.body != null;
  const res = await fetch(BASE + url, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // Message d'erreur du serveur si disponible (ex. « code d'invitation invalide »).
    let message = `${init?.method ?? 'GET'} ${url} → ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* corps non-JSON : message générique */
    }
    // Sur /auth/*, le 401 est une réponse normale (mauvais identifiants, sonde /me).
    if (res.status === 401 && !url.startsWith('/auth')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, message);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  providers?: string[]; // fournisseurs OAuth liés (Lot D) — ex. ['discord']
  has_password?: boolean; // false = compte Discord seul (déliaison refusée)
}

export interface DeckSummaryStats {
  startRateFirst?: number;
  brickRate?: number;
  mainSize?: number;
}
export interface DeckSummary {
  id: string;
  name: string;
  main_count: number;
  updated_at: string;
  summary: DeckSummaryStats | null;
  sample_cards: Array<number | string> | null;
}
export interface DeckRequirementRow {
  id: string;
  source_card_id: number | null;
  source_pair_id: string | null;
  required_card_id: number;
  min_in_deck: number;
}
export interface DeckDetail {
  id: string;
  name: string;
  cards: Array<{ card_id: number; zone: Zone; copies: number }>;
  starters: number[];
  pair_exclusions: string[];
  start_requirements?: DeckRequirementRow[];
  params?: Record<string, unknown> | null;
  summary?: DeckSummaryStats | null;
  notes?: string | null;
  updated_at?: string;
}

export const api = {
  health: () => j<{ ok: boolean; cards: number }>('/health'),

  // Auth (itération 8)
  me: () => j<{ user: AuthUser }>('/auth/me'),
  login: (email: string, password: string) =>
    j<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (body: {
    email: string;
    password: string;
    display_name?: string;
    invite_code: string;
  }) => j<{ user: AuthUser }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => j<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  authProviders: () => j<{ discord: boolean }>('/auth/providers'),
  unlinkDiscord: () => j<{ ok: boolean }>('/auth/discord', { method: 'DELETE' }),

  // Catalogue
  cardsByIds: (ids: number[]) =>
    ids.length ? j<Card[]>(`/cards?ids=${ids.join(',')}`) : Promise.resolve([]),
  searchCards: (q: string) => j<Card[]>(`/cards/search?q=${encodeURIComponent(q)}`),

  // Decks
  listDecks: () => j<DeckSummary[]>('/decks'),
  getDeck: (id: string) => j<DeckDetail>(`/decks/${id}`),
  createDeck: (name: string, cards: DeckDetail['cards']) =>
    j<{ id: string }>('/decks', { method: 'POST', body: JSON.stringify({ name, cards }) }),
  updateDeck: (
    id: string,
    patch: {
      name?: string;
      cards?: DeckDetail['cards'];
      params?: unknown;
      summary?: DeckSummaryStats;
      notes?: string | null;
    },
  ) => j<{ ok: boolean }>(`/decks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  duplicateDeck: (id: string) =>
    j<{ id: string }>(`/decks/${id}/duplicate`, { method: 'POST' }),
  deleteDeck: (id: string) => j<{ ok: boolean }>(`/decks/${id}`, { method: 'DELETE' }),
  setStarters: (id: string, cardIds: number[]) =>
    j(`/decks/${id}/starters`, { method: 'PUT', body: JSON.stringify({ cardIds }) }),
  setPairExclusions: (id: string, pairIds: string[]) =>
    j(`/decks/${id}/pair-exclusions`, { method: 'PUT', body: JSON.stringify({ pairIds }) }),
  setStartRequirements: (
    id: string,
    requirements: Array<{
      source_card_id?: number | null;
      source_pair_id?: string | null;
      required_card_id: number;
      min_in_deck?: number;
    }>,
  ) =>
    j(`/decks/${id}/start-requirements`, {
      method: 'PUT',
      body: JSON.stringify({ requirements }),
    }),

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
