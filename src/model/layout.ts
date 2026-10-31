/**
 * Pure 2D layout helpers for the top view (game box frame, mm). See DESIGN.md §2.
 */
import type { PlacedItem, ProjectSettings } from './types';
import { placedFootprint, resolveItem } from './resolve';
import { findBoxType } from '../boxes/registry';

export const EPS = 1e-6;

export interface Rect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export interface ItemRect extends Rect {
  height: number;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
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
  return { x: item.x, y: item.y, width: fp.width, depth: fp.depth, height: fp.height };
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
  return { x: item.x, y: item.y, width: FALLBACK_SIZE, depth: FALLBACK_SIZE, height: 0, broken: true };
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

export function findOverlaps(items: PlacedItem[], settings: ProjectSettings): [string, string][] {
  const rects = items.map((i) => safeItemRect(i, settings));
  const out: [string, string][] = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (rectsOverlap(rects[a], rects[b])) out.push([items[a].id, items[b].id]);
    }
  }
  return out;
}

export function itemsOutsideUsable(items: PlacedItem[], settings: ProjectSettings): string[] {
  const usable = usableArea(settings);
  return items.filter((i) => !rectInside(safeItemRect(i, settings), usable)).map((i) => i.id);
}

export function itemsTooTall(items: PlacedItem[], settings: ProjectSettings): string[] {
  return items
    .filter((i) => safeItemRect(i, settings).height > settings.box.height + EPS)
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
  const rects = items.map((i) => safeItemRect(i, settings));
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

  for (const [a, b] of findOverlaps(items, settings)) {
    issues.push({ severity: 'error', itemIds: [a, b], message: `${label(a)} overlaps ${label(b)}.` });
  }
  for (const id of itemsOutsideUsable(items, settings)) {
    issues.push({ severity: 'error', itemIds: [id], message: `${label(id)} is outside the usable area.` });
  }
  items.forEach((item, idx) => {
    const h = rects[idx].height;
    if (h > settings.box.height + EPS) {
      issues.push({
        severity: 'error',
        itemIds: [item.id],
        message: `${label(item.id)} is too tall (${fmt(h)} mm > box ${fmt(settings.box.height)} mm).`,
      });
    }
  });

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

/** Ids of items involved in any error-level issue. */
export function errorItemIds(summary: LayoutSummary): Set<string> {
  const s = new Set<string>();
  for (const i of summary.issues) if (i.severity === 'error') i.itemIds.forEach((id) => s.add(id));
  return s;
}
