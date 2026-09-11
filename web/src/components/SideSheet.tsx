import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type DeckDetail } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { configurationFromDetail, libraryState, stateFromConfiguration } from '../lib/deckConfiguration.js';
import { planComputeMode, planFingerprint, planSummaryFromPass } from '../lib/sidePlan.js';
import { plansToCompute, planKey, sheetOf, type SheetPlan } from '../lib/sideSheet.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled, type ComputeClient } from '../worker/computeClient.js';
import { pct } from '../lib/fmt.js';
import { slugify } from '../lib/exportDeck.js';
import { downloadSideSheetPdf } from '../lib/sideSheetPdf.js';
import { imageSmall, type Card, type Library, type SidePlanCard } from '../types.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';

// ─── Fiche imprimable des plans de side (étape 10D, retouchée le 11 septembre 2026) ───
// Le DECK ENREGISTRÉ : un bloc par adversaire, volets premier / second ; dans chaque volet, deux
// cadres côte à côte — SORT (bordure pointillée, rouge) et ENTRE (bordure pleine, verte) — de
// grandes illustrations, le nombre de copies en GROS badge sur l'image, puis les trois chiffres et
// la note. Le sens ne repose jamais sur la couleur seule (libellé + style de bordure : lisible en
// noir et blanc et par un daltonien). Les noms sont masqués par défaut (case « Noms des cartes »,
// non imprimée, mémorisée sur le navigateur). Cible : 3 adversaires par page A4, 4 si les plans
// sont petits. « — » plutôt qu'un chiffre périmé (R9) ; « Tout calculer » en série. « Télécharger le
// PDF » construit le fichier dans le navigateur (lib/sideSheetPdf.ts) : l'utilisateur imprime le PDF.

type Loaded = { detail: DeckDetail; library: Library; cards: Record<number, Card> };

const NAMES_KEY = 'testhand.sideSheet.names';
function readNamesPreference(): boolean {
  try {
    return localStorage.getItem(NAMES_KEY) === '1';
  } catch {
    return false;
  }
}

