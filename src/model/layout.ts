/**
 * Pure layout helpers: footprints, gravity stacking, snapping and validation
 * (game box frame, mm). See DESIGN.md §2.
 */
import type { PlacedItem, ProjectSettings, ResolvedItem } from './types';
import { SUPPORT_TOL, elevationOf, localToBoxRect, placedFootprint, resolveItem } from './resolve';
import { findBoxType } from '../boxes/registry';
import { baseFeaturesOf, bearingAreasOf, engagementOf, keepOutOf, seatDepthOf } from '../boxes/types';
import type { BearingArea, KeepOut } from '../boxes/types';

export const EPS = 1e-6;
export { SUPPORT_TOL, elevationOf };

export interface Rect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export interface ItemRect extends Rect {
  height: number;
  /** Bottom elevation (item.z ?? 0). */
  z: number;
  /** z + height. */
  top: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  /**
   * Machine‑readable kind for issues the views style specially:
   * 'floating' (warning): not fully covered by the items below;
   * 'unstable' (warning): stack fit — may tip;
   * 'stack-fit' (error): stack fit — rests on nothing, base collides with
   * what it rests on, or in the way of another item's keep‑out space.
   */
  kind?: 'floating' | 'unstable' | 'stack-fit';
  itemIds: string[];
  message: string;
}

/** Game box inner rectangle shrunk by the tolerance, centred. */
export function usableArea(settings: ProjectSettings): Rect {
  const { box, tolerance } = settings;
  return {
    x: tolerance.x / 2,
    y: tolerance.y / 2,
    width: box.width - tolerance.x,
    depth: box.depth - tolerance.y,
  };
}

/**
 * Rotated outer rectangle of a placed item. Throws for unknown box types.
 * Pass the project's `items` so context‑dependent heights (platform ridges) count.
 */
export function itemRect(item: PlacedItem, settings: ProjectSettings, items?: readonly PlacedItem[]): ItemRect {
  const fp = placedFootprint(item, settings, items);
  const z = elevationOf(item);
  return { x: item.x, y: item.y, width: fp.width, depth: fp.depth, height: fp.height, z, top: z + fp.height };
}

/** resolveItem (with build context when `items` is given) that never throws (undefined for unknown types / failures). */
function safeResolve(item: PlacedItem, settings: ProjectSettings, items?: readonly PlacedItem[]): ResolvedItem | undefined {
  if (!findBoxType(item.type)) return undefined;
  try {
    return resolveItem(item, settings, items);
  } catch {
    return undefined;
  }
}

/**
 * Engagement of resolved `item` on resolved `below` (0 when either is missing
 * or a definition fails): the item's own engagement on `below` plus the seat
 * depth of `below` (how far below its top its resting surface lies, e.g. a
 * platform's locating ridges).
 */
function pairEngagement(item: ResolvedItem | undefined, below: ResolvedItem | undefined): number {
  if (!item || !below) return 0;
  let own = 0;
  let seat = 0;
  try {
    own = engagementOf(findBoxType(item.type), item, below);
  } catch {
    own = 0;
  }
  try {
    seat = seatDepthOf(findBoxType(below.type), below);
  } catch {
    seat = 0;
  }
  return own + seat;
}

/**
 * How many mm `item` sinks below the top of `below` when stacked on it (0 for
 * unknown types or failing definitions). Depends on both: e.g. a recess only
 * engages a lipped tray; on a platform with locating ridges everything sits
 * on the plate, the ridge height below its top. Pass the project's `items` so
 * `below`'s build context (ridges) counts.
 */
export function itemEngagement(item: PlacedItem, below: PlacedItem, settings: ProjectSettings, items?: readonly PlacedItem[]): number {
  return pairEngagement(safeResolve(item, settings, items), safeResolve(below, settings, items));
}

/** Size used for items whose type is unknown or whose footprint cannot be computed. */
export const FALLBACK_SIZE = 20;

/**
 * Like itemRect, but never throws: unknown types / failing footprints get a
 * FALLBACK_SIZE square and `broken: true` so they stay visible and selectable.
 */
export function safeItemRect(
  item: PlacedItem,
  settings: ProjectSettings,
  items?: readonly PlacedItem[],
): ItemRect & { broken?: true } {
  if (findBoxType(item.type)) {
    try {
      const r = itemRect(item, settings, items);
      if ([r.width, r.depth, r.height].every((v) => Number.isFinite(v) && v >= 0)) return r;
    } catch {
      /* fall through */
    }
  }
  const z = elevationOf(item);
  return { x: item.x, y: item.y, width: FALLBACK_SIZE, depth: FALLBACK_SIZE, height: 0, z, top: z, broken: true };
}

/** Strict overlap: touching edges (within EPS) is allowed. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPS &&
    b.x < a.x + a.width - EPS &&
    a.y < b.y + b.depth - EPS &&
    b.y < a.y + a.depth - EPS
  );
}

/** True if `inner` lies within `outer` (EPS tolerance). */
export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.width <= outer.x + outer.width + EPS &&
    inner.y + inner.depth <= outer.y + outer.depth + EPS
  );
}

