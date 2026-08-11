import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, UNAUTHORIZED_EVENT, type AuthUser } from './api.js';
import { clearAllDrafts } from './draft.js';

/** États d'authentification (itération 8, Lot C) :
 *  - loading        sonde /api/auth/me en cours (écran d'attente)
 *  - anonymous      backend joignable mais pas de session → page de connexion
 *  - offline        backend INJOIGNABLE : l'app reste utilisable sans persistance
 *                   (annotations en mémoire + URL, cf. README) — pas de login possible
 *  - authenticated  session valide */
export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'offline' }
  | { status: 'authenticated'; user: AuthUser };

interface AuthCtx {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (body: {
    email: string;
    password: string;
    display_name?: string;
    invite_code: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // Sonde initiale : 401 = anonyme ; échec réseau = hors-ligne (≠ anonyme :
  // on ne présente pas une page de connexion qui ne peut pas aboutir).
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ user }) => !cancelled && setState({ status: 'authenticated', user }))
      .catch((e) => {
        if (cancelled) return;
        setState(
          e instanceof ApiError && e.status === 401 ? { status: 'anonymous' } : { status: 'offline' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Session expirée en cours d'usage : un 401 sur une route protégée renvoie au
  // login (émis par api.ts — jamais confondu avec une panne réseau).
  useEffect(() => {
    const onUnauthorized = () => setState({ status: 'anonymous' });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = async (email: string, password: string) => {
    const { user } = await api.login(email, password); // l'erreur remonte au formulaire
    setState({ status: 'authenticated', user });
  };

  const register: AuthCtx['register'] = async (body) => {
    const { user } = await api.register(body);
    setState({ status: 'authenticated', user });
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* la session sera de toute façon invalide côté client */
    }
    // Les brouillons contiennent des decks entiers : ils ne survivent pas à un
    // changement de compte sur un poste partagé.
    await clearAllDrafts();
    // Rechargement complet : aucun résidu d'état en mémoire (store Zustand compris)
    // d'un compte à l'autre.
    window.location.assign('/decks');
  };

  return <Ctx.Provider value={{ state, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth hors AuthProvider');
  return ctx;
}
