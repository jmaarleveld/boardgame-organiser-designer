import type { BoxTypeDefinition, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid } from '../../geometry/types';
import {
  cardDims,
  cardParams,
  EPS,
  num,
  round,
  stackEngagement,
  stacking,
  stackingNewItemParams,
  stackingParams,
  str,
  validateCards,
} from './common';
import {
  tiledBaseFeatures,
  tiledBearingAreas,
  tiledBuild,
  tiledDraw,
  tiledFootprint,
  tiledValidate,
  tilingOf,
  tilingParams,
  type CellFrame,
  type TiledBoxSpec,
} from './tiling';

const GAP_SIDES = ['sides', 'ends', 'both'] as const;
type GapSides = (typeof GAP_SIDES)[number];

function geom(item: ResolvedItem) {
  const cards = cardDims(item);
  const c = cards.clearance;
  return {
    cards,
    width: cards.cardWidth + 2 * c,
    depth: cards.cardHeight + 2 * c,
    height: cards.stackHeight,
    gapWidth: num(item, 'gapWidth', 25),
    gapFloorDepth: num(item, 'gapFloorDepth', 2),
    gapSides: str<GapSides>(item, 'gapSides', GAP_SIDES, 'sides'),
  };
}

type Side = 'left' | 'right' | 'front' | 'back';

/**
 * The cell sides that get a finger gap from this cell. `sides` = the walls
 * parallel to Y (left / right, at the cards' long edges), `ends` = the walls
 * parallel to X (front / back). A shared divider is cut by one cell only:
 * the left and front sides only when they are outer walls, the right and
 * back sides always (they are either outer or the next cell's left / front).
 */
function gapSidesOf(f: CellFrame, sides: GapSides): Side[] {
  const out: Side[] = [];
  if (sides !== 'ends') {
    if (f.outer.left) out.push('left');
    out.push('right');
  }
  if (sides !== 'sides') {
    if (f.outer.front) out.push('front');
    out.push('back');
  }
  return out;
}

/**
 * Footprint (XY rect) of the gap through the wall / divider on `side`,
 * `width` wide centred on the cell, exactly the wall thickness (sides[side]).
 */
function gapRect(f: CellFrame, side: Side, width: number) {
  const t = f.sides[side];
  const cx = f.x + f.width / 2;
  const cy = f.y + f.depth / 2;
  switch (side) {
    case 'left':
      return { x: f.x - t, y: cy - width / 2, w: t, h: width };
    case 'right':
      return { x: f.x + f.width, y: cy - width / 2, w: t, h: width };
    case 'front':
      return { x: cx - width / 2, y: f.y - t, w: width, h: t };
    case 'back':
      return { x: cx - width / 2, y: f.y + f.depth, w: width, h: t };
  }
}

/**
 * Finger gap cutter: a plain rectangular slot through the wall thickness,
 * from above the wall top (and lip) down to `floorDepth` below the cavity
 * floor, so it continues into the floor as a groove of the same width under
 * the wall. Deeper than the floor it simply goes through. It overshoots by
 * EPS only through an outer face; towards a cavity (and on both faces of a
 * divider) it stops flush, so the groove does not nick the cavity floor.
 */
function gapCutter(kernel: GeometryKernel, f: CellFrame, side: Side, width: number, floorDepth: number): Solid {
  const r = gapRect(f, side, width);
  const z0 = f.floorZ - Math.max(0, floorDepth);
  const h = f.topZ + f.lipH + EPS - z0;
  const out = f.outer[side] ? EPS : 0;
  switch (side) {
    case 'left':
      return kernel.box(r.w + out, r.h, h, [r.x - out, r.y, z0]);
    case 'right':
      return kernel.box(r.w + out, r.h, h, [r.x, r.y, z0]);
    case 'front':
      return kernel.box(r.w, r.h + out, h, [r.x, r.y - out, z0]);
    case 'back':
      return kernel.box(r.w, r.h + out, h, [r.x, r.y, z0]);
  }
}

/**
 * Tiling spec: one cell holds a face‑up card stack, cardWidth + 2c (X) ×
 * cardHeight + 2c (Y) × stackHeight (Z), repeated along X (columns).
 */
function spec(item: ResolvedItem): TiledBoxSpec {
  const g = geom(item);
  const hasGaps = g.gapWidth > 0;
  return {
    ...tilingOf(item, 'x'),
    cell: { width: g.width, depth: g.depth, height: g.height },
    wall: item.wall,
    floor: item.floor,
    stacking: stacking(item),
    cellCutters(kernel, f) {
      const out: Solid[] = [kernel.box(f.width, f.depth, f.height + f.lipH + EPS, [f.x, f.y, f.floorZ])];
      if (hasGaps) for (const side of gapSidesOf(f, g.gapSides)) out.push(gapCutter(kernel, f, side, g.gapWidth, g.gapFloorDepth));
      return out;
    },
    cellDraw(f) {
      const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
      if (hasGaps) {
        for (const side of gapSidesOf(f, g.gapSides)) out.push({ kind: 'rect', role: 'notch', ...gapRect(f, side, g.gapWidth) });
      }
      return out;
    },
  };
}

export const cardTrayFlat: BoxTypeDefinition = {
  id: 'card-tray-flat',
  name: 'Card tray (flat)',
  description: 'Card stacks lying face up side by side, with finger gaps down to the floor.',
  params: [
    ...cardParams,
    ...tilingParams('x'),
    {
      key: 'gapWidth',
      label: 'Gap width',
      kind: 'number',
      default: 25,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Finger gaps',
      help: 'Width of the slot through the wall; 0 = no finger gaps.',
    },
    {
      key: 'gapFloorDepth',
      label: 'Groove depth',
      kind: 'number',
      default: 2,
      min: 0,
      step: 0.1,
      unit: 'mm',
      group: 'Finger gaps',
      help: 'How far the gap continues into the floor (under the wall) so a finger gets under the last card. Deeper than the floor cuts through it.',
    },
    {
      key: 'gapSides',
      label: 'Gap walls',
      kind: 'select',
      default: 'sides',
      options: [
        { value: 'sides', label: 'Sides (long card edges)' },
        { value: 'ends', label: 'Ends (short card edges)' },
        { value: 'both', label: 'Both' },
      ],
      group: 'Finger gaps',
    },
    ...stackingParams,
  ],
  newItemParams: { ...stackingNewItemParams },

  footprint: (item) => tiledFootprint(spec(item)),
  build: (item, kernel) => tiledBuild(kernel, spec(item)),
  draw: (item) => tiledDraw(spec(item)),

  validate(item) {
    const g = geom(item);
    const problems: string[] = [];
    validateCards(problems, g.cards);
    if (g.gapWidth < 0) problems.push(`Gap width must not be negative (is ${g.gapWidth}).`);
    if (g.gapFloorDepth < 0) problems.push(`Groove depth must not be negative (is ${g.gapFloorDepth}).`);
    if (g.gapWidth > 0) {
      if (g.gapSides !== 'ends' && g.gapWidth >= g.depth) {
        problems.push(`Gap width (${g.gapWidth} mm) must be smaller than the side wall it is cut from (${round(g.depth)} mm).`);
      }
      if (g.gapSides !== 'sides' && g.gapWidth >= g.width) {
        problems.push(`Gap width (${g.gapWidth} mm) must be smaller than the end wall it is cut from (${round(g.width)} mm).`);
      }
    }
    tiledValidate(problems, spec(item));
    return problems;
  },

  stackEngagement,
  bearingAreas: (item) => tiledBearingAreas(spec(item)),
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),
};
