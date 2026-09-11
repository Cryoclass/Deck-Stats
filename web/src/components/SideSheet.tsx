import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type DeckDetail } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { configurationFromDetail, libraryState, stateFromConfiguration } from '../lib/deckConfiguration.js';
import { planComputeMode, planFingerprint, planSummaryFromPass } from '../lib/sidePlan.js';
import { plansToCompute, planKey, sheetOf, type SheetPlan } from '../lib/sideSheet.js';
import { createEngineClient } from '../worker/client.js';
import { ComputeCancelled, type ComputeClient } from '../worker/computeClient.js';
import { pct } from '../lib/fmt.js';
import { imageSmall, type Card, type Library, type SidePlanCard } from '../types.js';
import type { PlanSummary } from '../../../server/src/domain/deckSummary.js';

// ─── Fiche imprimable des plans de side (étape 10D, D4) ───
// Le DECK ENREGISTRÉ : un bloc par adversaire, volets premier / second, cartes qui sortent et qui
// entrent (vignettes), les trois chiffres et la note. « — » plutôt qu'un chiffre périmé (R9) ;
// « Tout calculer » enchaîne en série les plans prêts sans chiffre, avec progression, et persiste
// chacun pour la révision lue (409 : le deck a changé, on s'arrête). L'écran reste sombre ; seule
// l'impression bascule en clair (index.css, classes `print:`), cible 6 à 7 adversaires par A4 (D15).

type Loaded = { detail: DeckDetail; library: Library; cards: Record<number, Card> };

export function SideSheet({ id }: { id: string }) {
  const { navigate } = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<Record<string, unknown>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const clientRef = useRef<ComputeClient | null>(null);

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

  return (
    <div className="min-h-screen bg-ink-950 text-ink-200 print:min-h-0 print:bg-white print:text-black" data-side-sheet>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2 print:hidden">
        <button onClick={() => navigate({ name: 'editor', id, tab: 'side' })} className="whitespace-nowrap text-xs text-ink-400 hover:text-ink-100">
          ← Plans de side
        </button>
        <span className="text-[11px] text-ink-500">Fiche du deck enregistré</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
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
          <button data-print onClick={() => window.print()} className="h-8 rounded bg-emerald-600 px-3 text-xs font-medium text-black hover:bg-emerald-500">
            Imprimer
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
          <div className="flex flex-col gap-2 print:gap-1">
            {sheet.map((m) => (
              <section
                key={m.id}
                data-sheet-matchup={m.name}
                className="break-inside-avoid rounded-md border border-ink-800 bg-ink-900 p-2 print:rounded-none print:border-black/25 print:bg-white print:px-1.5 print:py-1"
              >
                <h2 className="mb-0.5 text-sm font-semibold text-ink-100 print:text-black">{m.name}</h2>
                <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 print:grid-cols-2">
                  {m.plans.map((p) => (
                    <SheetColumn key={p.position} p={p} name={name} img={img} />
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

function SheetColumn({ p, name, img }: { p: SheetPlan; name: (id: number) => string; img: (id: number) => string }) {
  const empty = p.plan.outgoing.length === 0 && p.plan.incoming.length === 0;
  return (
    <div className="min-w-0" data-sheet-plan={p.position} data-status={p.applied.status}>
      <div className="mb-0.5 flex items-baseline gap-2 text-[10px] uppercase tracking-wide text-ink-500 print:text-black/60">
        <span className="font-semibold text-ink-300 print:text-black">{p.position === 'first' ? 'Premier' : 'Second'}</span>
        {p.applied.status !== 'ready' && (
          <span className="normal-case text-amber-300 print:text-black">{p.applied.status === 'incomplete' ? 'plan incomplet — à terminer' : 'plan à revoir'}</span>
        )}
      </div>
      {empty ? (
        <p className="text-[11px] text-ink-500 print:text-black/70">Aucun échange (deck de base)</p>
      ) : (
        <>
          <CardLine sign="−" list={p.plan.outgoing} name={name} img={img} />
          <CardLine sign="+" list={p.plan.incoming} name={name} img={img} />
        </>
      )}
      {p.applied.status === 'ready' && <Figures summary={p.summary} />}
      {p.plan.note && <p className="mt-0.5 text-[11px] italic text-ink-300 print:text-black/80">{p.plan.note}</p>}
    </div>
  );
}

function CardLine({ sign, list, name, img }: { sign: '−' | '+'; list: SidePlanCard[]; name: (id: number) => string; img: (id: number) => string }) {
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span className={`w-3 shrink-0 font-semibold ${sign === '−' ? 'text-red-300' : 'text-emerald-300'} print:text-black`}>{sign}</span>
      {list.map((c) => (
        <span key={c.card_id} className="flex min-w-0 items-center gap-1">
          <img src={img(c.card_id)} alt="" className="aspect-[59/86] h-7 shrink-0 rounded-sm object-cover print:h-6" />
          <span className="max-w-[9rem] truncate">{name(c.card_id)}</span>
          <span className="tnum text-ink-400 print:text-black/60">×{c.copies}</span>
        </span>
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
    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px]" data-sheet-figures={summary ? 'ready' : 'missing'}>
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
