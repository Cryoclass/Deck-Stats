import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Routeur minimal (§4C) : accueil `/decks`, éditeur `/decks/:id`, comparateur
 *  `/compare/:a/:b` (itération 9). Pas de dépendance externe — on contrôle toute la
 *  navigation via l'API History. */
export type Route =
  | { name: 'home' }
  | { name: 'editor'; id: string }
  | { name: 'compare'; a: string; b: string };

function parse(pathname: string): Route {
  const c = pathname.match(/^\/compare\/([^/?#]+)\/([^/?#]+)/);
  if (c) return { name: 'compare', a: decodeURIComponent(c[1]), b: decodeURIComponent(c[2]) };
  const m = pathname.match(/^\/decks\/([^/?#]+)/);
  return m ? { name: 'editor', id: decodeURIComponent(m[1]) } : { name: 'home' };
}

function toPath(route: Route): string {
  if (route.name === 'editor') return `/decks/${route.id}`;
  if (route.name === 'compare') return `/compare/${route.a}/${route.b}`;
  return '/decks';
}

interface RouterCtx {
  route: Route;
  navigate: (to: Route) => void;
}
const Ctx = createContext<RouterCtx | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parse(window.location.pathname));

  // L'app ouvre sur /decks : normalise l'URL initiale si besoin.
  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState(null, '', '/decks');
    }
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to: Route) => {
    const path = toPath(to);
    if (path !== window.location.pathname) window.history.pushState(null, '', path);
    setRoute(to);
  };

  return <Ctx.Provider value={{ route, navigate }}>{children}</Ctx.Provider>;
}

export function useRouter(): RouterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRouter hors RouterProvider');
  return ctx;
}
