import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Segmented } from './ui.js';

const field =
  'w-full rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-ink-100 outline-none placeholder:text-ink-600 focus:border-ink-500';
const label = 'text-[11px] uppercase tracking-wide text-ink-500';

// Codes d'erreur renvoyés par le callback OAuth (?discord_error=…, Lot D).
const DISCORD_ERRORS: Record<string, string> = {
  cancelled: 'Connexion Discord annulée.',
  state_mismatch: 'Vérification de sécurité échouée — réessaie.',
  exchange_failed: 'Échec de la connexion avec Discord — réessaie.',
  invite_required:
    "Un code d'invitation est requis pour créer un compte via Discord : passe par l'onglet Inscription.",
  invite_invalid: "Code d'invitation invalide.",
  no_email: "Ton compte Discord n'a pas d'email vérifié.",
  email_taken:
    'Un compte existe déjà avec l’email de ce Discord. Connecte-toi par mot de passe puis « Lier Discord » depuis le menu de compte.',
  discord_taken: 'Ce compte Discord est déjà lié à un autre compte.',
  session_required: 'Session expirée : reconnecte-toi puis réessaie.',
  not_configured: 'OAuth Discord non configuré côté serveur.',
};

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04c-1.71.3-3.35.81-4.89 1.52a.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06c0 .02.01.04.03.05a19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12c.13-.1.25-.19.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.06 0a.07.07 0 0 1 .08 0c.12.11.25.21.37.3a.08.08 0 0 1 0 .13c-.6.34-1.22.64-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.02-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.68-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

/** Connexion / inscription (itération 8, Lot C). Rendue À LA PLACE de la route
 *  demandée tant qu'il n'y a pas de session : l'URL n'est pas touchée, donc un lien
 *  profond (/decks/:id) reprend exactement là où on voulait aller après connexion. */
export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discordAvailable, setDiscordAvailable] = useState(false);

  // Bouton Discord affiché seulement si le serveur est configuré (Lot D).
  useEffect(() => {
    api
      .authProviders()
      .then((p) => setDiscordAvailable(p.discord))
      .catch(() => setDiscordAvailable(false));
  }, []);

  // Erreur remontée par le callback OAuth via l'URL — affichée puis nettoyée.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('discord_error');
    if (!code) return;
    setError(DISCORD_ERRORS[code] ?? `Erreur Discord : ${code}`);
    params.delete('discord_error');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  const startDiscord = () => {
    // En inscription, le code d'invitation part AVEC nous chez Discord (validé côté
    // serveur avant la redirection) : la porte d'entrée reste fermée sans code.
    if (mode === 'register' && !inviteCode.trim()) {
      setError("Renseigne le code d'invitation avant de passer par Discord.");
      return;
    }
    const invite = mode === 'register' ? `?invite=${encodeURIComponent(inviteCode.trim())}` : '';
    window.location.assign(`/api/auth/discord/start${invite}`);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({
          email,
          password,
          display_name: displayName.trim() || undefined,
          invite_code: inviteCode,
        });
      }
      // Succès : l'état auth bascule, l'app se rend — rien d'autre à faire ici.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erreur inattendue');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-ink-950 text-ink-200">
      <div className="w-full max-w-sm px-6">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold tracking-tight text-ink-100">YGO</div>
          <div className="text-xs text-ink-500">probabilités &amp; mains</div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900 p-5">
          <div className="mb-4 flex justify-center">
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: 'login', label: 'Connexion' },
                { value: 'register', label: 'Inscription' },
              ]}
            />
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className={label} htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className={label} htmlFor="auth-password">
                Mot de passe
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </div>

            {mode === 'register' && (
              <>
                <div className="flex flex-col gap-1">
                  <label className={label} htmlFor="auth-name">
                    Nom affiché <span className="normal-case text-ink-600">(optionnel)</span>
                  </label>
                  <input
                    id="auth-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className={field}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={label} htmlFor="auth-invite">
                    Code d'invitation
                  </label>
                  <input
                    id="auth-invite"
                    required
                    autoComplete="off"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    className={field}
                  />
                </div>
              </>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-black transition-colors hover:bg-emerald-500 disabled:cursor-default disabled:opacity-60"
            >
              {busy ? '…' : mode === 'login' ? 'Se connecter' : 'Créer le compte'}
            </button>
          </form>

          {discordAvailable && (
            <>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-ink-800" />
                <span className="text-[10px] uppercase tracking-wide text-ink-600">ou</span>
                <div className="h-px flex-1 bg-ink-800" />
              </div>
              <button
                onClick={startDiscord}
                className="flex w-full items-center justify-center gap-2 rounded bg-[#5865F2] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#4954d8]"
              >
                <DiscordMark />
                {mode === 'login' ? 'Se connecter avec Discord' : 'Créer un compte avec Discord'}
              </button>
            </>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] text-ink-600">
          {mode === 'register'
            ? "L'inscription nécessite un code d'invitation."
            : 'Les decks et annotations sont propres à chaque compte.'}
        </p>
      </div>
    </div>
  );
}
