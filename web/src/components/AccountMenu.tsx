import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Popover } from './ui.js';

/** Pastille de compte (headers accueil + éditeur) : nom affiché + déconnexion.
 *  Rien en mode hors-ligne (pas de session à montrer). */
export function AccountMenu() {
  const { state, logout } = useAuth();
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  return (
    <Popover
      align="right"
      trigger={(open, toggle) => (
        <button
          onClick={toggle}
          title={user.email}
          className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
            open ? 'bg-ink-800 text-ink-100' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold uppercase text-ink-200">
            {user.display_name.slice(0, 1) || '?'}
          </span>
          <span className="max-w-[120px] truncate">{user.display_name}</span>
        </button>
      )}
    >
      {() => {
        const discordLinked = user.providers?.includes('discord') ?? false;
        return (
          <div className="flex flex-col">
            <div className="border-b border-ink-700 px-2 py-1.5">
              <div className="truncate text-xs text-ink-200">{user.display_name}</div>
              <div className="truncate text-[10px] text-ink-500">{user.email}</div>
            </div>

            {/* Liaison Discord (Lot D) : explicite, depuis une session active — jamais
                de rattachement automatique par email. */}
            {!discordLinked && (
              <button
                onClick={() => window.location.assign('/api/auth/discord/start?link=1')}
                className="mt-1 rounded px-2 py-1.5 text-left text-xs text-ink-200 hover:bg-ink-800"
              >
                Lier mon compte Discord
              </button>
            )}
            {discordLinked && (
              <div className="mt-1 flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="text-xs text-ink-400">Discord lié ✓</span>
                {user.has_password && (
                  <button
                    onClick={() => {
                      void api.unlinkDiscord().then(() => window.location.reload());
                    }}
                    className="rounded px-1.5 py-0.5 text-[10px] text-ink-500 hover:bg-ink-800 hover:text-ink-300"
                    title="Retirer la connexion via Discord (le mot de passe reste)"
                  >
                    délier
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => void logout()}
              className="mt-1 rounded px-2 py-1.5 text-left text-xs text-red-300 hover:bg-ink-800"
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