type StackRect = ItemRect & { broken?: true; resolved?: ResolvedItem };

function stackRects(items: PlacedItem[], settings: ProjectSettings): StackRect[] {
  return items.map((i) => {
    const r = safeItemRect(i, settings, items);
    return r.broken ? r : { ...r, resolved: safeResolve(i, settings, items) };
  });
}

/** The item's own engagement on `below` (without the seat depth of `below`); 0 on failures. */
function ownEngagement(item: ResolvedItem | undefined, below: ResolvedItem | undefined): number {
  if (!item || !below) return 0;
  try {
    return engagementOf(findBoxType(item.type), item, below);
  } catch {
    return 0;
  }
}

/** Engagement of `hi` stacked on `lo`. */
function engagementOn(hi: StackRect, lo: StackRect): number {
  return pairEngagement(hi.resolved, lo.resolved);
}

/**
 * Z ranges of two XY‑overlapping items intersect. The upper item (higher z)
 * may sink its engagement on the lower one into it: its effective bottom is
 * z + engagement. Items at the same z always collide.
 */
function zCollide(a: StackRect, b: StackRect): boolean {
  if (Math.abs(a.z - b.z) <= EPS) return true;
  const [lo, hi] = a.z < b.z ? [a, b] : [b, a];
  return hi.z + engagementOn(hi, lo) < lo.top - EPS && lo.z < hi.top - EPS;
}

/** Pairs of items that overlap in XY and whose (engagement‑adjusted) Z ranges intersect. */
export function findOverlaps(items: PlacedItem[], settings: ProjectSettings): [string, string][] {
  const rects = stackRects(items, settings);
  const out: [string, string][] = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (rectsOverlap(rects[a], rects[b]) && zCollide(rects[a], rects[b])) out.push([items[a].id, items[b].id]);
    }
  }
  return out;
}

/**
 * True when `target` is completely covered by the union of `cover` (EPS
 * tolerance). Exact, via coordinate compression: every cell of the grid
 * spanned by all rectangle edges inside `target` must lie in some cover rect.
 */
export function rectCovered(target: Rect, cover: Rect[]): boolean {
  if (target.width <= EPS || target.depth <= EPS) return true;
  const x0 = target.x;
  const y0 = target.y;
  const x1 = target.x + target.width;
  const y1 = target.y + target.depth;
  const clipped: Rect[] = [];
  for (const c of cover) {
    const cx0 = Math.max(x0, c.x);
    const cy0 = Math.max(y0, c.y);
    const cx1 = Math.min(x1, c.x + c.width);
    const cy1 = Math.min(y1, c.y + c.depth);
    if (cx1 - cx0 > EPS && cy1 - cy0 > EPS) clipped.push({ x: cx0, y: cy0, width: cx1 - cx0, depth: cy1 - cy0 });
  }
  if (!clipped.length) return false;
  const uniq = (vs: number[]) => {
    const sorted = vs.slice().sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > EPS) out.push(v);
    return out;
  };
  const xs = uniq([x0, x1, ...clipped.flatMap((c) => [c.x, c.x + c.width])]);
  const ys = uniq([y0, y1, ...clipped.flatMap((c) => [c.y, c.y + c.depth])]);
  for (let i = 0; i + 1 < xs.length; i++) {
    const mx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j + 1 < ys.length; j++) {
      const my = (ys[j] + ys[j + 1]) / 2;
      const inside = clipped.some((c) => mx > c.x - EPS && mx < c.x + c.width + EPS && my > c.y - EPS && my < c.y + c.depth + EPS);
      if (!inside) return false;
    }
  }
  return true;
}

/**
 * Ids of items with z > 0 that are not fully supported: their XY rect must be
 * covered by the union of the rects of items `o` with
 * o.top − engagement(item on o) = z (within SUPPORT_TOL).
 */
export function unsupportedItems(items: PlacedItem[], settings: ProjectSettings): string[] {
  const rects = stackRects(items, settings);
  const out: string[] = [];
  items.forEach((item, idx) => {
    const r = rects[idx];
    if (!(r.z > EPS)) return;
    if (!rectCovered(r, supportersOf(rects, idx).map((j) => rects[j]))) out.push(item.id);
  });
  return out;
}

/**
 * Elevation at which an item rests on whatever it overlaps in XY:
 * max over XY‑overlapping others `o` of (o.top − engagement(item on o)), i.e.
 * the highest effective surface, or 0 when it overlaps nothing.
 */
export function restingElevation(itemId: string, items: PlacedItem[], settings: ProjectSettings): number {
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return 0;
  const rects = stackRects(items, settings);
  const r = rects[idx];
  let z = 0;
  rects.forEach((o, j) => {
    if (j !== idx && rectsOverlap(o, r)) z = Math.max(z, o.top - engagementOn(r, o));
  });
  return z;
}

