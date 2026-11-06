/**
 * Pure drag maths shared by the 2D top view and the 3D editor: where a dragged
 * item goes for a pointer position (grab offset, snapping, clamping), the
 * live distance labels, and the arrow‑key nudge direction.
 */
import type { PlacedItem, ProjectSettings } from './types';
import type { ItemRect, Rect, SnapGuide } from './layout';
import { EPS, carriedItemIds, safeItemRect, snapPosition, usableArea } from './layout';

export interface DragSession {
  id: string;
  /** Move the stack on the item along (false: Alt held at drag start). */
  carry: boolean;
  /** Item position (top‑left of its footprint) when the drag started. */
  itemStart: { x: number; y: number };
  /** Game‑frame x/y of the grab point (pointer at drag start). */
  grab: { x: number; y: number };
  size: { width: number; depth: number };
  /** Ids that move with the drag (the item, plus its stack when carrying). */
  movingIds: string[];
  /** Footprints of everything that stays put (snap targets). */
  others: Rect[];
}

/** Start a drag of item `id`, grabbed at game‑frame point `grab`. Null if the item does not exist. */
export function startDragSession(
  items: readonly PlacedItem[],
  settings: ProjectSettings,
  id: string,
  grab: { x: number; y: number },
  carry: boolean,
): DragSession | null {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  const list = items as PlacedItem[];
  const r = safeItemRect(item, settings, items);
  const moving = new Set(carry ? carriedItemIds(list, settings, id) : [id]);
  return {
    id,
    carry,
    itemStart: { x: item.x, y: item.y },
    grab: { x: grab.x, y: grab.y },
    size: { width: r.width, depth: r.depth },
    movingIds: [...moving],
    others: items.filter((i) => !moving.has(i.id)).map((i) => safeItemRect(i, settings, items)),
  };
}

