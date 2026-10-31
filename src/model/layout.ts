/**
 * Pure 2D layout helpers for the top view (game box frame, mm). See DESIGN.md §2.
 */
import type { PlacedItem, ProjectSettings } from './types';
import { placedFootprint, resolveItem } from './resolve';
import { findBoxType } from '../boxes/registry';
import { engagementOf } from '../boxes/types';

export const EPS = 1e-6;
/** Tolerance (mm) for "this item rests on that one" (top of supporter = bottom + engagement). */
export const SUPPORT_TOL = 0.01;

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
  /** Machine‑readable kind for issues the views style specially. */
  kind?: 'floating';
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

/** Rotated outer rectangle of a placed item. Throws for unknown box types. */
export function itemRect(item: PlacedItem, settings: ProjectSettings): ItemRect {
  const fp = placedFootprint(item, settings);
  const z = elevationOf(item);
  return { x: item.x, y: item.y, width: fp.width, depth: fp.depth, height: fp.height, z, top: z + fp.height };
}

/** item.z with undefined / invalid → 0. */
export function elevationOf(item: PlacedItem): number {
  const z = item.z;
  return typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 0;
}

/** Stack engagement of a placed item (0 for unknown types or failing definitions). */
export function itemEngagement(item: PlacedItem, settings: ProjectSettings): number {
  const def = findBoxType(item.type);
  if (!def?.stackEngagement) return 0;
  try {
    return engagementOf(def, resolveItem(item, settings));
  } catch {
    return 0;
  }
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
): ItemRect & { broken?: true } {
  if (findBoxType(item.type)) {
    try {
      const r = itemRect(item, settings);
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

type StackRect = ItemRect & { broken?: true; engagement: number };

function stackRects(items: PlacedItem[], settings: ProjectSettings): StackRect[] {
  return items.map((i) => {
    const r = safeItemRect(i, settings);
    return { ...r, engagement: r.broken ? 0 : itemEngagement(i, settings) };
  });
}

/**
 * Z ranges of two XY‑overlapping items intersect. The upper item (higher z)
 * may sink `engagement` mm into the lower one: its effective bottom is
 * z + engagement. Items at the same z always collide.
 */
function zCollide(a: StackRect, b: StackRect): boolean {
  if (Math.abs(a.z - b.z) <= EPS) return true;
  const [lo, hi] = a.z < b.z ? [a, b] : [b, a];
  return hi.z + hi.engagement < lo.top - EPS && lo.z < hi.top - EPS;
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
 * covered by the union of the rects of items whose top equals the item's
 * z + engagement (within SUPPORT_TOL).
 */
export function unsupportedItems(items: PlacedItem[], settings: ProjectSettings): string[] {
  const rects = stackRects(items, settings);
  const out: string[] = [];
  items.forEach((item, idx) => {
    const r = rects[idx];
    if (!(r.z > EPS)) return;
    const seat = r.z + r.engagement;
    const supporters = rects.filter(
      (o, j) => j !== idx && !o.broken && Math.abs(o.top - seat) <= SUPPORT_TOL && rectsOverlap(o, r),
    );
    if (!rectCovered(r, supporters)) out.push(item.id);
  });
  return out;
}

/**
 * Elevation at which an item rests on whatever it overlaps in XY:
 * max(top of overlapping others) − engagement, or 0 when it overlaps nothing.
 */
export function restingElevation(itemId: string, items: PlacedItem[], settings: ProjectSettings): number {
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return 0;
  const rects = stackRects(items, settings);
  const r = rects[idx];
  let top = -Infinity;
  rects.forEach((o, j) => {
    if (j !== idx && rectsOverlap(o, r)) top = Math.max(top, o.top);
  });
  if (top === -Infinity) return 0;
  return Math.max(0, top - r.engagement);
}

export function itemsOutsideUsable(items: PlacedItem[], settings: ProjectSettings): string[] {
  const usable = usableArea(settings);
  return items.filter((i) => !rectInside(safeItemRect(i, settings), usable)).map((i) => i.id);
}

export function itemsTooTall(items: PlacedItem[], settings: ProjectSettings): string[] {
  return items
    .filter((i) => safeItemRect(i, settings).top > settings.box.height + EPS)
    .map((i) => i.id);
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
    const seat = hi.z + hi.engagement;
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
  items.forEach((item, idx) => {
    const { top, z } = rects[idx];
    if (top > settings.box.height + EPS) {
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
  for (const id of unsupportedItems(items, settings)) {
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
      for (const msg of def.validate(resolveItem(item, settings))) {
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

/** Ids of items flagged as floating (unsupported) by the summary. */
export function floatingItemIds(summary: LayoutSummary): Set<string> {
  const s = new Set<string>();
  for (const i of summary.issues) if (i.kind === 'floating') i.itemIds.forEach((id) => s.add(id));
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
