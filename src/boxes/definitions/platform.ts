import type { BoxTypeDefinition, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import { bool, EPS, num, requirePositive, round, roundEdit } from './common';

/**
 * Flat plate that bridges several trays and carries the next level.
 * Optional locating ridges (`locateItems`): for every item resting on the
 * plate (from `item.context`) whose base is a recess, a ring along that item's
 * outer footprint edge, `wall/2` (its wall) wide and its `lipHeight` high,
 * standing on the plate top and clipped to the plate — the same shape as a
 * tray's lip, so the recess drops over it. Neighbouring rings simply merge.
 * Optional corner stops: four small blocks under the plate, inset by
 * `stopInset` (≈ wall + clearance of the trays below) so they drop just inside
 * the cavities underneath and keep the plate from sliding. Local frame: the
 * stops stand on Z = 0, the plate starts at Z = stopHeight (0 without stops).
 * Wall and floor thickness are ignored.
 */
function geom(item: ResolvedItem) {
  const stops = bool(item, 'cornerStops', true);
  const stopSize = num(item, 'stopSize');
  const stopHeight = num(item, 'stopHeight');
  return {
    w: num(item, 'width'),
    d: num(item, 'depth'),
    t: num(item, 'thickness'),
    stops,
    stopSize,
    stopHeight,
    stopInset: num(item, 'stopInset'),
    /** Height of the stops actually present. */
    sh: stops ? Math.max(0, stopHeight) : 0,
    locate: bool(item, 'locateItems', true),
  };
}

/** One clipped ridge bar on the plate (local XY rect) and its height. */
interface RidgeBar {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
}

/** Ridge bars, the ids of the items they locate and the tallest ridge (0 = none). */
function ridges(item: ResolvedItem, g: ReturnType<typeof geom>): { bars: RidgeBar[]; itemIds: string[]; height: number } {
  const bars: RidgeBar[] = [];
  const itemIds: string[] = [];
  let height = 0;
  if (!g.locate || !item.context) return { bars, itemIds, height };
  const MIN = 1e-6;
  for (const a of item.context.itemsAbove) {
    const h = a.lipHeight;
    const t = a.wall / 2;
    if (a.stackBottom !== 'recess' || !(h > 0) || !(t > 0)) continue;
    const x0 = a.x;
    const y0 = a.y;
    const x1 = a.x + a.width;
    const y1 = a.y + a.depth;
    // Ring = four bars: full‑width front / back, sides in between (no overlap).
    const raw: [number, number, number, number][] = [
      [x0, y0, x1, Math.min(y1, y0 + t)],
      [x0, Math.max(y0, y1 - t), x1, y1],
      [x0, y0 + t, Math.min(x1, x0 + t), y1 - t],
      [Math.max(x0, x1 - t), y0 + t, x1, y1 - t],
    ];
    let any = false;
    for (const [bx0, by0, bx1, by1] of raw) {
      const cx0 = Math.max(0, bx0);
      const cy0 = Math.max(0, by0);
      const cx1 = Math.min(g.w, bx1);
      const cy1 = Math.min(g.d, by1);
      if (cx1 - cx0 > MIN && cy1 - cy0 > MIN) {
        bars.push({ x: cx0, y: cy0, w: cx1 - cx0, d: cy1 - cy0, h });
        any = true;
      }
    }
    if (any) {
      itemIds.push(a.id);
      height = Math.max(height, h);
    }
  }
  return { bars, itemIds, height };
}

/** Min corners (local XY) of the four stops. */
function stopCorners(g: ReturnType<typeof geom>): [number, number][] {
  const a = g.stopInset;
  const bx = g.w - g.stopInset - g.stopSize;
  const by = g.d - g.stopInset - g.stopSize;
  return [
    [a, a],
    [bx, a],
    [a, by],
    [bx, by],
  ];
}

export const platform: BoxTypeDefinition = {
  id: 'platform',
  name: 'Platform',
  description: 'Flat plate spanning several trays to carry the next level, with optional corner stops.',
  params: [
    { key: 'width', label: 'Width', kind: 'number', default: 100, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'depth', label: 'Depth', kind: 'number', default: 100, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'thickness', label: 'Thickness', kind: 'number', default: 2, min: 0.4, step: 0.1, unit: 'mm', group: 'Size' },
    {
      key: 'cornerStops',
      label: 'Corner stops',
      kind: 'boolean',
      default: true,
      group: 'Corner stops',
      help: 'Small blocks under the corners that drop just inside the cavities below.',
    },
    {
      key: 'stopSize',
      label: 'Stop size',
      kind: 'number',
      default: 6,
      min: 0.5,
      step: 0.5,
      unit: 'mm',
      group: 'Corner stops',
      visibleIf: (p) => p.cornerStops !== false,
    },
    {
      key: 'stopHeight',
      label: 'Stop height',
      kind: 'number',
      default: 2,
      min: 0.2,
      step: 0.1,
      unit: 'mm',
      group: 'Corner stops',
      visibleIf: (p) => p.cornerStops !== false,
    },
    {
      key: 'stopInset',
      label: 'Stop inset',
      kind: 'number',
      default: 1.75,
      min: 0,
      step: 0.05,
      unit: 'mm',
      group: 'Corner stops',
      help: 'Distance from the plate edge: wall + clearance of the trays below.',
      visibleIf: (p) => p.cornerStops !== false,
    },
    {
      key: 'locateItems',
      label: 'Locate items on top',
      kind: 'boolean',
      default: true,
      group: 'Locating ridges',
      help:
        'Ridges on the plate along the edges of the items resting on it whose base is a recess, so they lock in place. ' +
        'Moving or changing those items means reprinting the platform.',
    },
  ],

  footprint(item) {
    const g = geom(item);
    return { width: g.w, depth: g.d, height: g.t + g.sh + ridges(item, g).height };
  },

  build(item, kernel) {
    const g = geom(item);
    const plate = kernel.box(g.w, g.d, g.t, [0, 0, g.sh]);
    const parts = [plate];
    // Stops and ridges overlap the plate by EPS so the union is clean.
    if (g.sh > 0 && g.stopSize > 0) {
      for (const [x, y] of stopCorners(g)) parts.push(kernel.box(g.stopSize, g.stopSize, g.sh + EPS, [x, y, 0]));
    }
    const plateTop = g.sh + g.t;
    for (const b of ridges(item, g).bars) parts.push(kernel.box(b.w, b.d, b.h + EPS, [b.x, b.y, plateTop - EPS]));
    return parts.length === 1 ? plate : kernel.union(parts);
  },

  draw(item) {
    const g = geom(item);
    const out: TopViewFeature[] = [{ kind: 'rect', role: 'solid', x: 0, y: 0, w: g.w, h: g.d }];
    if (g.sh > 0 && g.stopSize > 0) {
      for (const [x, y] of stopCorners(g)) out.push({ kind: 'rect', role: 'divider', x, y, w: g.stopSize, h: g.stopSize });
    }
    for (const b of ridges(item, g).bars) out.push({ kind: 'rect', role: 'divider', x: b.x, y: b.y, w: b.w, h: b.d });
    return out;
  },

  validate(item) {
    const g = geom(item);
    const problems: string[] = [];
    requirePositive(problems, 'Width', g.w);
    requirePositive(problems, 'Depth', g.d);
    requirePositive(problems, 'Thickness', g.t);
    if (g.stops) {
      requirePositive(problems, 'Stop size', g.stopSize);
      requirePositive(problems, 'Stop height', g.stopHeight);
      if (g.stopInset < 0) problems.push(`Stop inset must not be negative (is ${g.stopInset}).`);
      const need = 2 * (g.stopInset + g.stopSize);
      if (need > Math.min(g.w, g.d)) {
        problems.push(`Corner stops (2 × (${g.stopInset} + ${g.stopSize}) = ${round(need)} mm) do not fit on the plate.`);
      }
    }
    return problems;
  },

  stackEngagement(item) {
    return geom(item).sh;
  },

  usesItemsAbove(item) {
    return geom(item).locate;
  },

  /** Items rest on the plate, between the ridges: the ridges stand above it. */
  seatDepth(item) {
    const g = geom(item);
    return ridges(item, g).height;
  },

  /** The plate is a solid top; ridges are lips that must lie under the recesses of the items they locate. */
  bearingAreas(item) {
    const g = geom(item);
    const plateTop = g.sh + g.t;
    return [
      { x: 0, y: 0, width: g.w, depth: g.d, height: plateTop, name: 'plate' },
      ...ridges(item, g).bars.map((b) => ({ x: b.x, y: b.y, width: b.w, depth: b.d, height: plateTop + b.h, role: 'lip' as const, name: 'ridge' })),
    ];
  },

  baseFeatures(item) {
    const g = geom(item);
    if (!(g.sh > 0) || !(g.stopSize > 0)) return [];
    return stopCorners(g).map(([x, y]) => ({ kind: 'protrusion' as const, x, y, width: g.stopSize, depth: g.stopSize, height: g.sh, name: 'corner stop' }));
  },

  /** On the game box floor the corner stops have nothing to drop into. */
  flatBase: (item) => (geom(item).sh > 0 ? { params: { cornerStops: false } } : null),
  /** A thicker plate. (Ridges only exist for items on top, which a raised top item has none of.) */
  raise: (item, by) => ({ params: { thickness: roundEdit(geom(item).t + by) } }),

  describeContext(item) {
    const g = geom(item);
    if (!g.locate) return null;
    const { itemIds } = ridges(item, g);
    return {
      itemIds,
      note: itemIds.length
        ? 'Locating ridges are built for these items. Moving or resizing them means reprinting the platform.'
        : 'No item with a recessed base rests on the plate, so it has no ridges.',
    };
  },
};
