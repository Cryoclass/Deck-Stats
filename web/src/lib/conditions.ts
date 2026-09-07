import type { ConditionNode } from '../types.js';
import type { Condition } from '../engine/types.js';

// ─── Conditions ET/OU (contrat §4) — opérations pures sur l'arbre persisté ───
// L'arbre stocké porte des identifiants de cartes ; le moteur reçoit des index de types
// (`toEngineCondition`). Un chemin = indices des enfants depuis la racine. Toute
// suppression normalise : un groupe vidé disparaît, un OU réduit à un enfant devient cet
// enfant, une racine vidée vaut `null` (source inconditionnelle). L'éditeur ne peut donc
// jamais produire le groupe vide que le contrat demande de signaler.

export type Path = number[];
export type Leaf = Extract<ConditionNode, { kind: 'remaining' }>;

export const leaf = (cardId: number, atLeast = 1): Leaf => ({ kind: 'remaining', card_id: cardId, at_least: atLeast });

export function childrenOf(node: ConditionNode): ConditionNode[] | null {
  if (node.kind === 'and') return node.all;
  if (node.kind === 'or') return node.any;
  return null;
}

function withChildren(node: ConditionNode, children: ConditionNode[]): ConditionNode {
  if (node.kind === 'and') return { kind: 'and', all: children };
  if (node.kind === 'or') return { kind: 'or', any: children };
  return node;
}

export function nodeAt(root: ConditionNode, path: Path): ConditionNode | undefined {
  let node: ConditionNode | undefined = root;
  for (const i of path) {
    if (!node) return undefined;
    node = childrenOf(node)?.[i];
  }
  return node;
}

/** Feuilles de l'arbre avec leur chemin, dans l'ordre de lecture. */
export function leavesOf(root: ConditionNode | null, path: Path = []): Array<{ leaf: Leaf; path: Path }> {
  if (!root) return [];
  if (root.kind === 'remaining') return [{ leaf: root, path }];
  return childrenOf(root)!.flatMap((child, i) => leavesOf(child, [...path, i]));
}

export function requiredCardIds(root: ConditionNode | null): number[] {
  return [...new Set(leavesOf(root).map((l) => l.leaf.card_id))];
}

/** Normalisation après édition : groupes vides retirés, OU singleton aplati. La racine
 *  reste un ET (même à un enfant) pour que « ＋ et… » garde un sens. */
function normalize(node: ConditionNode, isRoot: boolean): ConditionNode | null {
  if (node.kind === 'remaining') return isRoot ? { kind: 'and', all: [node] } : node;
  const children = childrenOf(node)!
    .map((child) => normalize(child, false))
    .filter((child): child is ConditionNode => child !== null);
  if (children.length === 0) return null;
  if (node.kind === 'or' && children.length === 1) return isRoot ? { kind: 'and', all: children } : children[0];
  if (isRoot && node.kind === 'or') return { kind: 'and', all: [withChildren(node, children)] };
  return withChildren(node, children);
}

/** Remplace (ou retire, avec `null`) le nœud au chemin donné, puis normalise. */
export function replaceAt(root: ConditionNode, path: Path, replacer: (node: ConditionNode) => ConditionNode | null): ConditionNode | null {
  const rec = (node: ConditionNode, depth: number): ConditionNode | null => {
    if (depth === path.length) return replacer(node);
    const children = childrenOf(node);
    if (!children) return node;
    const next = children.map((child, i) => (i === path[depth] ? rec(child, depth + 1) : child));
    return withChildren(node, next.filter((child): child is ConditionNode => child !== null));
  };
  const out = rec(root, 0);
  return out ? normalize(out, true) : null;
}

/** Ajoute une clause ET au niveau racine (source sans condition : la crée). */
export function addClause(root: ConditionNode | null, node: ConditionNode): ConditionNode {
  if (!root) return { kind: 'and', all: [node] };
  if (root.kind === 'and') return { kind: 'and', all: [...root.all, node] };
  return { kind: 'and', all: [root, node] };
}

/** Ajoute un enfant au groupe désigné par `path` (ET ou OU). */
export function addToGroup(root: ConditionNode, path: Path, node: ConditionNode): ConditionNode {
  return replaceAt(root, path, (group) => (childrenOf(group) ? withChildren(group, [...childrenOf(group)!, node]) : { kind: 'or', any: [group, node] }))!;
}

/** Le nœud au chemin devient une alternative : « (nœud OU nouveau) ». */
export function wrapOr(root: ConditionNode, path: Path, node: ConditionNode): ConditionNode {
  return replaceAt(root, path, (target) => (target.kind === 'or' ? { kind: 'or', any: [...target.any, node] } : { kind: 'or', any: [target, node] }))!;
}

export function removeAt(root: ConditionNode, path: Path): ConditionNode | null {
  return replaceAt(root, path, () => null);
}

/** Retire toutes les feuilles portant cette carte (clic sur une carte déjà requise). */
export function removeLeavesOfCard(root: ConditionNode, cardId: number): ConditionNode | null {
  const prune = (node: ConditionNode): ConditionNode | null => {
    if (node.kind === 'remaining') return node.card_id === cardId ? null : node;
    return withChildren(node, childrenOf(node)!.map(prune).filter((c): c is ConditionNode => c !== null));
  };
  const out = prune(root);
  return out ? normalize(out, true) : null;
}

export function setAtLeast(root: ConditionNode, path: Path, atLeast: number): ConditionNode {
  const n = Math.max(1, Math.floor(atLeast));
  return replaceAt(root, path, (node) => (node.kind === 'remaining' ? { ...node, at_least: n } : node))!;
}

/** Traduction vers le moteur : carte absente du modèle → `type: null` (jamais satisfaite). */
export function toEngineCondition(node: ConditionNode, typeIndexOf: (cardId: number) => number | undefined): Condition {
  switch (node.kind) {
    case 'remaining':
      return { kind: 'remaining', type: typeIndexOf(node.card_id) ?? null, atLeast: node.at_least };
    case 'and':
      return { kind: 'and', all: node.all.map((c) => toEngineCondition(c, typeIndexOf)) };
    case 'or':
      return { kind: 'or', any: node.any.map((c) => toEngineCondition(c, typeIndexOf)) };
  }
}

/** Lecture textuelle : « B ≥1 ET (C ≥1 OU D ≥1) ». */
export function describeCondition(node: ConditionNode, name: (cardId: number) => string, top = true): string {
  if (node.kind === 'remaining') return `${name(node.card_id)}${node.at_least > 1 ? ` ≥${node.at_least}` : ''}`;
  const op = node.kind === 'and' ? ' ET ' : ' OU ';
  const inner = childrenOf(node)!.map((c) => describeCondition(c, name, false)).join(op);
  return top || childrenOf(node)!.length === 1 ? inner : `(${inner})`;
}
