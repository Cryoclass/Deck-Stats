import { useEffect, useState } from 'react';
import { cardDefaults } from '../../../server/src/domain/cardDefaults.js';
import { AVAILABILITY_PROFILES } from '../../../server/src/domain/deckConfiguration.js';
import { AVAILABILITY_LABEL, type Availability, type Card, type CardReference, type NonEngineGroup } from '../types.js';

/** Corps d'une écriture de référence (`PUT /api/references/:cardId`). */
export type ReferenceBody = Omit<CardReference, 'card_id'>;

type HoptChoice = 'detection' | 'yes' | 'no';
type NonEngineChoice = 'detection' | 'none' | Availability;

/** Valeur détectée d'une carte, en clair (texte absent = rien de détecté). */
export function detectionSummary(card: Card | undefined): { hopt: boolean; availability: Availability | null; group: string | null } {
  if (!card) return { hopt: false, availability: null, group: null };
  const d = cardDefaults({ name: card.name, type: card.type ?? null, race: card.race ?? null, description: card.description ?? null });
  return { hopt: d.isHopt, availability: d.availability, group: d.group };
}

/**
 * Formulaire de la référence commune d'une carte (annotations par défaut, D10 et D4′) : HOPT
 * (détection / oui / non), non-engine (détection / pas non-engine / profil, plafond par NOM de
 * groupe fourni de base), note. Rendu pour un référent seulement ; le serveur garde (404 sinon).
 * Sans état global : l'éditeur et la page /references fournissent les données et les actions.
 */
export function ReferenceDialog({
  cardId,
  card,
  reference,
  groups,
  onSave,
  onClear,
  onClose,
}: {
  cardId: number;
  card: Card | undefined;
  reference: CardReference | undefined;
  groups: NonEngineGroup[];
  onSave: (body: ReferenceBody) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const detected = detectionSummary(card);
  const [hopt, setHopt] = useState<HoptChoice>(reference?.is_hopt === true ? 'yes' : reference?.is_hopt === false ? 'no' : 'detection');
  const [nonengine, setNonengine] = useState<NonEngineChoice>(
    !reference?.nonengine_set ? 'detection' : reference.availability ?? 'none',
  );
  const [groupName, setGroupName] = useState<string>(reference?.group_name ?? '');
  const [note, setNote] = useState(reference?.note ?? '');
  // Un plafond de référence se désigne par le nom d'un groupe FOURNI DE BASE (commun à tous les comptes).
  const builtinNames = [...new Set(groups.filter((g) => g.is_builtin).map((g) => g.name))];
  // Une référence existante peut désigner un nom qui n'est pas (ou plus) fourni de base : il reste visible.
  const groupOptions = reference?.group_name && !builtinNames.includes(reference.group_name) ? [...builtinNames, reference.group_name] : builtinNames;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const profileChosen = nonengine !== 'detection' && nonengine !== 'none';
  const empty = hopt === 'detection' && nonengine === 'detection';

  const save = () => {
    if (empty) return;
    onSave({
      is_hopt: hopt === 'detection' ? null : hopt === 'yes',
      nonengine_set: nonengine !== 'detection',
      availability: profileChosen ? (nonengine as Availability) : null,
      group_name: profileChosen && groupName ? groupName : null,
      note: note.trim() ? note.trim() : null,
    });
    onClose();
  };

  const segment = (active: boolean) =>
    `h-8 px-2.5 text-body ${active ? 'bg-ink-600 text-fg-1' : 'text-fg-3 hover:bg-ink-800 hover:text-fg-2'}`;
  const detectedProfile = detected.availability ? `${AVAILABILITY_LABEL[detected.availability]}${detected.group ? ` · ${detected.group}` : ''}` : 'aucun profil';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Référence de ${card?.name ?? cardId}`}
        data-reference-dialog
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-head font-semibold text-fg-1">Référence commune</h3>
            <div className="truncate text-body text-fg-3">{card?.name ?? `#${cardId}`}</div>
          </div>
          <button onClick={onClose} title="Fermer" className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-ink-800 hover:text-fg-1">
            ✕
          </button>
        </div>
        <p className="text-meta text-fg-3">
          Valeur par défaut pour tous les comptes, qui l'emporte sur la détection ; le choix d'un compte l'emporte sur elle.
          Chaque écriture est journalisée et invalide les aperçus des decks qui contiennent la carte.
        </p>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-meta uppercase tracking-wide text-fg-3">HOPT</legend>
          <div className="inline-flex w-fit overflow-hidden rounded-md border border-ink-700 bg-ink-850">
            <button data-ref-hopt="detection" aria-pressed={hopt === 'detection'} onClick={() => setHopt('detection')} className={segment(hopt === 'detection')}>
              Détection ({detected.hopt ? 'oui' : 'non'})
            </button>
            <button data-ref-hopt="yes" aria-pressed={hopt === 'yes'} onClick={() => setHopt('yes')} className={segment(hopt === 'yes')}>Oui</button>
            <button data-ref-hopt="no" aria-pressed={hopt === 'no'} onClick={() => setHopt('no')} className={segment(hopt === 'no')}>Non</button>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-meta uppercase tracking-wide text-fg-3">Non-engine</legend>
          <select
            aria-label="Profil de référence"
            value={nonengine}
            onChange={(e) => setNonengine(e.target.value as NonEngineChoice)}
            className="h-8 rounded border border-ink-700 bg-ink-850 px-2 text-body text-fg-1"
          >
            <option value="detection">Détection ({detectedProfile})</option>
            <option value="none">Pas non-engine</option>
            {AVAILABILITY_PROFILES.map((p) => (
              <option key={p} value={p}>{AVAILABILITY_LABEL[p]}</option>
            ))}
          </select>
          {profileChosen && (
            <select
              aria-label="Plafond de référence"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="h-8 rounded border border-ink-700 bg-ink-850 px-2 text-body text-fg-1"
            >
              <option value="">Sans plafond partagé</option>
              {groupOptions.map((n) => (
                <option key={n} value={n}>Plafond « {n} »</option>
              ))}
            </select>
          )}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-meta uppercase tracking-wide text-fg-3">Note</span>
          <textarea
            aria-label="Note de référence"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-body text-fg-1 placeholder:text-fg-3"
            placeholder="Pourquoi cette valeur (facultatif)"
          />
        </label>

        {empty && <p className="text-meta text-warn">Les deux aspects suivent la détection : rien à enregistrer{reference ? ', retirez plutôt la référence' : ''}.</p>}

        <div className="flex flex-wrap items-center gap-2">
          {reference && (
            <button data-ref-clear onClick={() => { onClear(); onClose(); }} className="h-8 rounded px-2.5 text-body text-neg hover:bg-red-500/10">
              Retirer la référence
            </button>
          )}
          <button onClick={onClose} className="ml-auto h-8 rounded border border-ink-700 px-3 text-body text-fg-2 hover:bg-ink-800">
            Annuler
          </button>
          <button
            data-ref-save
            disabled={empty}
            onClick={save}
            className="h-8 rounded bg-emerald-600 px-3 text-body font-medium text-black hover:bg-emerald-500 disabled:cursor-default disabled:bg-ink-800 disabled:text-fg-3"
          >
            Enregistrer la référence
          </button>
        </div>
      </div>
    </div>
  );
}