export interface DragStep {
  x: number;
  y: number;
  guides: SnapGuide[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Target position of the dragged item for pointer `pointer` (game frame, on
 * the grab plane): keeps the grab offset, snaps (unless `snap` is false) to
 * the usable area, the other items' edges and the grid within `threshold` mm,
 * rounds unsnapped axes to 0.1 mm and keeps at least half the item inside the
 * game box.
 */
export function dragStep(
  s: DragSession,
  pointer: { x: number; y: number },
  settings: ProjectSettings,
  opts: { snap: boolean; threshold: number },
): DragStep {
  const proposed = { x: s.itemStart.x + pointer.x - s.grab.x, y: s.itemStart.y + pointer.y - s.grab.y };
  let x: number;
  let y: number;
  let guides: SnapGuide[] = [];
  if (!opts.snap) {
    x = r1(proposed.x);
    y = r1(proposed.y);
  } else {
    const sn = snapPosition(s.size, proposed, s.others, usableArea(settings), settings.gridSnap, opts.threshold);
    x = sn.snapX ? sn.x : r1(sn.x);
    y = sn.snapY ? sn.y : r1(sn.y);
    guides = sn.guides;
  }
  x = Math.min(Math.max(x, -s.size.width / 2), settings.box.width - s.size.width / 2);
  y = Math.min(Math.max(y, -s.size.depth / 2), settings.box.depth - s.size.depth / 2);
  return { x, y, guides };
}

/** Delta (rounded to µm) that moves `item` to `target`. */
export function dragDelta(item: { x: number; y: number }, target: { x: number; y: number }): { dx: number; dy: number } {
  return {
    dx: Math.round((target.x - item.x) * 1000) / 1000,
    dy: Math.round((target.y - item.y) * 1000) / 1000,
  };
}

/* ------------------------------------------------------------ drag plane */

type V3 = readonly [number, number, number];

/**
 * Which plane the pointer is projected onto during a 3D drag. 'horizontal':
 * the plane z = grab height (normal case). 'vertical': the upright plane
 * through the grab point facing the camera — used when the view is nearly
 * horizontal (Front / Side presets), where the horizontal plane is seen
 * edge‑on and its intersection would shoot off to infinity.
 */
export type DragPlane = 'horizontal' | 'vertical';

/** Minimum |dir.z| / |dir| of the initial pick ray for a horizontal drag plane (≈ 11.5°). */
export const MIN_PLANE_SLOPE = 0.2;

export function chooseDragPlane(dir: V3): DragPlane {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  return len > 0 && Math.abs(dir[2]) / len >= MIN_PLANE_SLOPE ? 'horizontal' : 'vertical';
}

/**
 * Game‑frame x/y where the ray `origin + t·dir` (t ≥ 0) meets the drag plane
 * through `grab`; null when it misses (parallel or behind the camera).
 */
export function dragPlanePoint(
  plane: DragPlane,
  origin: V3,
  dir: V3,
  grab: { x: number; y: number; z: number },
): { x: number; y: number } | null {
  let t: number;
  if (plane === 'horizontal') {
    if (Math.abs(dir[2]) < 1e-9) return null;
    t = (grab.z - origin[2]) / dir[2];
  } else {
    // Normal = the ray's horizontal direction.
    const denom = dir[0] * dir[0] + dir[1] * dir[1];
    if (denom < 1e-12) return null;
    t = (dir[0] * (grab.x - origin[0]) + dir[1] * (grab.y - origin[1])) / denom;
  }
  if (!(t >= 0) || !Number.isFinite(t)) return null;
  return { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t };
}

/* ---------------------------------------------------------- distance labels */

/** Side of the dragged footprint: 'x-' = toward x = 0, 'y+' = toward larger y, … */
export type GapSide = 'x-' | 'x+' | 'y-' | 'y+';

export interface GapLabel {
  side: GapSide;
  /** Gap in mm (negative when the item sticks out past a wall). */
  distance: number;
  /** Dimension line from the item's edge … */
  from: { x: number; y: number };
  /** … to the neighbour's edge or the usable‑area wall. */
  to: { x: number; y: number };
  kind: 'wall' | 'item';
}

/**
 * Distances from the footprint `r` to the nearest neighbour edge (or the
 * usable‑area wall when nothing is in between) on each of its four sides.
 * Neighbours count when they overlap `r` in the perpendicular axis and in
 * height (`z`…`top`), and lie entirely on that side of it.
 */
export function gapLabels(r: ItemRect, others: readonly ItemRect[], usable: Rect): GapLabel[] {
  const vertical = (o: ItemRect) => o.z < r.top - EPS && o.top > r.z + EPS;
  const spanY = (o: Rect) => o.y < r.y + r.depth - EPS && o.y + o.depth > r.y + EPS;
  const spanX = (o: Rect) => o.x < r.x + r.width - EPS && o.x + o.width > r.x + EPS;
  const mid = (a0: number, a1: number, b0: number, b1: number) => (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
  const cy = r.y + r.depth / 2;
  const cx = r.x + r.width / 2;
  const out: GapLabel[] = [];

  // x‑: nearest right edge at or left of r.x
  {
    let best: { pos: number; at: number; kind: GapLabel['kind'] } = { pos: usable.x, at: cy, kind: 'wall' };
    for (const o of others) {
      const e = o.x + o.width;
      if (!vertical(o) || !spanY(o) || e > r.x + EPS || e <= best.pos) continue;
      best = { pos: e, at: mid(r.y, r.y + r.depth, o.y, o.y + o.depth), kind: 'item' };
    }
    out.push({ side: 'x-', distance: r.x - best.pos, from: { x: r.x, y: best.at }, to: { x: best.pos, y: best.at }, kind: best.kind });
  }
  // x+
  {
    const edge = r.x + r.width;
    let best: { pos: number; at: number; kind: GapLabel['kind'] } = { pos: usable.x + usable.width, at: cy, kind: 'wall' };
    for (const o of others) {
      if (!vertical(o) || !spanY(o) || o.x < edge - EPS || o.x >= best.pos) continue;
      best = { pos: o.x, at: mid(r.y, r.y + r.depth, o.y, o.y + o.depth), kind: 'item' };
    }
    out.push({ side: 'x+', distance: best.pos - edge, from: { x: edge, y: best.at }, to: { x: best.pos, y: best.at }, kind: best.kind });
  }
  // y‑
  {
    let best: { pos: number; at: number; kind: GapLabel['kind'] } = { pos: usable.y, at: cx, kind: 'wall' };
    for (const o of others) {
      const e = o.y + o.depth;
      if (!vertical(o) || !spanX(o) || e > r.y + EPS || e <= best.pos) continue;
      best = { pos: e, at: mid(r.x, r.x + r.width, o.x, o.x + o.width), kind: 'item' };
    }
    out.push({ side: 'y-', distance: r.y - best.pos, from: { x: best.at, y: r.y }, to: { x: best.at, y: best.pos }, kind: best.kind });
  }
  // y+
  {
    const edge = r.y + r.depth;
    let best: { pos: number; at: number; kind: GapLabel['kind'] } = { pos: usable.y + usable.depth, at: cx, kind: 'wall' };
    for (const o of others) {
      if (!vertical(o) || !spanX(o) || o.y < edge - EPS || o.y >= best.pos) continue;
      best = { pos: o.y, at: mid(r.x, r.x + r.width, o.x, o.x + o.width), kind: 'item' };
    }
    out.push({ side: 'y+', distance: best.pos - edge, from: { x: best.at, y: edge }, to: { x: best.at, y: best.pos }, kind: best.kind });
  }
  return out;
}

/* ------------------------------------------------------------------- nudge */

/**
 * Game‑frame delta for an arrow key. `screenYUp`: the view shows y growing up
 * the screen (the 3D editor), so ArrowUp increases y; otherwise (2D top view,
 * y down) ArrowUp decreases it. Null for other keys.
 */
export function nudgeDelta(key: string, step: number, screenYUp: boolean): { dx: number; dy: number } | null {
  const up = screenYUp ? step : -step;
  switch (key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: up };
    case 'ArrowDown':
      return { dx: 0, dy: -up };
    default:
      return null;
  }
}