/* ---------------------------------------------------------------- gravity */

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** `item` with bottom elevation `z` (rounded, ≥ 0; 0 deletes the field); the same object when unchanged. */
export function withElevation(item: PlacedItem, z: number): PlacedItem {
  const nz = Number.isFinite(z) ? Math.max(0, round3(z)) : 0;
  if (item.z === nz && nz !== 0) return item;
  if (nz === 0 && item.z === undefined) return item;
  const next: PlacedItem = { ...item, z: nz };
  if (nz === 0) delete next.z;
  return next;
}

/** One settle pass on stack rects computed from `items` (current z values). */
function settlePass(items: PlacedItem[], settings: ProjectSettings): PlacedItem[] {
  const rects = stackRects(items, settings);
  let out: PlacedItem[] | null = null;
  for (let i = 0; i < items.length; i++) {
    const r = rects[i];
    let z = 0;
    for (let j = 0; j < i; j++) {
      const o = rects[j];
      if (rectsOverlap(o, r)) z = Math.max(z, o.top - engagementOn(r, o));
    }
    const next = withElevation(items[i], z);
    if (next === items[i]) continue;
    out ??= items.slice();
    out[i] = next;
    const nz = elevationOf(next);
    rects[i] = { ...r, z: nz, top: nz + r.height };
  }
  return out ?? items;
}

/**
 * Gravity (DESIGN.md §2): the stack order is the order of `items`; every item
 * rests on the highest effective surface among the *earlier* items it
 * overlaps in XY — max of `o.top − engagement(item on o)` (lip / recess /
 * plug, platform ridges), or the floor (0). Returns the items with their
 * cached `z` updated (rounded to 0.001 mm, 0 ⇒ field deleted). Unchanged items
 * keep their identity, and when nothing changes the input array itself is
 * returned.
 *
 * Context‑dependent heights (platform ridges depend on what rests on the
 * platform) are handled by repeating the pass until nothing changes; the
 * effective surface of a ridged platform does not depend on its ridges, so
 * this converges in one or two passes.
 */
