import type { Availability, Card, Library, Zone, ComboPair, NonEngineGroup } from '../types.js';
import { emptyConfiguration, type Configuration, type StartCondition } from '../../../server/src/domain/deckConfiguration.js';
import type { DeckArchive } from '../../../server/src/domain/deckArchive.js';
import type { DeckSummary as DeckPreview } from './summary.js';

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
      const body = JSON.parse(text) as { error?: string; message?: string };
      if (body?.message) message = body.message;
      else if (body?.error) message = body.error;
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

/** Résumé stocké (étape 9) : forme validée par le serveur, mais la VERSION du moteur n'est
 *  vérifiée qu'à l'affichage (`lib/summary.ts`, `usableSummary`) — d'où `unknown` ici. */
export interface DeckSummary {
  id: string;
  name: string;
  main_count: number;
  updated_at: string;
  summary: unknown;
  sample_cards: Array<number | string> | null;
}
export interface DeckDetail {
  revision: number;
  configuration_version: 2;
  pairs: Array<ComboPair & { disabled: boolean }>;
  deadFirst: number[];
  deadSecond: number[];
  id: string;
  name: string;
  cards: Array<{ card_id: number; zone: Zone; copies: number }>;
  starters: number[];
  pair_exclusions: string[];
  conditions?: StartCondition[];
  params?: Record<string, unknown> | null;
  summary?: unknown;
  notes?: string | null;
  updated_at?: string;
}

/** Drapeaux d'une carte pour le compte : chaque champ absent est laissé tel quel. */
export interface CardFlagsPatch {
  is_hopt?: boolean;
  availability?: Availability | null;
  group_id?: string | null;
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
    j<{ id: string }>('/decks', { method: 'POST', body: JSON.stringify(emptyConfiguration(name,cards)) }),
  // Étape 9 : le résumé (aperçu) n'est joint que s'il est frais (lib/summary.ts) ; absent, le
  // serveur laisse `summary` à NULL et l'accueil recalcule.
  saveConfiguration: (id: string, configuration: Configuration, expectedRevision: number, summary: DeckPreview | null = null) =>
    j<{ revision: number }>(`/decks/${id}`, { method: 'PUT', body: JSON.stringify({ configuration, expectedRevision, ...(summary ? { summary } : {}) }) }),
  putSummary: (id: string, summary: DeckPreview, expectedRevision: number) =>
    j<{ ok: boolean; revision: number }>(`/decks/${id}/summary`, { method: 'PUT', body: JSON.stringify({ summary, expectedRevision }) }),
  importArchive: (archive: DeckArchive) => j<{ id: string }>('/decks/import', { method: 'POST', body: JSON.stringify(archive) }),
  renameDeck: (id: string, name: string) => j(`/decks/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  duplicateDeck: (id: string) =>
    j<{ id: string }>(`/decks/${id}/duplicate`, { method: 'POST' }),
  deleteDeck: (id: string) => j<{ ok: boolean }>(`/decks/${id}`, { method: 'DELETE' }),
  // Bibliothèque globale
  getLibrary: () => j<Library>('/library'),
  setFlags: (cardId: number, flags: CardFlagsPatch) =>
    j<{ ok: boolean; is_hopt: boolean; availability: Availability | null; group_id: string | null }>(`/library/flags/${cardId}`, { method: 'PUT', body: JSON.stringify(flags) }),
  addCategory: (name: string, id?: string) =>
    j<{ id: string; name: string; is_builtin: boolean }>(
      '/library/categories',
      { method: 'POST', body: JSON.stringify({ name, id }) },
    ),
  deleteCategory: (id: string) => j(`/library/categories/${id}`, { method: 'DELETE' }),
  addCardCategory: (cardId: number, categoryId: string) =>
    j('/library/card-categories', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, category_id: categoryId }),
    }),
  removeCardCategory: (cardId: number, categoryId: string) =>
    j(`/library/card-categories/${cardId}/${categoryId}`, { method: 'DELETE' }),
  // Plafonds partagés (étape 5B)
  addGroup: (name: string, capPerTurn: number, id?: string) =>
    j<NonEngineGroup>('/library/groups', { method: 'POST', body: JSON.stringify({ id, name, cap_per_turn: capPerTurn }) }),
  updateGroup: (id: string, patch: { name?: string; cap_per_turn?: number }) =>
    j<NonEngineGroup>(`/library/groups/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteGroup: (id: string) => j<{ ok: boolean }>(`/library/groups/${id}`, { method: 'DELETE' }),
};
