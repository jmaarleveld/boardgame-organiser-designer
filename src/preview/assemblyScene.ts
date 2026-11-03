/**
 * Pure (three.js‑free) helpers for the Assembly view: item placement matrices,
 * colour classification and an LRU cache for per‑geometry meshes.
 * Frames: see DESIGN.md §2. World = game box frame (x right, y "down" in the
 * top view, z up); an item's mesh lives in its local frame [0,w]×[0,d]×[0,h].
 */
import type { PlacedItem, ProjectSettings } from '../model/types';
import type { LayoutSummary } from '../model/layout';
import { EPS, effectiveTop, errorItemIds, floatingItemIds, safeItemRect } from '../model/layout';

/** Unrotated outer size of an item (its mesh's local extent). Never throws. */
export function localSize(
  item: PlacedItem,
  settings: ProjectSettings,
  items?: readonly PlacedItem[],
): { width: number; depth: number; height: number; broken: boolean } {
  const r = safeItemRect(item, settings, items);
  const rotated = item.rotation === 90 && !r.broken;
  return {
    width: rotated ? r.depth : r.width,
    depth: rotated ? r.width : r.depth,
    height: r.height,
    broken: !!r.broken,
  };
}

/**
 * Column‑major 4×4 matrix (three.js `Matrix4.fromArray` order) mapping the
 * item's local frame into the game box frame.
 *
 * rotation 0:  p' = p + (x, y, z)
 * rotation 90: p' = Rz(+90°)·p + (x + d, y, z)
 *   Rz(+90°) maps (u, v) → (−v, u), so the local footprint [0,w]×[0,d]
 *   becomes [−d,0]×[0,w]; shifting by +d in x lands it on
 *   [x, x+d]×[y, y+w], which is exactly itemRect (width/depth swapped).
 *
 * `localDepth` is the unrotated depth `d` of the item; `z` (default 0) is the
 * item's bottom elevation.
 */
export function placementMatrix(item: Pick<PlacedItem, 'x' | 'y' | 'rotation' | 'z'>, localDepth: number): number[] {
  const z = typeof item.z === 'number' && Number.isFinite(item.z) && item.z > 0 ? item.z : 0;
  if (item.rotation === 90) {
    // col0 = Rz·ex = (0,1,0), col1 = Rz·ey = (−1,0,0), col2 = ez, col3 = translation
    return [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, item.x + localDepth, item.y, z, 1];
  }
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, item.x, item.y, z, 1];
}

/** Apply a column‑major 4×4 matrix to a point. */
export function applyMatrix(m: number[], p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/* ---------------------------------------------------------------- colours */

/**
 * 'tall' = sticks out of the box; 'problem' = other error (overlap,
 * intersection, outside usable area, broken, stack fit error); 'floating' =
 * stacked item not fully supported by the items below, or that may tip.
 * 'tall' counts keep‑out space (standing cards sticking out of the box).
 */
export type ItemTint = 'normal' | 'problem' | 'tall' | 'floating';

export function classifyItems(
  items: PlacedItem[],
  settings: ProjectSettings,
  summary: LayoutSummary,
): Map<string, ItemTint> {
  const errors = errorItemIds(summary);
  const floating = floatingItemIds(summary);
  const out = new Map<string, ItemTint>();
  for (const item of items) {
    const top = effectiveTop(item, settings, items);
    if (top > settings.box.height + EPS) out.set(item.id, 'tall');
    else if (errors.has(item.id)) out.set(item.id, 'problem');
    else if (floating.has(item.id)) out.set(item.id, 'floating');
    else out.set(item.id, 'normal');
  }
  return out;
}

/* ---------------------------------------------------------------- cache */

/**
 * Small LRU cache (Map insertion order = recency). `set` evicts the least
 * recently used entries beyond `capacity`, but never the keys in `protect`
 * (keys the current scene needs) — so a project with more unique geometries
 * than the cap can temporarily exceed it instead of thrashing.
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Read without touching recency. */
  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  /** Read and mark as most recently used. */
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  /** Mark keys as most recently used (in the given order). */
  touch(keys: Iterable<string>): void {
    for (const k of keys) this.get(k);
  }

  set(key: string, value: V, protect?: ReadonlySet<string>): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size <= this.capacity) return;
    for (const k of [...this.map.keys()]) {
      if (this.map.size <= this.capacity) break;
      if (k === key || protect?.has(k)) continue;
      this.map.delete(k);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** Keys of `keys` that are neither cached nor known to fail, deduplicated, in order. */
export function missingKeys(keys: Iterable<string | null>, cache: { has(k: string): boolean }, failed?: { has(k: string): boolean }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (k === null || seen.has(k)) continue;
    seen.add(k);
    if (!cache.has(k) && !failed?.has(k)) out.push(k);
  }
  return out;
}
