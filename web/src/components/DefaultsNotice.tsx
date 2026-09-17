import { useState } from 'react';
import { useAuth } from '../lib/auth.js';

export const DEFAULTS_NOTICE = 'annotation-defaults';

/**
 * Bandeau d'information unique après le déploiement des annotations par défaut (D9, texte validé en
 * Q8). Dû aux comptes créés avant la migration, tant qu'ils ne l'ont pas fermé ; la fermeture est
 * retenue par le serveur, pour le compte (réponse de l'utilisateur du 17 septembre 2026).
 */
export function DefaultsNotice() {
  const { state, dismissNotice } = useAuth();
  const [error, setError] = useState<string | null>(null);
  if (state.status !== 'authenticated' || !(state.user.notices ?? []).includes(DEFAULTS_NOTICE)) return null;

  return (
    <div
      role="status"
      data-notice={DEFAULTS_NOTICE}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky-500/20 bg-sky-500/5 px-4 py-1.5 text-body text-info"
    >
      <span className="min-w-[12rem] flex-1">
        Les annotations par défaut sont actives : vos chiffres ont pu changer ; vos choix sont conservés.
      </span>
      {error && <span className="text-meta text-neg">{error}</span>}
      <button
        data-notice-dismiss
        onClick={() => {
          setError(null);
          dismissNotice(DEFAULTS_NOTICE).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Fermeture impossible.'));
        }}
        className="h-8 shrink-0 rounded border border-sky-500/30 px-2.5 text-meta hover:bg-sky-500/10"
      >
        Compris
      </button>
    </div>
  );
}