export function settle(items: PlacedItem[], settings: ProjectSettings): PlacedItem[] {
  let cur = items;
  for (let pass = 0; pass < 8; pass++) {
    const next = settlePass(cur, settings);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * For settled items: the ids of the items each item rests on (its supporters,
 * see `stackFit`), only among earlier items. Items on the floor map to [].
 */
export function supportersById(items: PlacedItem[], settings: ProjectSettings): Map<string, string[]> {
  const rects = stackRects(items, settings);
  const out = new Map<string, string[]>();
  items.forEach((item, idx) => {
    const sup = rects[idx].z > EPS ? supportersOf(rects, idx).filter((j) => j < idx) : [];
    out.set(
      item.id,
      sup.map((j) => items[j].id),
    );
  });
  return out;
}

/**
 * For settled items: `id` plus every item resting on it, directly or
 * transitively — what moves along when the item is dragged with its stack.
 * An item resting on several items (a bridge) is included only when all of
 * its supporters are. Returned in array (stack) order; [] for unknown ids.
 */
export function carriedItemIds(items: PlacedItem[], settings: ProjectSettings, id: string): string[] {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return [];
  const supporters = supportersById(items, settings);
  const set = new Set([id]);
  for (let k = idx + 1; k < items.length; k++) {
    const sup = supporters.get(items[k].id) ?? [];
    if (sup.length && sup.every((s) => set.has(s))) set.add(items[k].id);
  }
  return items.filter((i) => set.has(i.id)).map((i) => i.id);
}

/**
 * For settled items: `id` plus every item resting on it directly or
 * transitively through *any* supporter (unlike `carriedItemIds`, a bridge is
 * included when one of its supporters is). Array (stack) order; [] for
 * unknown ids.
 */
export function stackedAboveIds(items: PlacedItem[], settings: ProjectSettings, id: string): string[] {
  const idx = items.findIndex((i) => i.id === id);
  if (idx < 0) return [];
  const supporters = supportersById(items, settings);
  const set = new Set([id]);
  for (let k = idx + 1; k < items.length; k++) {
    if ((supporters.get(items[k].id) ?? []).some((s) => set.has(s))) set.add(items[k].id);
  }
  return items.filter((i) => set.has(i.id)).map((i) => i.id);
}

export function itemsOutsideUsable(items: PlacedItem[], settings: ProjectSettings): string[] {
  const usable = usableArea(settings);
  return items.filter((i) => !rectInside(safeItemRect(i, settings, items), usable)).map((i) => i.id);
}

/**
 * Top of an item including its keep‑out space (standing cards): the highest
 * point anything of it reaches. Never throws.
 */
export function effectiveTop(item: PlacedItem, settings: ProjectSettings, items?: readonly PlacedItem[]): number {
  const r = safeItemRect(item, settings, items);
  if (r.broken) return r.top;
  let top = r.top;
  for (const k of placedKeepOut(item, r, safeResolve(item, settings, items))) top = Math.max(top, k.bottom + k.height);
  return top;
}

export function itemsTooTall(items: PlacedItem[], settings: ProjectSettings): string[] {
  return items.filter((i) => effectiveTop(i, settings, items) > settings.box.height + EPS).map((i) => i.id);
}

/* ---------------------------------------------------------------- stack fit */

/**
 * An item rests safely when its centre lies inside the convex hull of its
 * contact area by at least this fraction of its smaller side; otherwise it
 * "may tip" (warning).
 */
export const TIP_MARGIN_FRACTION = 0.1;

/** A bearing area in the game box frame, `height` absolute (above the game box floor). */
interface PlacedArea extends Rect {
  height: number;
  role: NonNullable<BearingArea['role']>;
  name: string;
}

/** A keep‑out space in the game box frame from `bottom` (the item's top) up `height`. */
interface PlacedKeepOut extends Rect {
  bottom: number;
  height: number;
  name: string;
  fix?: string;
}

/** Unrotated footprint of a (non‑broken) stack rect. */
function localFootprint(item: PlacedItem, r: ItemRect) {
  return item.rotation === 90
    ? { width: r.depth, depth: r.width, height: r.height }
    : { width: r.width, depth: r.depth, height: r.height };
}

function toBox<R extends Rect>(item: PlacedItem, r: ItemRect, local: R): R {
  return localToBoxRect(item, localFootprint(item, r).depth, local);
}

const localRect = (a: { x: number; y: number; width: number; depth: number }): Rect => ({
  x: a.x,
  y: a.y,
  width: a.width,
  depth: a.depth,
});

function placedBearingAreas(item: PlacedItem, r: ItemRect, resolved: ResolvedItem | undefined): PlacedArea[] {
  const def = findBoxType(item.type);
  if (!def || !resolved) return [];
  try {
    return bearingAreasOf(def, resolved, localFootprint(item, r)).map((a) => ({
      ...toBox(item, r, localRect(a)),
      height: r.z + a.height,
      role: a.role ?? 'bearing',
      name: a.name ?? 'top',
    }));
  } catch {
    return [];
  }
}

function placedBaseFeatures(item: PlacedItem, r: ItemRect, resolved: ResolvedItem | undefined) {
  const def = findBoxType(item.type);
  if (!def || !resolved) return [];
  try {
    return baseFeaturesOf(def, resolved).map((f) => ({ ...toBox(item, r, localRect(f)), kind: f.kind, height: f.height, name: f.name }));
  } catch {
    return [];
  }
}

function placedKeepOut(item: PlacedItem, r: ItemRect, resolved: ResolvedItem | undefined): PlacedKeepOut[] {
  const def = findBoxType(item.type);
  if (!def || !resolved) return [];
  try {
    return keepOutOf(def, resolved).map((k: KeepOut) => ({
      ...toBox(item, r, localRect(k)),
      bottom: r.top,
      height: k.height,
      name: k.name,
      ...(k.fix ? { fix: k.fix } : {}),
    }));
  } catch {
    return [];
  }
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.depth, b.y + b.depth);
  return x1 - x0 > EPS && y1 - y0 > EPS ? { x: x0, y: y0, width: x1 - x0, depth: y1 - y0 } : null;
}

const containsPoint = (r: Rect, px: number, py: number) =>
  px > r.x - EPS && px < r.x + r.width + EPS && py > r.y - EPS && py < r.y + r.depth + EPS;

/** Convex hull (counter‑clockwise in x/y, Andrew's monotone chain). */
function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= EPS) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= EPS) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Signed distance of (px, py) inside the convex hull of `rects` (positive =
 * inside, distance to the nearest hull edge); −Infinity for a degenerate hull.
 */
function hullDepth(rects: Rect[], px: number, py: number): number {
  const hull = convexHull(
    rects.flatMap((r): [number, number][] => [
      [r.x, r.y],
      [r.x + r.width, r.y],
      [r.x, r.y + r.depth],
      [r.x + r.width, r.y + r.depth],
    ]),
  );
  if (hull.length < 3) return -Infinity;
  let depth = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= EPS) continue;
    // Counter‑clockwise: inside is to the left of every edge.
    depth = Math.min(depth, ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / len);
  }
  return depth;
}

/** A part of what an item rests on that reaches into its base. */
export interface StackCollision {
  supporterId: string;
  /** What of the item is hit: a protrusion name ("plug", "corner stop"), "floor" or "recess". */
  part: string;
  /** Whether `part` is a protrusion. */
  protrusion: boolean;
  /** Names of the supporter's areas that reach into it ("wall", "lip", "divider", …). */
  areas: string[];
  /** Whether every area hit is a lip / ridge. */
  lip: boolean;
}

/** Stack fit of one item with z > 0 that rests on at least one other item. */
export interface StackFit {
  itemId: string;
  /** Items it rests on (top − engagement = z within SUPPORT_TOL). */
  supporterIds: string[];
  /** Footprint ∩ bearing areas of the supporters at its base height. */
  contact: Rect[];
  /** Names of the bearing areas in contact. */
  contactNames: string[];
  /** 'none': no contact; 'tip': the centre is not inside the contact hull by the margin. */
  bearing: 'ok' | 'tip' | 'none';
  collisions: StackCollision[];
}

