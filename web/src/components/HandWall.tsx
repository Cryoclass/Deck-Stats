import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeck } from '../store/deckStore.js';
import { drawHandsFromStore, noteHandsFromStore } from '../store/selectors.js';
import { queryMatches, handContext, criterionInvalid } from '../engine/query.js';
import { imageSmall } from '../types.js';
import { columnOf, studiedSource } from '../store/study.js';
import { CONTEXT_LABEL } from './Header.js';

export function HandWall() {
  const result = useDeck((s) => s.result);
  // Plans de side v2 (S1, S2) : le mur tire et note dans le deck ÉTUDIÉ de la position courante.
  const studied = useDeck((s) => s.studied);
  const preview = useDeck((s) => s.preview);
  const baseStale = useDeck((s) => s.stale);
  const baseComputing = useDeck((s) => s.computing);
  const computeError = useDeck((s) => s.computeError);
  const resultContext = useDeck((s) => s.resultContext);
  const importance = useDeck((s) => s.importance);
  const setImportance = useDeck((s) => s.setImportance);
  const cards = useDeck((s) => s.cards);
  // Contexte d'analyse UNIQUE (étape 5B) : le même réglage que la barre, la matrice et
  // les deltas — le mur ne porte plus de scénario local (contrat §3).
  const context = useDeck((s) => s.context);
  const column = useMemo(
    () => columnOf({ studied, result, stale: baseStale, computing: baseComputing, computeError, resultContext, context, preview }, context, false), // le mur montre le plan, jamais l'aperçu (S3 : l'aperçu est dans le panneau)
    [studied, result, baseStale, baseComputing, computeError, resultContext, context, preview],
  );
  const stale = column.stale;
  const computing = column.computing;
  const mainLen = useDeck((s) => studiedSource(s, s.context)?.main.length ?? 0);
  // Filtre unifié avec le mode requête (§D) : mêmes critères que le panneau de requête.
  const queryCriteria = useDeck((s) => s.queryCriteria);
  const handFilterByQuery = useDeck((s) => s.handFilterByQuery);
  const setHandFilterByQuery = useDeck((s) => s.setHandFilterByQuery);
  // Signature de composition du deck étudié : change à tout ajout / retrait / modif de copies, ou de plan.
  const mainSig = useDeck((s) => (studiedSource(s, s.context)?.main ?? []).map((c) => `${c.cardId}:${c.copies}`).join(','));

  const [count, setCount] = useState(60);
  const [rawHands, setRawHands] = useState<number[][]>([]);
  const [sortByNote, setSortByNote] = useState(true);

  const handSize = context === 'first' ? 5 : 6;

  // On re-tire seulement quand il le faut : bouton, n, contexte, ou changement de
  // composition du deck (une main peut contenir une carte retirée). Un changement
  // d'importance ne re-tire PAS — il renote les mêmes mains (ci-dessous).
  const resample = useCallback(() => {
    setRawHands(drawHandsFromStore(handSize, count));
  }, [handSize, count]);

  useEffect(() => resample(), [resample, mainSig]);

  // Renotation des mains AFFICHÉES : dépend de la distribution (result/model) et de
  // l'importance → les mains déjà tirées sont renotées, pas seulement les suivantes.
  const noted = useMemo(
    () => noteHandsFromStore(rawHands, handSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawHands, handSize, column.pass, mainSig, importance],
  );

  // Le filtre du mur de mains EST la requête (§D) : une main est retenue ssi elle
  // satisfait la requête, évaluée avec le même contexte que les buckets (mêmes
  // signatures non-engine). Requête invalide (min > max) → pas de filtre.
  const neSignatures = column.pass?.neSignatures;
  const filterActive =
    handFilterByQuery && !!neSignatures && !queryCriteria.some(criterionInvalid);

  const view = useMemo(() => {
    let v = noted;
    if (filterActive && neSignatures) {
      v = v.filter((h) => queryMatches(queryCriteria, handContext(h, neSignatures)));
    }
    if (sortByNote) v = [...v].sort((a, b) => b.note - a.note || b.starts - a.starts);
    return v;
  }, [noted, filterActive, neSignatures, queryCriteria, sortByNote]);

  if (column.reason) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-value text-warn" data-study-reason>
        {column.reason}
      </div>
    );
  }
  if (!column.pass || mainLen === 0) {
    return (
      <div className={`flex h-full items-center justify-center p-4 text-center text-value ${column.error ? 'text-neg' : 'text-fg-3'}`}>
        {column.error
          ? `Calcul en échec : ${column.error}`
          : !column.pass && computing && mainLen > 0
            ? (column.kind === 'sided' ? 'Calcul du deck sidé…' : 'Calcul initial des statistiques…')
            : 'Charge un deck pour générer des mains de test.'}
      </div>
    );
  }

  const pass = column.pass;

  return (
    <div className="flex h-full flex-col">
      {/* Barre de contrôle. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-800 px-3 py-2 text-body">
        {/* S1 : le deck et la position dont ces mains sont tirées ; le réglage est dans la barre (D3). */}
        <span className="truncate text-fg-2" data-study-label="wall" title={CONTEXT_LABEL[context]}>
          {CONTEXT_LABEL[context]} · {column.label}
        </span>
        {/* Étape 9 (réponse 2 de 7B) : action primaire du mur, cible de 32 px comme Enregistrer. */}
        <button
          onClick={resample}
          className="whitespace-nowrap rounded bg-ink-700 px-3 py-2 font-medium text-fg-1 hover:bg-ink-600"
        >
          ↻ Nouvelles mains
        </button>
        <label className="flex items-center gap-1 text-fg-3">
          n
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-fg-1"
          >
            {[30, 60, 120, 240].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1 text-fg-3">
          <span>importance non-engine</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
            className="h-6 w-24 accent-emerald-500"
          />
          <span className="tnum w-8 text-right text-fg-2">{importance.toFixed(2)}</span>
        </div>

        <div className="ml-auto flex items-center gap-2 text-fg-3">
          {/* Le filtre du mur = la requête (§D). Édition dans le panneau « Mode requête ». */}
          <button
            onClick={() => setHandFilterByQuery(!handFilterByQuery)}
            title="Filtrer par la requête en cours (éditée dans le panneau de droite)"
            className={`rounded px-2 py-1 ${
              handFilterByQuery ? 'bg-emerald-500/20 text-pos' : 'bg-ink-800 text-fg-3'
            }`}
          >
            {handFilterByQuery ? 'filtré par requête' : 'filtrer par requête'}
          </button>
          <button
            onClick={() => setSortByNote((v) => !v)}
            className={`rounded px-2 py-1 ${sortByNote ? 'bg-ink-700 text-fg-1' : 'bg-ink-800 text-fg-3'}`}
            title="Trier par note (sinon flux aléatoire)"
          >
            {sortByNote ? 'tri: note' : 'flux libre'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-meta text-fg-3">
          <span>
            {view.length} mains affichées{' '}
            {noted.length !== view.length ? `(sur ${noted.length} tirées)` : ''}
          </span>
          {context === 'second' && (
            <span className="flex items-center gap-1" title="En second, la dernière carte de chaque main est la sixième pioche : identifiée, elle n'a pas les mêmes fenêtres qu'une carte initiale.">
              <span className="inline-block h-3 w-2 rounded-sm ring-2 ring-sky-400" /> sixième carte = pioche
            </span>
          )}
          {/* Étape 4 : les notes viennent du dernier résultat ; s'il est périmé, on le dit et on atténue. */}
          {stale && (
            <span role="status" className="rounded bg-ink-800 px-1.5 py-0.5 text-fg-3">
              Recalcul… notes de la version précédente
            </span>
          )}
        </div>
        <div className={`flex flex-col gap-1.5 transition-opacity ${stale ? 'opacity-45' : ''}`}>
          {view.map((h, i) => (
            <div
              key={i}
              className="flex items-center gap-1 rounded-md border border-ink-800 bg-ink-900 p-1 sm:flex-wrap sm:gap-2 sm:p-1.5"
            >
              {/* Étape 7B (charte §6.3) : les cartes gardent leur ratio (shrink-0, jamais déformées).
                  Étape 9 (réponse 1 de 7B) : sous 640 px, ligne compacte — cartes de 60 px, récapitulatif
                  « S 3 · U 1 » empilé et note à DROITE des cartes sur la même ligne (huit mains par écran
                  au lieu de cinq) ; dès 640 px, cartes de 68 px et récapitulatif complet. */}
              <div className="flex shrink-0 items-end gap-0.5 sm:gap-1">
                {h.cards.map((id, ci) => {
                  const sixth = context === 'second' && ci === h.cards.length - 1;
                  return (
                    <span key={ci} className={`relative flex flex-col items-center ${sixth ? 'ml-1 sm:ml-1.5' : ''}`}>
                      <img
                        src={cards[id]?.image_url_small ?? imageSmall(id)}
                        alt={cards[id]?.name ?? String(id)}
                        title={`${cards[id]?.name ?? String(id)}${sixth ? ' — sixième carte (pioche)' : ''}`}
                        loading="lazy"
                        className={`h-[60px] rounded sm:h-[68px] ${sixth ? 'ring-2 ring-sky-400' : ''}`}
                      />
                      {sixth && (
                        <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-sky-400 px-1 text-meta font-bold leading-4 text-black">
                          6ᵉ
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5 pr-0.5 sm:gap-3 sm:pr-1">
                <CompactRecap starts={h.starts} neTotal={h.neTotal} />
                <Recap label="départs" value={h.starts} tone={h.starts === 0 ? 'bad' : 'good'} title="Départs théoriques S" />
                <Recap label="non-eng" value={h.neTotal} tone="neutral" title="Potentiel non-engine U (fenêtres et plafonds appliqués)" />
                <NoteBadge note={h.note} />
              </div>
            </div>
          ))}
          {view.length === 0 && (
            <div className="p-6 text-center text-value text-fg-3">
              {pass.total === 0 ? `Mains indisponibles. ${pass.unavailableReason}` : 'Aucune main ne correspond à ces filtres.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Recap({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: number;
  tone: 'good' | 'bad' | 'neutral';
  title?: string;
}) {
  const color =
    tone === 'bad' ? 'text-neg' : tone === 'good' ? 'text-pos' : 'text-fg-2';
  return (
    <div className="hidden text-center sm:block" title={title}>
      <div className={`tnum text-value font-semibold ${color}`}>{value}</div>
      <div className="text-meta uppercase tracking-wide text-fg-3">{label}</div>
    </div>
  );
}

/** Récapitulatif compact sous 640 px (étape 9) : « S 3 » sur « U 1 », mêmes couleurs et
 *  infobulles que le récapitulatif complet ; empilé, car six cartes à 360 px ne laissent
 *  que ~80 px à droite. */
function CompactRecap({ starts, neTotal }: { starts: number; neTotal: number }) {
  return (
    <div className="flex flex-col items-start gap-0.5 text-meta leading-none sm:hidden" data-recap="compact">
      <span className={`tnum whitespace-nowrap ${starts === 0 ? 'text-neg' : 'text-pos'}`} title="Départs théoriques S">
        <span className="text-fg-3">S </span>{starts}
      </span>
      <span className="tnum whitespace-nowrap text-fg-2" title="Potentiel non-engine U (fenêtres et plafonds appliqués)">
        <span className="text-fg-3">U </span>{neTotal}
      </span>
    </div>
  );
}

function NoteBadge({ note }: { note: number }) {
  const hue = (note / 10) * 140; // rouge → vert
  return (
    <div
      className="tnum flex h-7 w-7 items-center justify-center rounded-full text-body font-bold text-black sm:h-9 sm:w-9 sm:text-value"
      style={{ background: `oklch(0.78 0.15 ${hue})` }}
      title="Note = rang de cette main parmi les mains de ce deck, en centiles"
    >
      {note}
    </div>
  );
}
