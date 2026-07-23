import { useEffect } from 'react';
import { useDeck } from './store/deckStore.js';
import { RouterProvider, useRouter } from './lib/router.js';
import { HomePage } from './components/HomePage.js';
import { EditorPage } from './components/EditorPage.js';

function Routed() {
  const { route } = useRouter();
  const bootstrap = useDeck((s) => s.bootstrap);

  // Bibliothèque globale chargée une fois (transverse aux decks) : sert l'éditeur ET
  // l'export JSON depuis l'accueil.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return route.name === 'editor' ? <EditorPage id={route.id} /> : <HomePage />;
}

export default function App() {
  return (
    <RouterProvider>
      <Routed />
    </RouterProvider>
  );
}
