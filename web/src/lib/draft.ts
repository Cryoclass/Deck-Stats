import type { DeckCard } from '../types.js';

/**
 * Brouillon local automatique (§4B) — écrit en continu dans IndexedDB, indépendamment
 * de la base. Donne la sécurité de l'autosave sans casser le modèle mental de la
 * sauvegarde explicite : au retour sur un deck ayant un brouillon, on propose de le
 * reprendre. Le brouillon ne contient QUE les données locales au deck.
 */
export interface DeckDraft {
  deckId: string;
  updatedAt: number;
  name: string;
  main: DeckCard[];
  extra: DeckCard[];
  side: DeckCard[];
  starters: number[];
  pairExclusions: string[];
  horizonFirst: number;
  horizonSecond: number;
  importance: number;
}

const DB_NAME = 'ygo-proba';
const STORE = 'deck-drafts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'deckId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDraft(draft: DeckDraft): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(draft));
  } catch {
    /* IndexedDB indisponible (mode privé, quota…) : on n'interrompt jamais l'UI. */
  }
}

export async function loadDraft(deckId: string): Promise<DeckDraft | null> {
  try {
    const d = await withStore<DeckDraft | undefined>('readonly', (s) => s.get(deckId));
    return d ?? null;
  } catch {
    return null;
  }
}

export async function clearDraft(deckId: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(deckId));
  } catch {
    /* ignore */
  }
}
