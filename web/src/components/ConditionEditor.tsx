import { useDeck } from '../store/deckStore.js';
import type { ConditionNode } from '../types.js';
import {
  addClause,
  addToGroup,
  childrenOf,
  leaf,
  removeAt,
  setAtLeast,
  wrapOr,
  type Path,
} from '../lib/conditions.js';

/**
 * Éditeur d'une condition ET/OU (contrat §4, étape 5B) pour une source de start.
 * L'arbre est rendu tel qu'il est stocké : groupe ET (racine) de clauses, chaque clause
 * étant une feuille ou un groupe OU. Gestes : retirer une feuille, régler « ≥ n »,
 * ajouter une alternative (« ou… ») à une feuille, ajouter un membre à un groupe,
 * ajouter une clause ET. Aucun geste ne produit un groupe vide : la normalisation
 * retire les groupes vidés, et une racine vidée rend la source inconditionnelle.
 */
export function ConditionEditor({
  source,
  condition,
}: {
  source: { cardId: number } | { pairId: string };
  condition: ConditionNode | null;
}) {
  const main = useDeck((s) => s.main);
  const cards = useDeck((s) => s.cards);
  const setCondition = useDeck((s) => s.setCondition);
  const name = (id: number) => cards[id]?.name ?? `#${id}`;

  const update = (next: ConditionNode | null) => setCondition(source, next);

  return (
    <div className="flex flex-col gap-1 text-[11px]">
      {condition === null ? (
        <span className="text-ink-600">source inconditionnelle</span>
      ) : (
        <Node node={condition} path={[]} name={name} main={main} root={condition} update={update} />
      )}
      <CardPicker
        label="＋ et…"
        title="Ajouter une clause ET : il devra aussi rester ≥1 copie de cette carte en deck"
        main={main}
        name={name}
        onPick={(id) => update(addClause(condition, leaf(id)))}
      />
    </div>
  );
}

function Node({
  node,
  path,
  name,
  main,
  root,
  update,
}: {
  node: ConditionNode;
  path: Path;
  name: (id: number) => string;
  main: Array<{ cardId: number }>;
  root: ConditionNode;
  update: (next: ConditionNode | null) => void;
}) {
  if (node.kind === 'remaining') {
    return (
      <span className="flex flex-wrap items-center gap-1 rounded border border-dashed border-amber-500/50 bg-amber-500/5 px-1.5 py-0.5 text-amber-200">
        <span>▤ {name(node.card_id)}</span>
        <label className="flex items-center gap-0.5 text-amber-300/80" title="Copies devant rester en deck après le tirage observé">
          ≥
          <input
            type="number"
            min={1}
            value={node.at_least}
            onChange={(e) => update(setAtLeast(root, path, Number(e.target.value)))}
            className="tnum w-9 rounded border border-ink-700 bg-ink-850 px-1 text-center text-[11px] text-ink-100"
          />
        </label>
        <CardPicker
          label="ou…"
          title="Alternative : cette carte OU une autre"
          main={main}
          name={name}
          onPick={(id) => update(wrapOr(root, path, leaf(id)))}
        />
        <button
          onClick={() => update(removeAt(root, path))}
          className="text-amber-400/70 hover:text-red-400"
          title="Retirer cette condition"
        >
          ✕
        </button>
      </span>
    );
  }
  const children = childrenOf(node)!;
  const op = node.kind === 'and' ? 'ET' : 'OU';
  const isRoot = path.length === 0;
  return (
    <span
      className={`flex flex-wrap items-center gap-1 ${
        isRoot ? '' : 'rounded border border-ink-700 bg-ink-900/60 px-1 py-0.5'
      }`}
    >
      {children.map((child, i) => (
        <span key={i} className="flex flex-wrap items-center gap-1">
          {i > 0 && <span className="text-[10px] font-semibold uppercase text-ink-400">{op}</span>}
          <Node node={child} path={[...path, i]} name={name} main={main} root={root} update={update} />
        </span>
      ))}
      {!isRoot && (
        <CardPicker
          label={`＋ ${op.toLowerCase()}…`}
          title={`Ajouter un membre à ce groupe ${op}`}
          main={main}
          name={name}
          onPick={(id) => update(addToGroup(root, path, leaf(id)))}
        />
      )}
    </span>
  );
}

function CardPicker({
  label,
  title,
  main,
  name,
  onPick,
}: {
  label: string;
  title: string;
  main: Array<{ cardId: number }>;
  name: (id: number) => string;
  onPick: (cardId: number) => void;
}) {
  return (
    <select
      value=""
      title={title}
      onChange={(e) => {
        const id = Number(e.target.value);
        if (id) onPick(id);
      }}
      className="rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-[11px] text-ink-300"
    >
      <option value="">{label}</option>
      {main.map((m) => (
        <option key={m.cardId} value={m.cardId}>
          {name(m.cardId)}
        </option>
      ))}
    </select>
  );
}
