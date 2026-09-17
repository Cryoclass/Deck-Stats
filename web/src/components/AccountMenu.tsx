import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useRouter } from '../lib/router.js';
import { useDeck } from '../store/deckStore.js';
import { Popover } from './ui.js';

/** État de persistance de l'éditeur, montré ici plutôt que dans l'en-tête (audit 01 §4 :
 *  l'indicateur « en ligne » et l'horodatage y avaient le même poids que « Enregistrer »). */
export interface PersistenceStatus {
  online: boolean;
  savedLabel: string | null;
}

/** Pastille de compte (headers accueil + éditeur) : nom affiché + déconnexion.
 *  Rien en mode hors-ligne (pas de session à montrer). */
export function AccountMenu({ status }: { status?: PersistenceStatus }) {
  const { state, logout } = useAuth();
  const { navigate } = useRouter();
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  return (
    <Popover
      align="right"
      trigger={(open, toggle) => (
        <button
          onClick={toggle}
          title={user.email}
          className={`flex h-8 items-center gap-1.5 rounded px-2 text-body ${
            open ? 'bg-ink-800 text-fg-1' : 'text-fg-3 hover:bg-ink-800 hover:text-fg-1'
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-700 text-meta font-semibold uppercase text-fg-2">
            {user.display_name.slice(0, 1) || '?'}
          </span>
          <span className="hidden max-w-[120px] truncate sm:inline">{user.display_name}</span>
        </button>
      )}
    >
      {() => {
        const discordLinked = user.providers?.includes('discord') ?? false;
        return (
          <div className="flex flex-col">
            <div className="border-b border-ink-700 px-2 py-1.5">
              <div className="truncate text-body text-fg-2">{user.display_name}</div>
              <div className="truncate text-meta text-fg-3">{user.email}</div>
            </div>

            {status && (
              <div className="flex items-center justify-between gap-3 border-b border-ink-700 px-2 py-1.5 text-meta text-fg-3">
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${status.online ? 'bg-emerald-500' : 'bg-ink-600'}`} />
                  {status.online ? 'en ligne' : 'hors-ligne'}
                </span>
                <span className="tnum">
                  {status.savedLabel ? `enregistré ${status.savedLabel}` : 'jamais enregistré'}
                </span>
              </div>
            )}

            {/* Liaison Discord (Lot D) : explicite, depuis une session active — jamais
                de rattachement automatique par email. */}
            {!discordLinked && (
              <button
                onClick={() => window.location.assign('/api/auth/discord/start?link=1')}
                className="mt-1 rounded px-2 py-1.5 text-left text-body text-fg-2 hover:bg-ink-800"
              >
                Lier mon compte Discord
              </button>
            )}
            {discordLinked && (
              <div className="mt-1 flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="text-body text-fg-3">Discord lié ✓</span>
                {user.has_password && (
                  <button
                    onClick={() => {
                      void api.unlinkDiscord().then(() => window.location.reload());
                    }}
                    className="rounded px-1.5 py-0.5 text-meta text-fg-3 hover:bg-ink-800 hover:text-fg-3"
                    title="Retirer la connexion via Discord (le mot de passe reste)"
                  >
                    délier
                  </button>
                )}
              </div>
            )}

            {/* Partie D : références communes, pour un référent (ou un admin, qui l'est aussi). */}
            {user.referent && (
              <button
                data-nav-references
                onClick={() => {
                  // Même garde que « ← Decks » de l'éditeur : un deck non enregistré se confirme avant de partir.
                  if (useDeck.getState().dirty && !window.confirm('Modifications non enregistrées : quitter quand même ?')) return;
                  navigate({ name: 'references' });
                }}
                className="mt-1 rounded px-2 py-1.5 text-left text-body text-fg-2 hover:bg-ink-800"
              >
                Références communes
              </button>
            )}

            <button
              onClick={() => void logout()}
              className="mt-1 rounded px-2 py-1.5 text-left text-body text-neg hover:bg-ink-800"
              title="Déconnexion (purge aussi les brouillons locaux)"
            >
              Se déconnecter
            </button>
          </div>
        );
      }}
    </Popover>
  );
}