export function SideSheet({ id }: { id: string }) {
  const { navigate } = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<Record<string, unknown>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showNames, setShowNames] = useState(readNamesPreference);
  const [exporting, setExporting] = useState(false);
  const clientRef = useRef<ComputeClient | null>(null);

  const toggleNames = (on: boolean) => {
    setShowNames(on);
    try {
      localStorage.setItem(NAMES_KEY, on ? '1' : '0');
    } catch {
      /* Préférence de confort : sans stockage, la case vaut pour la session. */
    }
  };

  useEffect(() => {
    let cancelled = false;
    const client = createEngineClient();
    clientRef.current = client;
    (async () => {
      const [detail, library] = await Promise.all([api.getDeck(id), api.getLibrary()]);
      const configuration = configurationFromDetail(detail);
      const ids = new Set<number>([
        ...configuration.cards.map((c) => c.card_id),
        ...configuration.matchups.flatMap((m) => m.plans.flatMap((p) => [...p.outgoing, ...p.incoming].map((c) => c.card_id))),
      ]);
      const cards: Record<number, Card> = {};
      try {
        for (const c of await api.cardsByIds([...ids])) cards[c.id] = c;
      } catch {
        /* Catalogue facultatif : l'image se dérive de l'id. */
      }
      if (cancelled) return;
      setLoaded({ detail, library, cards });
      setStored(Object.fromEntries((detail.plan_summaries ?? []).map((r) => [planKey(r.matchup_id, r.position), r.summary])));
    })().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Chargement impossible.');
    });
    return () => {
      cancelled = true;
      client.dispose();
      clientRef.current = null;
    };
  }, [id]);

  const sheet = useMemo(() => {
    if (!loaded) return null;
    const state = { ...stateFromConfiguration(configurationFromDetail(loaded.detail)), ...libraryState(loaded.library) };
    return sheetOf(state, state.matchups, stored);
  }, [loaded, stored]);
  const pending = sheet ? plansToCompute(sheet) : [];

  const computeAll = async () => {
    const client = clientRef.current;
    if (!client || !loaded || pending.length === 0) return;
    setRunError(null);
    setProgress({ done: 0, total: pending.length });
    // Deux plans au même deck sidé (même empreinte) ne se calculent qu'une fois.
    const byFingerprint = new Map<string, PlanSummary>();
    for (const [i, p] of pending.entries()) {
      try {
        const input = p.input!;
        const fingerprint = planFingerprint(input, p.position);
        let summary = byFingerprint.get(fingerprint) ?? null;
        if (!summary) {
          const { result } = await client.compute(input, planComputeMode(p.position)).promise;
          summary = planSummaryFromPass(result[p.position], input, p.position);
          if (!summary) throw new Error(result[p.position].unavailableReason ?? 'Analyse indisponible.');
          byFingerprint.set(fingerprint, summary);
        }
        const computed = summary;
        setStored((prev) => ({ ...prev, [planKey(p.matchupId, p.position)]: computed }));
        await api.putPlanSummary(id, p.matchupId, p.position, computed, loaded.detail.revision);
      } catch (e) {
        if (e instanceof ComputeCancelled) return;
        setRunError(`${e instanceof Error ? e.message : 'Calcul impossible.'} Recharge la fiche.`);
        setProgress(null);
        return;
      }
      setProgress({ done: i + 1, total: pending.length });
    }
    setProgress(null);
  };

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-ink-950 text-sm text-ink-400">
        <p>{error}</p>
        <button onClick={() => navigate({ name: 'home' })} className="rounded border border-ink-700 px-3 py-1.5 text-xs hover:bg-ink-800">
          ← Retour aux decks
        </button>
      </div>
    );
  }
  if (!loaded || !sheet) {
    return <div className="flex h-screen items-center justify-center bg-ink-950 text-sm text-ink-500">Chargement de la fiche…</div>;
  }

  const name = (cardId: number) => loaded.cards[cardId]?.name ?? `#${cardId}`;
  const img = (cardId: number) => loaded.cards[cardId]?.image_url_small ?? imageSmall(cardId);
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  // Le PDF lit les images : même origine (relais /api/cards/:id/image, le CDN n'a pas de CORS) ou data:.
  const readableImage = (cardId: number) => {
    const url = loaded.cards[cardId]?.image_url_small;
    return url?.startsWith('data:') ? url : `/api/cards/${cardId}/image`;
  };
  const downloadPdf = async () => {
    setExporting(true);
    setRunError(null);
    try {
      await downloadSideSheetPdf(
        { deckName: loaded.detail.name, date, sheet, showNames, name, imageUrl: readableImage },
        `plans-de-side_${slugify(loaded.detail.name)}_${new Date().toISOString().slice(0, 10)}.pdf`,
      );
    } catch (e) {
      setRunError(`PDF impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}.`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink-950 text-ink-200 print:min-h-0 print:bg-white print:text-black" data-side-sheet>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2 print:hidden">
        <button onClick={() => navigate({ name: 'editor', id, tab: 'side' })} className="whitespace-nowrap text-xs text-ink-400 hover:text-ink-100">
          ← Plans de side
        </button>
        <span className="text-[11px] text-ink-500">Fiche du deck enregistré</span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex h-8 cursor-pointer items-center gap-1.5 text-xs text-ink-300" title="Les illustrations suffisent ; cochée, la case imprime aussi les noms.">
            <input type="checkbox" data-toggle-names checked={showNames} onChange={(e) => toggleNames(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
            Noms des cartes
          </label>
          {progress && (
            <span className="tnum text-xs text-ink-300" data-sheet-progress>
              Calcul {progress.done} / {progress.total}…
            </span>
          )}
          <button
            data-compute-all
            onClick={() => void computeAll()}
            disabled={pending.length === 0 || progress !== null}
            className="h-8 rounded bg-ink-700 px-3 text-xs font-medium text-ink-100 hover:bg-ink-600 disabled:cursor-default disabled:bg-ink-800 disabled:text-ink-500"
          >
            {pending.length === 0 ? 'Chiffres à jour' : `Tout calculer (${pending.length})`}
          </button>
          <button
            data-download-pdf
            onClick={() => void downloadPdf()}
            disabled={exporting}
            title={pending.length > 0 ? 'Les plans sans chiffre sortiront avec « — » : « Tout calculer » d’abord pour les remplir.' : 'Télécharger la fiche en PDF, à imprimer'}
            className="h-8 rounded bg-emerald-600 px-3 text-xs font-medium text-black hover:bg-emerald-500 disabled:opacity-50"
          >
            {exporting ? 'Génération du PDF…' : 'Télécharger le PDF'}
          </button>
        </div>
      </div>
      {runError && (
        <p role="alert" className="mx-4 mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200 print:hidden">
          {runError}
        </p>
      )}

      <main className="mx-auto max-w-4xl p-4 print:max-w-none print:p-0">
        <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-ink-800 pb-1.5 print:border-black/30">
          <h1 className="text-base font-semibold text-ink-100 print:text-black">{loaded.detail.name} — plans de side</h1>
          <span className="text-[10px] text-ink-500 print:text-black/60">
            {date} · ≥ 1 départ = P(S ≥ 1) · ≥ 2 non-engine = P(U ≥ 2) · main forte = S ≥ 2 et U ≥ 1 en premier, U ≥ 2 en second
          </span>
        </header>
        {sheet.length === 0 ? (
          <p className="text-sm text-ink-400 print:text-black">Aucun adversaire : prépare les plans dans l’onglet « Plans de side ».</p>
        ) : (
          <div className="flex flex-col gap-3 print:gap-2">
            {sheet.map((m) => (
              <section
                key={m.id}
                data-sheet-matchup={m.name}
                className="break-inside-avoid rounded-md border border-ink-800 bg-ink-900 p-2.5 print:rounded-none print:border-black/30 print:bg-white print:p-2"
              >
                <h2 className="mb-1.5 text-base font-semibold text-ink-100 print:text-black">{m.name}</h2>
                <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 print:grid-cols-2">
                  {m.plans.map((p) => (
                    <SheetColumn key={p.position} p={p} name={name} img={img} showNames={showNames} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function SheetColumn({ p, name, img, showNames }: { p: SheetPlan; name: (id: number) => string; img: (id: number) => string; showNames: boolean }) {
  const empty = p.plan.outgoing.length === 0 && p.plan.incoming.length === 0;
  return (
    <div className="min-w-0" data-sheet-plan={p.position} data-status={p.applied.status}>
      <div className="mb-1 flex items-baseline gap-2 text-[11px] uppercase tracking-wide text-ink-400 print:text-black/70">
        <span className="font-bold text-ink-200 print:text-black">{p.position === 'first' ? 'Premier' : 'Second'}</span>
        {p.applied.status !== 'ready' && (
          <span className="normal-case text-amber-300 print:text-black">{p.applied.status === 'incomplete' ? 'plan incomplet — à terminer' : 'plan à revoir'}</span>
        )}
      </div>
      {empty ? (
        <p className="text-[11px] text-ink-500 print:text-black/70">Aucun échange (deck de base)</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <SwapBox kind="out" list={p.plan.outgoing} name={name} img={img} showNames={showNames} />
          <SwapBox kind="in" list={p.plan.incoming} name={name} img={img} showNames={showNames} />
        </div>
      )}
      {p.applied.status === 'ready' && <Figures summary={p.summary} />}
      {p.plan.note && <p className="mt-1 text-xs italic text-ink-300 print:text-black/80">{p.plan.note}</p>}
    </div>
  );
}

/** Un cadre du volet : SORT (pointillé, rouge) ou ENTRE (plein, vert), titré. Couleurs forcées à
 *  l'impression (`print-exact`) : Chrome n'imprime pas les fonds par défaut, et un badge noir
 *  à texte blanc sortirait invisible. */
function SwapBox({ kind, list, name, img, showNames }: { kind: 'out' | 'in'; list: SidePlanCard[]; name: (id: number) => string; img: (id: number) => string; showNames: boolean }) {
  const out = kind === 'out';
  return (
    <div
      data-swap-box={kind}
      className={`print-exact min-w-0 flex-1 basis-[10rem] rounded-md border-2 p-1.5 ${
        out ? 'border-dashed border-red-400/80 bg-red-500/10 print:border-red-700' : 'border-solid border-emerald-400/80 bg-emerald-500/10 print:border-emerald-700'
      }`}
    >
      <div className={`mb-1.5 text-xs font-bold uppercase tracking-wide ${out ? 'text-red-300 print:text-red-800' : 'text-emerald-300 print:text-emerald-800'}`}>
        {out ? '− Sort' : '+ Entre'}
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-ink-500 print:text-black/60">—</p>
      ) : (
        <div className="flex flex-wrap gap-2.5 print:gap-2">
          {list.map((c) => (
            <figure key={c.card_id} data-sheet-card={c.card_id} className="relative m-0 w-14 print:w-[14mm]">
              <img src={img(c.card_id)} alt={name(c.card_id)} title={name(c.card_id)} className="aspect-[59/86] w-full rounded object-cover" />
              {c.copies > 1 && (
                <span
                  data-copies-badge
                  title={`${c.copies} copies`}
                  className="print-exact absolute -bottom-1.5 -right-1.5 flex h-8 min-w-8 items-center justify-center rounded-full bg-black px-1.5 text-base font-extrabold leading-none text-white ring-2 ring-white print:h-[7mm] print:min-w-[7mm] print:text-[12pt]"
                >
                  ×{c.copies}
                </span>
              )}
              {showNames && <figcaption className="mt-1 truncate text-[10px] leading-tight text-ink-300 print:text-black">{name(c.card_id)}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function Figures({ summary }: { summary: PlanSummary | null }) {
  const cells: Array<[string, number | undefined]> = [
    ['≥ 1 départ', summary?.startOne],
    ['≥ 2 non-engine', summary?.nonEngineTwo],
    ['main forte', summary?.strongHand],
  ];
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]" data-sheet-figures={summary ? 'ready' : 'missing'}>
      {cells.map(([label, v]) => (
        <span key={label} className="flex items-baseline gap-1">
          <span className="text-ink-500 print:text-black/60">{label}</span>
          <span className="tnum font-semibold text-ink-100 print:text-black" title={v === undefined ? 'À calculer (« Tout calculer »)' : `${(100 * v).toFixed(4)} %`}>
            {v === undefined ? '—' : pct(v, 1)}
          </span>
        </span>
      ))}
    </div>
  );
}