/** Supporters of rect `idx`: the others it overlaps whose top − engagement = its z. */
function supportersOf(rects: StackRect[], idx: number): number[] {
  const r = rects[idx];
  const out: number[] = [];
  rects.forEach((o, j) => {
    if (j !== idx && !o.broken && rectsOverlap(o, r) && Math.abs(o.top - engagementOn(r, o) - r.z) <= SUPPORT_TOL) out.push(j);
  });
  return out;
}

/**
 * Stack fit check (DESIGN.md §4.3) for every item with z > 0 that rests on
 * something:
 *
 * * Bearing: contact = footprint ∩ the supporters' bearing areas whose
 *   height lies within [z, z + own engagement on that supporter] (± SUPPORT_TOL).
 *   No contact → 'none'; the footprint centre not inside the contact's convex
 *   hull by TIP_MARGIN_FRACTION × the smaller side → 'tip'.
 * * Fit: no area of a supporter may reach above the item's base where it lies:
 *   the base is at z under a protrusion (plug, stops), at z + P elsewhere (P =
 *   tallest protrusion) and z + P + depth under a recess.
 */
export function stackFit(items: PlacedItem[], settings: ProjectSettings): StackFit[] {
  return stackFitFor(items, stackRects(items, settings));
}

function stackFitFor(items: PlacedItem[], rects: StackRect[]): StackFit[] {
  const out: StackFit[] = [];
  items.forEach((item, idx) => {
    const r = rects[idx];
    if (r.broken || !(r.z > EPS)) return;
    const sup = supportersOf(rects, idx);
    if (!sup.length) return;
    const features = placedBaseFeatures(item, r, r.resolved);
    const P = Math.max(0, ...features.filter((f) => f.kind === 'protrusion').map((f) => f.height));
    const contact: Rect[] = [];
    const contactNames = new Set<string>();
    const collisions: StackCollision[] = [];
    for (const j of sup) {
      const o = rects[j];
      const ownE = ownEngagement(r.resolved, o.resolved);
      const hits = new Map<string, { protrusion: boolean; areas: Set<string>; lip: boolean }>();
      for (const a of placedBearingAreas(items[j], o, o.resolved)) {
        const I = intersect(a, r);
        if (!I) continue;
        if (a.role !== 'low' && a.height >= r.z - SUPPORT_TOL && a.height <= r.z + ownE + SUPPORT_TOL) {
          contact.push(I);
          contactNames.add(a.name);
        }
        if (a.height <= r.z + SUPPORT_TOL) continue;
        // Cells of I split by the base features; base height per cell.
        const fs = features.map((f) => intersect(f, I)).map((c, k) => (c ? { ...features[k], ...c } : null)).filter((f) => f !== null);
        const xs = uniqSorted([I.x, I.x + I.width, ...fs.flatMap((f) => [f.x, f.x + f.width])]);
        const ys = uniqSorted([I.y, I.y + I.depth, ...fs.flatMap((f) => [f.y, f.y + f.depth])]);
        for (let xi = 0; xi + 1 < xs.length; xi++) {
          for (let yi = 0; yi + 1 < ys.length; yi++) {
            const mx = (xs[xi] + xs[xi + 1]) / 2;
            const my = (ys[yi] + ys[yi + 1]) / 2;
            const here = fs.filter((f) => containsPoint(f, mx, my));
            const prot = here.find((f) => f.kind === 'protrusion');
            const rec = here.filter((f) => f.kind === 'recess');
            const base = prot ? r.z : r.z + P + Math.max(0, ...rec.map((f) => f.height));
            if (a.height <= base + SUPPORT_TOL) continue;
            const part = prot ? prot.name : rec.length ? rec[0].name : 'floor';
            const h = hits.get(part) ?? { protrusion: !!prot, areas: new Set<string>(), lip: true };
            h.areas.add(a.name);
            if (a.role !== 'lip') h.lip = false;
            hits.set(part, h);
          }
        }
      }
      for (const [part, h] of hits) {
        collisions.push({ supporterId: items[j].id, part, protrusion: h.protrusion, areas: [...h.areas], lip: h.lip });
      }
    }
    let bearing: StackFit['bearing'] = 'ok';
    if (!contact.length) bearing = 'none';
    else {
      const margin = TIP_MARGIN_FRACTION * Math.min(r.width, r.depth);
      if (hullDepth(contact, r.x + r.width / 2, r.y + r.depth / 2) < margin - EPS) bearing = 'tip';
    }
    out.push({ itemId: item.id, supporterIds: sup.map((j) => items[j].id), contact, contactNames: [...contactNames], bearing, collisions });
  });
  return out;
}

