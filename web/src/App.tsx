import { useEffect } from 'react';
import { useDeck } from './store/deckStore.js';
import { RouterProvider, useRouter } from './lib/router.js';
import { AuthProvider, useAuth } from './lib/auth.js';
import { HomePage } from './components/HomePage.js';
import { EditorPage } from './components/EditorPage.js';
import { LoginPage } from './components/LoginPage.js';
import { ComparePage } from './components/ComparePage.js';

function Routed() {
  const { route } = useRouter();
  const bootstrap = useDeck((s) => s.bootstrap);

  // Bibliothèque du compte chargée une fois (transverse aux decks) : sert l'éditeur ET
  // l'export JSON depuis l'accueil. Routed ne monte qu'après authentification (Gate),
  // donc jamais de chargement à vide.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (route.name === 'editor') return <EditorPage id={route.id} />;
  if (route.name === 'compare') return <ComparePage a={route.a} b={route.b} />;
  return <HomePage />;
}

/** Garde d'authentification (itération 8, Lot C). La page de connexion est rendue À LA
 *  PLACE de la route demandée : l'URL reste intacte, un lien profond aboutit après
 *  connexion. En mode hors-ligne (backend injoignable), l'app reste utilisable sans
 *  persistance (cf. README). */
function Gate() {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 text-sm text-ink-500">
        Chargement…
      </div>
    );
  }
  if (state.status === 'anonymous') return <LoginPage />;
  return <Routed />;
}

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider>
        <Gate />
      </RouterProvider>
    </AuthProvider>
  );
}
