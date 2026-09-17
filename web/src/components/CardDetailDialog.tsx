import { useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { useAuth } from '../lib/auth.js';
import { AVAILABILITY_LABEL, ORIGIN_LABEL, ORIGIN_SHORT, imageCropped, type AnnotationOrigin, type Card } from '../types.js';
import { ReferenceDialog, detectionSummary } from './ReferenceDialog.js';

export function CardDetailDialog({ cardId, onClose }: { cardId: number; onClose: () => void }) {
  const card = useDeck((s) => s.cards[cardId]) as Card | undefined;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-4">
          <img
            src={imageCropped(cardId)}
            alt={card?.name ?? String(cardId)}
            className="h-40 w-40 shrink-0 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-value font-semibold text-fg-1">{card?.name ?? `#${cardId}`}</h3>
              <button
                onClick={onClose}
                title="Fermer"
                className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg-3 hover:bg-ink-800 hover:text-fg-1"
              >
                ✕
              </button>
            </div>
            <div className="mt-0.5 text-meta text-fg-3">
              {[card?.type, card?.race, card?.attribute].filter(Boolean).join(' · ')}
              {card?.atk != null && (
                <span className="tnum"> · ATK {card.atk} / DEF {card?.def ?? '?'}</span>
              )}
            </div>
            <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-body leading-relaxed text-fg-2">
              {card?.description ?? '—'}
            </p>
            <div className="tnum mt-2 text-meta text-fg-4">passcode {cardId}</div>
          </div>
        </div>
        <AnnotationOrigins cardId={cardId} card={card} />
      </div>
    </div>
  );
}

/** Pastille d'origine (D9) : « vous », « réf. », « auto ». */
export function OriginChip({ origin }: { origin: AnnotationOrigin | null }) {
  if (!origin) return null;
  const tone = origin === 'choice' ? 'bg-ink-800 text-fg-2' : origin === 'reference' ? 'bg-sky-500/15 text-info' : 'bg-amber-500/15 text-warn';
  return (
    <span data-origin={origin} title={ORIGIN_LABEL[origin]} className={`rounded px-1.5 py-0.5 text-meta ${tone}`}>
      {ORIGIN_SHORT[origin]}
    </span>
  );
}

/**
 * Annotations par défaut dans le détail de carte (partie D) : valeur effective et origine de chaque
 * aspect, « revenir au défaut » sur un choix du compte, formulaire de référence pour un référent.
 */
function AnnotationOrigins({ cardId, card }: { cardId: number; card: Card | undefined }) {
  const { state } = useAuth();
  const referent = state.status === 'authenticated' && state.user.referent === true;
  const isHopt = useDeck((s) => s.hopt.has(cardId));
  const profile = useDeck((s) => s.profiles.get(cardId));
  const groups = useDeck((s) => s.groups);
  const origin = useDeck((s) => s.origin.get(cardId));
  const reference = useDeck((s) => s.references.get(cardId));
  const resetAnnotation = useDeck((s) => s.resetAnnotation);
  const saveReference = useDeck((s) => s.saveReference);
  const clearReference = useDeck((s) => s.clearReference);
  const [editing, setEditing] = useState(false);
  const groupName = groups.find((g) => g.id === profile?.groupId)?.name;
  const detected = detectionSummary(card);

  const row = (label: string, value: string, aspectOrigin: AnnotationOrigin | null, aspect: 'hopt' | 'nonengine') => (
    <div data-annotation-row={aspect} className="flex flex-wrap items-center gap-2 text-body">
      <span className="w-20 shrink-0 text-fg-3">{label}</span>
      <span className="text-fg-1">{value}</span>
      <OriginChip origin={aspectOrigin} />
      {aspectOrigin === 'choice' && (
        <button
          data-reset={aspect}
          onClick={() => resetAnnotation(cardId, aspect)}
          title="Oublier votre choix : la carte reprend la référence commune, sinon la détection"
          className="ml-auto h-8 rounded px-2 text-meta text-fg-3 hover:bg-ink-800 hover:text-fg-1"
        >
          Revenir au défaut
        </button>
      )}
    </div>
  );

  return (
    <section data-annotations className="flex flex-col gap-1.5 border-t border-ink-800 pt-3">
      <div className="text-meta uppercase tracking-wide text-fg-3">Annotations (compte)</div>
      {row('HOPT', isHopt ? 'oui' : 'non', origin?.hopt ?? null, 'hopt')}
      {row('Non-engine', profile ? `${AVAILABILITY_LABEL[profile.availability]}${groupName ? ` · plafond « ${groupName} »` : ''}` : 'non comptée', origin?.nonengine ?? null, 'nonengine')}
      <div className="text-meta text-fg-3">
        Détection : HOPT {detected.hopt ? 'oui' : 'non'} ·{' '}
        {detected.availability ? `${AVAILABILITY_LABEL[detected.availability]}${detected.group ? ` · ${detected.group}` : ''}` : 'aucun profil'}
        {reference?.note ? <> · note de référence : « {reference.note} »</> : null}
      </div>
      {referent && (
        <button
          data-open-reference
          onClick={() => setEditing(true)}
          className="mt-1 h-8 w-fit rounded border border-ink-700 px-3 text-body text-fg-2 hover:bg-ink-800"
        >
          {reference ? 'Modifier la référence…' : 'Définir la référence…'}
        </button>
      )}
      {editing && (
        <ReferenceDialog
          cardId={cardId}
          card={card}
          reference={reference}
          groups={groups}
          onSave={(body) => saveReference(cardId, body)}
          onClear={() => clearReference(cardId)}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}