function uniqSorted(vs: number[]): number[] {
  const sorted = vs.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

/** Pairs [keeperId, intruderId]: items reaching into another item's keep‑out space (standing cards). */
export function keepOutViolations(items: PlacedItem[], settings: ProjectSettings): { keeperId: string; intruderId: string; keepOut: PlacedKeepOut }[] {
  return keepOutFor(items, stackRects(items, settings));
}

function keepOutFor(items: PlacedItem[], rects: StackRect[]) {
  const out: { keeperId: string; intruderId: string; keepOut: PlacedKeepOut }[] = [];
  items.forEach((item, idx) => {
    const r = rects[idx];
    if (r.broken) return;
    for (const k of placedKeepOut(item, r, r.resolved)) {
      rects.forEach((o, j) => {
        if (j === idx || o.broken) return;
        if (!rectsOverlap(o, k)) return;
        if (o.z < k.bottom + k.height - EPS && o.top > k.bottom + EPS) {
          if (!out.some((v) => v.keeperId === item.id && v.intruderId === items[j].id)) {
            out.push({ keeperId: item.id, intruderId: items[j].id, keepOut: k });
          }
        }
      });
    }
  });
  return out;
}

/* ---------------------------------------------------------------- snapping */

export interface SnapGuide {
  /** 'x' = vertical line at x = pos; 'y' = horizontal line at y = pos. */
  axis: 'x' | 'y';
  pos: number;
  /** Extent of the line along the other axis. */
  from: number;
  to: number;
  kind: 'usable' | 'item';
}

export type SnapKind = 'usable' | 'item' | 'grid' | null;

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  snapX: SnapKind;
  snapY: SnapKind;
}

interface Line {
  pos: number;
  /** Extent along the other axis (for guide drawing). */
  from: number;
  to: number;
  kind: 'usable' | 'item';
}

interface AxisSnap {
  value: number;
  kind: SnapKind;
  /** Moving-edge coordinates that coincide with a target line. */
  lines: number[];
}

function snapAxis(
  proposed: number,
  size: number,
  lines: Line[],
  origin: number,
  gridSnap: number,
  threshold: number,
): AxisSnap {
  let best: { value: number; dist: number; kind: 'usable' | 'item' } | null = null;
  for (const l of lines) {
    // Align the moving item's leading edge or trailing edge with the line.
    for (const cand of [l.pos, l.pos - size]) {
      const dist = Math.abs(cand - proposed);
      if (dist > threshold + EPS) continue;
      if (
        !best ||
        dist < best.dist - EPS ||
        (Math.abs(dist - best.dist) <= EPS && l.kind === 'usable' && best.kind === 'item')
      ) {
        best = { value: cand, dist, kind: l.kind };
      }
    }
  }
  if (best) {
    const v = best.value;
    return { value: v, kind: best.kind, lines: [v, v + size] };
  }
  if (gridSnap > 0) {
    return { value: origin + Math.round((proposed - origin) / gridSnap) * gridSnap, kind: 'grid', lines: [] };
  }
  return { value: proposed, kind: null, lines: [] };
}

function guidesFor(
  axis: 'x' | 'y',
  edges: number[],
  lines: Line[],
  movingFrom: number,
  movingTo: number,
): SnapGuide[] {
  const out: SnapGuide[] = [];
  for (const e of edges) {
    const matching = lines.filter((l) => Math.abs(l.pos - e) <= EPS);
    if (!matching.length) continue;
    let from = movingFrom;
    let to = movingTo;
    let kind: 'usable' | 'item' = 'item';
    for (const m of matching) {
      from = Math.min(from, m.from);
      to = Math.max(to, m.to);
      if (m.kind === 'usable') kind = 'usable';
    }
    out.push({ axis, pos: e, from, to, kind });
  }
  return out;
}

/**
 * Snap a moving rectangle's proposed top-left corner to the usable-area edges
 * and to the edges of other items (edge-to-edge and aligned edges). Axes that
 * do not snap to an edge snap to the grid (relative to the usable origin).
 * Snapping is computed purely from `proposed`, so it is never sticky beyond
 * `threshold`.
 */
export function snapPosition(
  moving: { width: number; depth: number },
  proposed: { x: number; y: number },
  others: Rect[],
  usable: Rect,
  gridSnap: number,
  threshold = 3,
): SnapResult {
  const xLines: Line[] = [
    { pos: usable.x, from: usable.y, to: usable.y + usable.depth, kind: 'usable' },
    { pos: usable.x + usable.width, from: usable.y, to: usable.y + usable.depth, kind: 'usable' },
  ];
  const yLines: Line[] = [
    { pos: usable.y, from: usable.x, to: usable.x + usable.width, kind: 'usable' },
    { pos: usable.y + usable.depth, from: usable.x, to: usable.x + usable.width, kind: 'usable' },
  ];
  for (const o of others) {
    xLines.push({ pos: o.x, from: o.y, to: o.y + o.depth, kind: 'item' });
    xLines.push({ pos: o.x + o.width, from: o.y, to: o.y + o.depth, kind: 'item' });
    yLines.push({ pos: o.y, from: o.x, to: o.x + o.width, kind: 'item' });
    yLines.push({ pos: o.y + o.depth, from: o.x, to: o.x + o.width, kind: 'item' });
  }
  const sx = snapAxis(proposed.x, moving.width, xLines, usable.x, gridSnap, threshold);
  const sy = snapAxis(proposed.y, moving.depth, yLines, usable.y, gridSnap, threshold);
  const guides = [
    ...guidesFor('x', sx.lines, xLines, sy.value, sy.value + moving.depth),
    ...guidesFor('y', sy.lines, yLines, sx.value, sx.value + moving.width),
  ];
  return { x: sx.value, y: sy.value, guides, snapX: sx.kind, snapY: sy.kind };
}

