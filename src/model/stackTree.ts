import type { PlacedItem, ProjectSettings } from './types';
import { settle, supportersById } from './layout';

export interface StackNode {
  item: PlacedItem;
  /** Index in the (stack-ordered) items array. */
  index: number;
  /** Settled bottom elevation in mm. */
  z: number;
  depth: number;
  /** Labels of the other supporters when the item rests on several. */
  alsoOn: string[];
  children: StackNode[];
}

/**
 * Tree of the stacks: floor items are roots, each item is listed under the
 * first (array order) item it rests on; other supporters go to `alsoOn`.
 * Children and roots are in array (stack) order.
 */
export function buildStackTree(items: PlacedItem[], settings: ProjectSettings): StackNode[] {
  const settled = settle(items, settings);
  const sup = supportersById(settled, settings);
  const byId = new Map<string, StackNode>();
  settled.forEach((item, index) =>
    byId.set(item.id, { item, index, z: item.z ?? 0, depth: 0, alsoOn: [], children: [] }),
  );
  const roots: StackNode[] = [];
  for (const item of settled) {
    const node = byId.get(item.id)!;
    const parents = (sup.get(item.id) ?? []).map((id) => byId.get(id)!).filter(Boolean);
    if (!parents.length) {
      roots.push(node);
      continue;
    }
    parents.sort((a, b) => a.index - b.index);
    node.alsoOn = parents.slice(1).map((p) => p.item.label);
    parents[0].children.push(node);
  }
  const setDepth = (n: StackNode, d: number) => {
    n.depth = d;
    n.children.forEach((c) => setDepth(c, d + 1));
  };
  roots.forEach((r) => setDepth(r, 0));
  return roots;
}

/** Depth-first flat list of the tree, as rendered. */
export function flattenStackTree(roots: StackNode[]): StackNode[] {
  const out: StackNode[] = [];
  const walk = (n: StackNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** `toIndex` for `reorderItem` so that the item at `from` ends up directly before the item at `before`. */
export function dropBeforeIndex(from: number, before: number): number {
  return from < before ? before - 1 : before;
}
