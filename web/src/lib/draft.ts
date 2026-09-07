import { parseConfiguration, type Configuration } from '../../../server/src/domain/deckConfiguration.js';

export interface DeckDraft {
  version: 2;
  deckId: string;
  updatedAt: number;
  baseRevision: number;
  configuration: Configuration;
}
const STORE = 'deck-drafts';
let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject) => {
    const request = indexedDB.open('ygo-proba',1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE,{ keyPath: 'deckId' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null;reject(request.error); };
  });
  return dbPromise;
}

// Resolve on COMMIT, not request success; aborted transactions must never look saved.
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, result: (v:T) => void) => void): Promise<T> {
  const db = await openDb();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(STORE,mode);let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Brouillon non enregistré.'));
    action(tx.objectStore(STORE),(v) => { value=v; });
  });
}

export function validDraft(value: unknown): DeckDraft | null {
  const d = value as Partial<DeckDraft> | null;
  if (!d || d.version !== 2 || typeof d.deckId !== 'string' || !Number.isInteger(d.baseRevision)) return null;
  try { return { ...d,configuration: parseConfiguration(d.configuration) } as DeckDraft; } catch { return null; }
}
export async function saveDraft(draft: DeckDraft): Promise<void> {
  try { await transaction<void>('readwrite',(s) => { s.put(draft); }); } catch { /* Optional local recovery. */ }
}
export async function loadDraft(id: string): Promise<DeckDraft | null> {
  try {
    return await transaction('readonly',(s,result) => { s.get(id).onsuccess = (e) => result(validDraft((e.target as IDBRequest).result)); });
  } catch { return null; }
}

/** A save may only clear the matching draft, never a newer edit. */
export async function clearDraft(id: string, saved?: Configuration): Promise<void> {
  try {
    await transaction<void>('readwrite',(s) => {
      if (!saved) { s.delete(id);return; }
      s.get(id).onsuccess = (e) => {
        const d = validDraft((e.target as IDBRequest).result);
        if (d && JSON.stringify(d.configuration) === JSON.stringify(saved)) s.delete(id);
      };
    });
  } catch { /* Optional local recovery. */ }
}
export async function clearAllDrafts(): Promise<void> {
  try { await transaction<void>('readwrite',(s) => { s.clear(); }); } catch { /* Optional local recovery. */ }
}
