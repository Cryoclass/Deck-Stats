import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type DeckDetail } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { configurationFromDetail, sourceFromDetail } from '../lib/deckConfiguration.js';
import { planComputeMode, planFingerprint, planSummaryFromPass } from '../lib/sidePlan.js';
import { plansToCompute, planKey, sheetOf, type SheetPlan, type ZoneGroups } from '../lib/sideSheet.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled, type ComputeClient } from '../worker/computeClient.js';
import { pct } from '../lib/fmt.js';
import { slugify } from '../lib/exportDeck.js';
import { zoneOfCatalog } from '../lib/zones.js';
import { downloadSideSheetPdf } from '../lib/sideSheetPdf.js';
import { imageSmall, type Card, type Library, type SidePlanCard } from '../types.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';

// ─── Fiche imprimable des plans de side (étape 10D, retouchée le 11 septembre 2026) ───
// Le DECK ENREGISTRÉ : un bloc par adversaire, volets premier / second ; dans chaque volet, deux
// cadres côte à côte — SORT (bordure pointillée, rouge) et ENTRE (bordure pleine, verte) — de
// grandes illustrations, le nombre de copies en GROS badge sur l'image, puis les trois chiffres et
// la note. Le sens ne repose jamais sur la couleur seule (libellé + style de bordure : lisible en
// noir et blanc et par un daltonien). Les noms sont masqués par défaut (case « Noms des cartes »,
// non imprimée, mémorisée sur le navigateur). Plans de side v2 (D8) : dans chaque cadre, les cartes
// du main d'abord, puis celles de l'Extra Deck sous un intertitre « Extra » (l'Extra ne compte pas
// dans les chiffres, S7). Cible : 3 adversaires par page A4, 4 si les plans sont petits. « — »
// plutôt qu'un chiffre périmé (R9) ; « Tout calculer » en série. « Télécharger le PDF » construit
// le fichier dans le navigateur (lib/sideSheetPdf.ts) : l'utilisateur imprime le PDF.

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
      // Partie C : les textes des cartes déterminent les annotations par défaut, donc les chiffres de plan
      // persistés ; sans eux, la fiche ne se charge pas (erreur affichée) plutôt que d'écrire des chiffres faux.
      for (const c of await api.cardsByIds([...ids])) cards[c.id] = c;
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
    const state = sourceFromDetail(loaded.detail, loaded.library, loaded.cards);
    return sheetOf(state, state.matchups, stored, zoneOfCatalog(loaded.cards));
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
      <div className="flex h-[100dvh] flex-col items-center justify-center gap-3 bg-ink-950 text-value text-fg-3">
        <p>{error}</p>
        <button onClick={() => navigate({ name: 'home' })} className="rounded border border-ink-700 px-3 py-1.5 text-body hover:bg-ink-800">
          ← Retour aux decks
        </button>
      </div>
    );
  }
  if (!loaded || !sheet) {
    return <div className="flex h-[100dvh] items-center justify-center bg-ink-950 text-value text-fg-3">Chargement de la fiche…</div>;
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
    <div className="min-h-[100dvh] bg-ink-950 text-fg-2 print:min-h-0 print:bg-white print:text-black" data-side-sheet>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2 print:hidden">
        <button onClick={() => navigate({ name: 'editor', id, tab: 'side' })} className="flex h-8 items-center whitespace-nowrap rounded px-2 text-body text-fg-3 hover:bg-ink-800 hover:text-fg-1">
          ← Plans de side
        </button>
        <span className="text-meta text-fg-3">Fiche du deck enregistré</span>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex h-8 cursor-pointer items-center gap-1.5 text-body text-fg-3" title="Les illustrations suffisent ; cochée, la case imprime aussi les noms.">
            <input type="checkbox" data-toggle-names checked={showNames} onChange={(e) => toggleNames(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
            Noms des cartes
          </label>
          {progress && (
            <span className="tnum text-body text-fg-3" data-sheet-progress>
              Calcul {progress.done} / {progress.total}…
            </span>
          )}
          <button
            data-compute-all
            onClick={() => void computeAll()}
            disabled={pending.length === 0 || progress !== null}
            className="h-8 rounded bg-ink-700 px-3 text-body font-medium text-fg-1 hover:bg-ink-600 disabled:cursor-default disabled:bg-ink-800 disabled:text-fg-3"
          >
            {pending.length === 0 ? 'Chiffres à jour' : `Tout calculer (${pending.length})`}
          </button>
          <button
            data-download-pdf
            onClick={() => void downloadPdf()}
            disabled={exporting}
            title={pending.length > 0 ? 'Les plans sans chiffre sortiront avec « — » : « Tout calculer » d’abord pour les remplir.' : 'Télécharger la fiche en PDF, à imprimer'}
            className="h-8 rounded bg-emerald-600 px-3 text-body font-medium text-black hover:bg-emerald-500 disabled:opacity-50"
          >
            {exporting ? 'Génération du PDF…' : 'Télécharger le PDF'}
          </button>
        </div>
      </div>
      {runError && (
        <p role="alert" className="mx-4 mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-meta text-neg print:hidden">
          {runError}
        </p>
      )}

      <main className="mx-auto max-w-4xl p-4 print:max-w-none print:p-0">
        <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-ink-800 pb-1.5 print:border-black/30">
          <h1 className="text-head font-semibold text-fg-1 print:text-black">{loaded.detail.name} — plans de side</h1>
          <span className="text-meta text-fg-3 print:text-black/60">
            {date} · ≥ 1 départ = P(S ≥ 1) · ≥ 2 non-engine = P(U ≥ 2) · main forte = S ≥ 2 et U ≥ 1 en premier, U ≥ 2 en second
          </span>
        </header>
        {sheet.length === 0 ? (
          <p className="text-value text-fg-3 print:text-black">Aucun adversaire : prépare les plans dans l’onglet « Plans de side ».</p>
        ) : (
          <div className="flex flex-col gap-3 print:gap-2">
            {sheet.map((m) => (
              <section
                key={m.id}
                data-sheet-matchup={m.name}
                className="break-inside-avoid rounded-md border border-ink-800 bg-ink-900 p-2.5 print:rounded-none print:border-black/30 print:bg-white print:p-2"
              >
                <h2 className="mb-1.5 text-head font-semibold text-fg-1 print:text-black">{m.name}</h2>
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
      <div className="mb-1 flex items-baseline gap-2 text-meta uppercase tracking-wide text-fg-3 print:text-black/70">
        <span className="font-bold text-fg-2 print:text-black">{p.position === 'first' ? 'Premier' : 'Second'}</span>
        {p.applied.status !== 'ready' && (
          <span className="normal-case text-warn print:text-black">{p.applied.status === 'incomplete' ? 'plan incomplet — à terminer' : 'plan à revoir'}</span>
        )}
      </div>
      {empty ? (
        <p className="text-meta text-fg-3 print:text-black/70">Aucun échange (deck de base)</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <SwapBox kind="out" groups={p.groups.outgoing} name={name} img={img} showNames={showNames} />
          <SwapBox kind="in" groups={p.groups.incoming} name={name} img={img} showNames={showNames} />
        </div>
      )}
      {p.applied.status === 'ready' && <Figures summary={p.summary} />}
      {p.plan.note && <p className="mt-1 text-body italic text-fg-3 print:text-black/80">{p.plan.note}</p>}
    </div>
  );
}

/** Un cadre du volet : SORT (pointillé, rouge) ou ENTRE (plein, vert), titré. Couleurs forcées à
 *  l'impression (`print-exact`) : Chrome n'imprime pas les fonds par défaut, et un badge noir
 *  à texte blanc sortirait invisible. */
function SwapBox({ kind, groups, name, img, showNames }: { kind: 'out' | 'in'; groups: ZoneGroups; name: (id: number) => string; img: (id: number) => string; showNames: boolean }) {
  const out = kind === 'out';
  const empty = groups.main.length + groups.extra.length + groups.unknown.length === 0;
  return (
    <div
      data-swap-box={kind}
      className={`print-exact min-w-0 flex-1 basis-[10rem] rounded-md border-2 p-1.5 ${
        out ? 'border-dashed border-red-400/80 bg-red-500/10 print:border-red-700' : 'border-solid border-emerald-400/80 bg-emerald-500/10 print:border-emerald-700'
      }`}
    >
      <div className={`mb-1.5 text-body font-bold uppercase tracking-wide ${out ? 'text-neg print:text-red-800' : 'text-pos print:text-emerald-800'}`}>
        {out ? '− Sort' : '+ Entre'}
      </div>
      {empty ? (
        <p className="text-meta text-fg-3 print:text-black/60">—</p>
      ) : (
        <>
          <CardRow list={groups.main} name={name} img={img} showNames={showNames} />
          {groups.extra.length > 0 && (
            <div data-sheet-zone="extra" className={groups.main.length > 0 ? 'mt-2' : ''}>
              <div data-sheet-zone-label className="mb-1 text-meta font-semibold uppercase tracking-wide text-fg-3 print:text-black/70">Extra</div>
              <CardRow list={groups.extra} name={name} img={img} showNames={showNames} />
            </div>
          )}
          {groups.unknown.length > 0 && (
            <div data-sheet-zone="unknown" className={groups.main.length + groups.extra.length > 0 ? 'mt-2' : ''}>
              <div data-sheet-zone-label className="mb-1 text-meta font-semibold uppercase tracking-wide text-warn print:text-black/70">Zone inconnue</div>
              <CardRow list={groups.unknown} name={name} img={img} showNames={showNames} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CardRow({ list, name, img, showNames }: { list: SidePlanCard[]; name: (id: number) => string; img: (id: number) => string; showNames: boolean }) {
  return (
    <div className="flex flex-wrap gap-2.5 print:gap-2">
      {list.map((c) => (
        <figure key={c.card_id} data-sheet-card={c.card_id} className="relative m-0 w-14 print:w-[14mm]">
          <img src={img(c.card_id)} alt={name(c.card_id)} title={name(c.card_id)} className="aspect-[59/86] w-full rounded object-cover" />
          {c.copies > 1 && (
            <span
              data-copies-badge
              title={`${c.copies} copies`}
              className="print-exact absolute -bottom-1.5 -right-1.5 flex h-8 min-w-8 items-center justify-center rounded-full bg-black px-1.5 text-head font-extrabold leading-none text-white ring-2 ring-white print:h-[7mm] print:min-w-[7mm] print:text-[12pt]"
            >
              ×{c.copies}
            </span>
          )}
          {showNames && <figcaption className="mt-1 truncate text-meta leading-tight text-fg-3 print:text-black">{name(c.card_id)}</figcaption>}
        </figure>
      ))}
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
    <div className="mt-1 flex flex-wrap gap-x-3 text-meta" data-sheet-figures={summary ? 'ready' : 'missing'}>
      {cells.map(([label, v]) => (
        <span key={label} className="flex items-baseline gap-1">
          <span className="text-fg-3 print:text-black/60">{label}</span>
          <span className="tnum font-semibold text-fg-1 print:text-black" title={v === undefined ? 'À calculer (« Tout calculer »)' : `${(100 * v).toFixed(4)} %`}>
            {v === undefined ? '—' : pct(v, 1)}
          </span>
        </span>
      ))}
    </div>
  );
}
