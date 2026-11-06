import type { BoxTypeDefinition, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid } from '../../geometry/types';
import {
  cardDims,
  cardParams,
  EPS,
  MIN_RECESS_WALL,
  num,
  requirePositive,
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
    gapReach: num(item, 'gapReach', 10),
    gapSides: str<GapSides>(item, 'gapSides', GAP_SIDES, 'sides'),
  };
}

/** How far the cavity floor is raised above the groove floor: the groove depth, 0 without gaps. */
function raisedBy(g: ReturnType<typeof geom>): number {
  return g.gapWidth > 0 ? Math.max(0, g.gapFloorDepth) : 0;
}

/**
 * Thickness of the slab under the groove (groove bottom height above the
 * outer bottom): the structural `floor`, but with a recessed base at least
 * the recess depth plus MIN_RECESS_WALL, so the recess ring (cut from the
 * outer bottom edge, up to `recessDepth`) never meets the gap / groove under
 * the outer wall and leaves a slit through the outside skin. Only applies when
 * the floor is raised at all (gaps on).
 */
function grooveFloorOf(item: ResolvedItem, g: ReturnType<typeof geom>): number {
  if (g.gapWidth <= 0) return item.floor;
  const st = stacking(item);
  return st.recessDepth > 0 ? Math.max(item.floor, st.recessDepth + MIN_RECESS_WALL) : item.floor;
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

/** Reach of the floor groove into the cell on `side`, clamped to the cell's inner span. */
function reachOf(f: CellFrame, side: Side, reach: number): number {
  return Math.max(0, Math.min(reach, side === 'left' || side === 'right' ? f.width : f.depth));
}

/**
 * XY rects of the floor groove inside the cavities next to the gap on `side`:
 * the own cell always, plus the neighbouring cell on a shared divider (right /
 * back sides; the neighbour's left / front sides are never cut themselves).
 */
function grooveRects(f: CellFrame, side: Side, width: number, reach: number) {
  const r = reachOf(f, side, reach);
  if (r <= 0) return [];
  const t = f.sides[side];
  const cx = f.x + f.width / 2;
  const cy = f.y + f.depth / 2;
  const shared = !f.outer[side] && (side === 'right' || side === 'back');
  switch (side) {
    case 'left':
      return [{ x: f.x, y: cy - width / 2, w: r, h: width }];
    case 'right': {
      const out = [{ x: f.x + f.width - r, y: cy - width / 2, w: r, h: width }];
      if (shared) out.push({ x: f.x + f.width + t, y: cy - width / 2, w: r, h: width });
      return out;
    }
    case 'front':
      return [{ x: cx - width / 2, y: f.y, w: width, h: r }];
    case 'back': {
      const out = [{ x: cx - width / 2, y: f.y + f.depth - r, w: width, h: r }];
      if (shared) out.push({ x: cx - width / 2, y: f.y + f.depth + t, w: width, h: r });
      return out;
    }
  }
}

/**
 * Finger gap cutter: a plain rectangular slot through the wall thickness,
 * from above the wall top (and lip) down to `floorDepth` below the cavity
 * floor, so it continues into the floor as a groove of the same width. The
 * cavity floor is raised by exactly `floorDepth` above the groove floor
 * (see `spec`), so the groove bottom is the groove floor top and the
 * groove never breaks through. The groove runs under the wall and `reach` mm
 * into the cavity (both cavities on a shared divider, each clamped to the
 * cell span), so a fingertip gets under the edge of the last card. It
 * overshoots by EPS only through an outer face.
 */
function gapCutter(kernel: GeometryKernel, f: CellFrame, side: Side, width: number, floorDepth: number, reach: number): Solid {
  const r = gapRect(f, side, width);
  const z0 = f.floorZ - Math.max(0, floorDepth);
  const h = f.topZ + f.lipH + EPS - z0;
  const out = f.outer[side] ? EPS : 0;
  const rc = reachOf(f, side, reach);
  const shared = !f.outer[side] && (side === 'right' || side === 'back');
  const far = shared ? rc : 0;
  switch (side) {
    case 'left':
      return kernel.box(r.w + out + rc, r.h, h, [r.x - out, r.y, z0]);
    case 'right':
      return kernel.box(rc + r.w + out + far, r.h, h, [r.x - rc, r.y, z0]);
    case 'front':
      return kernel.box(r.w, r.h + out + rc, h, [r.x, r.y - out, z0]);
    case 'back':
      return kernel.box(r.w, rc + r.h + out + far, h, [r.x, r.y - rc, z0]);
  }
}

/**
 * Tiling spec: one cell holds a face‑up card stack, cardWidth + 2c (X) ×
 * cardHeight + 2c (Y) × stackHeight (Z), repeated along X (columns).
 *
 * The floor slab is `grooveFloor + gapFloorDepth` thick: the cavity floor sits
 * at plugH + grooveFloor + gapFloorDepth and the finger-gap groove is cut from
 * there down to the groove floor, leaving `grooveFloor` mm under it.
 * grooveFloor is `floor`, or with a recessed base max(floor, recessDepth +
 * MIN_RECESS_WALL) so material remains above the recess under the gap.
 * Passing the thicker slab as the spec's floor makes the frames, outer block,
 * bearing areas and base features follow; outer height = plugH + grooveFloor +
 * gapFloorDepth + stackHeight + lipH. Without gaps (gapWidth 0) the floor is
 * not raised.
 */
function spec(item: ResolvedItem): TiledBoxSpec {
  const g = geom(item);
  const hasGaps = g.gapWidth > 0;
  return {
    ...tilingOf(item, 'x'),
    cell: { width: g.width, depth: g.depth, height: g.height },
    wall: item.wall,
    floor: grooveFloorOf(item, g) + raisedBy(g),
    stacking: stacking(item),
    cellCutters(kernel, f) {
      const out: Solid[] = [kernel.box(f.width, f.depth, f.height + f.lipH + EPS, [f.x, f.y, f.floorZ])];
      if (hasGaps) for (const side of gapSidesOf(f, g.gapSides)) out.push(gapCutter(kernel, f, side, g.gapWidth, g.gapFloorDepth, g.gapReach));
      return out;
    },
    cellDraw(f) {
      const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
      if (hasGaps) {
        for (const side of gapSidesOf(f, g.gapSides)) {
          out.push({ kind: 'rect', role: 'notch', ...gapRect(f, side, g.gapWidth) });
          for (const gr of grooveRects(f, side, g.gapWidth, g.gapReach)) out.push({ kind: 'rect', role: 'notch', ...gr });
        }
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
      help: 'How far the gap continues into the floor (under the wall) so a finger gets under the last card. The floor is raised by this much so the groove never breaks through; with a recessed base the slab under the groove is also at least the recess depth + 0.4 mm, so the recess never meets the gap.',
    },
    {
      key: 'gapReach',
      label: 'Gap reach into floor',
      kind: 'number',
      default: 10,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Finger gaps',
      help: 'How far the floor groove continues under the cards, from the wall into the cavity.',
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
    if (g.gapReach < 0) problems.push(`Gap reach must not be negative (is ${g.gapReach}).`);
    if (g.gapWidth > 0) {
      if (g.gapSides !== 'ends' && g.gapWidth >= g.depth) {
        problems.push(`Gap width (${g.gapWidth} mm) must be smaller than the side wall it is cut from (${round(g.depth)} mm).`);
      }
      if (g.gapSides !== 'sides' && g.gapWidth >= g.width) {
        problems.push(`Gap width (${g.gapWidth} mm) must be smaller than the end wall it is cut from (${round(g.width)} mm).`);
      }
    }
    const s = spec(item);
    // The framework checks the whole slab (floor + groove depth); the structural floor under the groove must exist too.
    if (s.floor > 0) requirePositive(problems, 'Floor thickness', item.floor);
    tiledValidate(problems, s);
    return problems;
  },

  stackEngagement,
  bearingAreas: (item) => tiledBearingAreas(spec(item)),
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),
};