/* ---------------------------------------------------------------- summary */

export interface LayoutSummary {
  itemCount: number;
  usable: Rect;
  /** Bounding box of all items, null when empty. */
  bounds: Rect | null;
  /** usable.width − bounds.width (usable.width when empty). Negative = too wide. */
  slackX: number;
  /** usable.depth − bounds.depth (usable.depth when empty). */
  slackY: number;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

export function boundingBox(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.depth);
  }
  return { x: x0, y: y0, width: x1 - x0, depth: y1 - y0 };
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "a", "a and b", "a, b and c". */
function joinAnd(parts: string[]): string {
  const u = [...new Set(parts)];
  return u.length <= 1 ? (u[0] ?? '') : `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}
/** Plural of an area / feature name for messages ("wall" → "walls"; one‑piece faces stay singular). */
const SINGULAR = new Set(['top', 'plate', 'floor']);
const plural = (n: string) => (n.endsWith('s') || SINGULAR.has(n) ? n : `${n}s`);

export function layoutSummary(items: PlacedItem[], settings: ProjectSettings): LayoutSummary {
  const usable = usableArea(settings);
  const rects = stackRects(items, settings);
  const bounds = boundingBox(rects);
  const label = (id: string) => items.find((i) => i.id === id)?.label || id;
  const issues: ValidationIssue[] = [];

  if (usable.width <= 0 || usable.depth <= 0) {
    issues.push({ severity: 'error', itemIds: [], message: 'Tolerance is larger than the game box.' });
  }

  items.forEach((item, idx) => {
    if (!findBoxType(item.type)) {
      issues.push({ severity: 'error', itemIds: [item.id], message: `${label(item.id)}: unknown box type "${item.type}".` });
    } else if (rects[idx].broken) {
      issues.push({ severity: 'error', itemIds: [item.id], message: `${label(item.id)}: footprint could not be computed.` });
    }
  });

  const index = new Map(items.map((i, idx) => [i.id, idx]));
  for (const [a, b] of findOverlaps(items, settings)) {
    const ra = rects[index.get(a)!];
    const rb = rects[index.get(b)!];
    const [lo, hi, loId, hiId] = ra.z <= rb.z ? [ra, rb, a, b] : [rb, ra, b, a];
    const seat = hi.z + engagementOn(hi, lo);
    if (seat > lo.z + EPS && seat < lo.top - EPS) {
      // Stacked item whose base lies inside the body of the item below.
      issues.push({
        severity: 'error',
        itemIds: [hiId, loId],
        message: `${label(hiId)} intersects ${label(loId)}: its base at ${fmt(seat)} mm is below the top of ${label(loId)} (${fmt(lo.top)} mm).`,
      });
    } else {
      issues.push({ severity: 'error', itemIds: [a, b], message: `${label(a)} overlaps ${label(b)}.` });
    }
  }
  for (const id of itemsOutsideUsable(items, settings)) {
    issues.push({ severity: 'error', itemIds: [id], message: `${label(id)} is outside the usable area.` });
  }
  const keepOuts = keepOutFor(items, rects);
  items.forEach((item, idx) => {
    const { top, z } = rects[idx];
    const k = rects[idx].broken ? [] : placedKeepOut(item, rects[idx], rects[idx].resolved);
    const kTop = Math.max(top, ...k.map((o) => o.bottom + o.height));
    if (kTop > top + EPS && kTop > settings.box.height + EPS) {
      const ko = k.reduce((a, b) => (b.bottom + b.height > a.bottom + a.height ? b : a));
      issues.push({
        severity: 'error',
        itemIds: [item.id],
        message:
          `${label(item.id)} is too tall: its ${ko.name} reach ${fmt(kTop)} mm > box ${fmt(settings.box.height)} mm` +
          (top > settings.box.height + EPS ? ` (the tray itself ${fmt(top)} mm).` : ` (the tray itself only ${fmt(top)} mm).`) +
          (ko.fix ? ` ${capitalize(ko.fix)} of ${label(item.id)} or use a taller game box.` : ''),
      });
    } else if (top > settings.box.height + EPS) {
      issues.push({
        severity: 'error',
        itemIds: [item.id],
        message:
          z > EPS
            ? `${label(item.id)} is too tall (top at ${fmt(top)} mm > box ${fmt(settings.box.height)} mm).`
            : `${label(item.id)} is too tall (${fmt(top)} mm > box ${fmt(settings.box.height)} mm).`,
      });
    }
  });
  for (const v of keepOuts) {
    const k = v.keepOut;
    issues.push({
      severity: 'error',
      kind: 'stack-fit',
      itemIds: [v.intruderId, v.keeperId],
      message:
        `${label(v.intruderId)} is in the way of the ${k.name} of ${label(v.keeperId)}, which stick out ${fmt(k.height)} mm above it. ` +
        `Move ${label(v.intruderId)} off ${label(v.keeperId)}` +
        (k.fix ? `, or ${k.fix} of ${label(v.keeperId)}.` : '.'),
    });
  }

  // Stack fit: per item one support message (rests on nothing / may tip /
  // floating), plus base collisions.
  const fits = new Map(stackFitFor(items, rects).map((f) => [f.itemId, f]));
  const unsupported = new Set(unsupportedItems(items, settings));
  const names = (ids: string[]) => joinAnd(ids.map(label));
  for (const [id, fit] of fits) {
    const A = label(id);
    for (const c of fit.collisions) {
      const S = label(c.supporterId);
      const what = joinAnd(c.areas.map(plural));
      let message: string;
      if (c.protrusion) {
        message =
          `${A}: its ${c.part} does not fit into ${S}: it hits the ${what} of ${S}. A ${c.part} needs an empty cavity below. ` +
          `Move ${A} so its ${c.part} drops into an open cavity, or give ${A} a base without ${plural(c.part)}.`;
      } else if (c.lip) {
        message =
          `${A} collides with the ${what} of ${S}: it lies under the ${c.part} of ${A}, not under its recess. ` +
          `Line up the edges of ${A} with the walls of ${S} so the ${what} drop into the recess, or give ${A} a flat base.`;
      } else {
        message =
          `${A} collides with the ${what} of ${S}, which reach into its ${c.part}. ` +
          `Move ${A} or change its base.`;
      }
      issues.push({ severity: 'error', kind: 'stack-fit', itemIds: [id, c.supporterId], message });
    }
    if (fit.bearing === 'none') {
      issues.push({
        severity: 'error',
        kind: 'stack-fit',
        itemIds: [id],
        message:
          `${A} rests on nothing: it hangs over the open cavity of ${names(fit.supporterIds)}. ` +
          `Move it so it reaches the walls of ${names(fit.supporterIds)}, or put a platform under it.`,
      });
    } else if (fit.bearing === 'tip') {
      issues.push({
        severity: 'warning',
        kind: 'unstable',
        itemIds: [id],
        message:
          `${A} may tip: it bears only on the ${joinAnd(fit.contactNames.map(plural))} of ${names(fit.supporterIds)} on one side of its centre. ` +
          `Make it reach opposite walls of ${names(fit.supporterIds)}, or put a platform under it.`,
      });
    }
  }
  for (const id of unsupported) {
    const fit = fits.get(id);
    if (fit && fit.bearing !== 'ok') continue; // already reported above
    const r = rects[index.get(id)!];
    issues.push({
      severity: 'warning',
      kind: 'floating',
      itemIds: [id],
      message: `Floating: nothing underneath ${label(id)} supports it fully at z = ${fmt(r.z)} mm.`,
    });
  }

  for (const item of items) {
    const def = findBoxType(item.type);
    if (!def?.validate) continue;
    try {
      for (const msg of def.validate(resolveItem(item, settings, items))) {
        issues.push({ severity: 'warning', itemIds: [item.id], message: `${label(item.id)}: ${msg}` });
      }
    } catch (e) {
      issues.push({ severity: 'warning', itemIds: [item.id], message: `${label(item.id)}: ${String(e)}` });
    }
  }

  return {
    itemCount: items.length,
    usable,
    bounds,
    slackX: usable.width - (bounds?.width ?? 0),
    slackY: usable.depth - (bounds?.depth ?? 0),
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    issues,
  };
}

/**
 * Ids of stacked items with a support warning: floating (not fully covered)
 * or unstable (may tip). Only the stacked item, not what it rests on.
 */
export function floatingItemIds(summary: LayoutSummary): Set<string> {
  const s = new Set<string>();
  for (const i of summary.issues) if (i.kind === 'floating' || i.kind === 'unstable') s.add(i.itemIds[0]);
  return s;
}

/** Ids of items involved in any warning-level issue. */
export function warningItemIds(summary: LayoutSummary): Set<string> {
  const s = new Set<string>();
  for (const i of summary.issues) if (i.severity === 'warning') i.itemIds.forEach((id) => s.add(id));
  return s;
}

/** Ids of items involved in any error-level issue. */
export function errorItemIds(summary: LayoutSummary): Set<string> {
  const s = new Set<string>();
  for (const i of summary.issues) if (i.severity === 'error') i.itemIds.forEach((id) => s.add(id));
  return s;
}
