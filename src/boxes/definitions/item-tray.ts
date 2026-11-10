import type { BoxTypeDefinition } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid, Vec2 } from '../../geometry/types';
import {
  EPS,
  num,
  requirePositive,
  roundEdit,
  stackEngagement,
  stacking,
  stackingFlatBase,
  stackingFlatTop,
  stackingNewItemParams,
  stackingParams,
  str,
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

const FLOOR_SHAPES = ['flat', 'cove', 'ramp'] as const;
type FloorShape = (typeof FLOOR_SHAPES)[number];
const COVE_SIDES = ['all', 'long', 'short'] as const;
type CoveSides = (typeof COVE_SIDES)[number];
const RAMP_WALLS = ['front', 'back', 'left', 'right', 'front-back', 'left-right'] as const;
type RampWall = (typeof RAMP_WALLS)[number];

/** Max length of one arc segment of a curved floor (mm). */
const ARC_STEP = 0.5;

/**
 * Which pair of opposite walls `long` / `short` means. `long`: the two walls
 * along the longer inner side (for a cell wider than deep, the walls parallel
 * to X at the front and back); `short`: the other two. Returns the direction
 * those walls run along ('x' = walls parallel to X) and the inner span across
 * them.
 */
function wallPair(width: number, depth: number, sides: 'long' | 'short'): { axis: 'x' | 'y'; span: number } {
  const longAlongX = width >= depth;
  const alongX = sides === 'long' ? longAlongX : !longAlongX;
  return alongX ? { axis: 'x', span: depth } : { axis: 'y', span: width };
}

/**
 * The ramp walls as an axis plus the sides of the span that rise: axis 'x' =
 * walls parallel to X (front −Y / back +Y, span = depth), 'y' = left −X /
 * right +X (span = width). `low` = the −Y / −X wall, `high` = the +Y / +X wall.
 */
function rampWalls(wall: RampWall): { axis: 'x' | 'y'; low: boolean; high: boolean } {
  switch (wall) {
    case 'front': return { axis: 'x', low: true, high: false };
    case 'back': return { axis: 'x', low: false, high: true };
    case 'front-back': return { axis: 'x', low: true, high: true };
    case 'left': return { axis: 'y', low: true, high: false };
    case 'right': return { axis: 'y', low: false, high: true };
    case 'left-right': return { axis: 'y', low: true, high: true };
  }
}

/**
 * Radius of the circle that touches the floor (tangent) at distance `L` from
 * a wall and passes through height `h` at the wall: R = (L² + h²) / (2h).
 * Needs 0 < h ≤ L (h = L: a quarter circle, vertical at the wall).
 */
export function rampRadius(L: number, h: number): number {
  return (L * L + h * h) / (2 * h);
}

function geom(item: ResolvedItem) {
  const floorShape = str<FloorShape>(item, 'floorShape', FLOOR_SHAPES, 'flat');
  const width = num(item, 'innerWidth');
  const depth = num(item, 'innerDepth');
  const height = num(item, 'innerHeight');
  // Cove.
  const coveSides = str<CoveSides>(item, 'coveSides', COVE_SIDES, 'all');
  const coveRadius = num(item, 'coveRadius', 8);
  const cove =
    coveSides === 'all'
      ? { axis: null, span: Math.min(width, depth), spanLabel: width <= depth ? 'cell width' : 'cell depth' }
      : (() => {
          const p = wallPair(width, depth, coveSides);
          return { ...p, spanLabel: p.axis === 'x' ? 'cell depth' : 'cell width' };
        })();
  // Ramp.
  const rampWall = str<RampWall>(item, 'rampWall', RAMP_WALLS, 'front');
  const ramp = rampWalls(rampWall);
  const rampSpan = ramp.axis === 'x' ? depth : width;
  const twoSided = ramp.low && ramp.high;
  const rampLengthRaw = num(item, 'rampLength', 0);
  const rampHeightRaw = num(item, 'rampHeight', 0);
  // 0 = automatic: half the span (one wall) or 40 % of it (two walls); ¾ of the inner height, at most the length.
  const rampLength = rampLengthRaw === 0 ? (twoSided ? 0.4 : 0.5) * rampSpan : rampLengthRaw;
  const rampHeight = rampHeightRaw === 0 ? Math.min(0.75 * height, rampLength) : rampHeightRaw;
  return {
    floorShape, width, depth, height,
    coveSides, coveRadius, cove,
    rampWall, ramp, rampSpan, twoSided, rampLengthRaw, rampHeightRaw, rampLength, rampHeight,
  };
}
type Geom = ReturnType<typeof geom>;

/**
 * Bottom of a floor profile rising at one wall: the circular arc (radius
 * `rampRadius(L, h)`) from height h at the wall (d = 0) down to the floor,
 * where it is tangent, at distance L. Points as (distance from the wall,
 * height), ordered from the wall outward, sampled by angle every ≤ ARC_STEP.
 */
function arcFromWall(L: number, h: number): Vec2[] {
  const R = rampRadius(L, h);
  const theta = Math.asin(Math.min(1, L / R));
  const n = Math.max(16, Math.ceil((R * theta) / ARC_STEP));
  const pts: Vec2[] = [];
  for (let i = n; i >= 0; i--) {
    const a = (theta * i) / n;
    pts.push([L - R * Math.sin(a), R * (1 - Math.cos(a))]);
  }
  pts[0] = [0, h]; // exact end at the wall
  return pts;
}

interface Rise {
  L: number;
  h: number;
}

/**
 * Cavity of one cell whose floor rises at one or both walls running along
 * `axis` ('x' = walls parallel to X, the profile spans the cell depth).
 * `low` rises at the −Y / −X wall, `high` at the +Y / +X wall. The cross
 * section is the floor profile, then straight up through the lip; it is
 * extruded along the walls over [start, start + len] of the cell length.
 */
function risingCavity(
  kernel: GeometryKernel,
  f: CellFrame,
  axis: 'x' | 'y',
  low: Rise | null,
  high: Rise | null,
  start = 0,
  len = axis === 'x' ? f.width : f.depth,
): Solid {
  const span = axis === 'x' ? f.depth : f.width;
  const bottom: Vec2[] = [];
  if (low) bottom.push(...arcFromWall(low.L, low.h));
  else bottom.push([0, 0]);
  if (high) bottom.push(...arcFromWall(high.L, high.h).reverse().map(([d, z]): Vec2 => [span - d, z]));
  else bottom.push([span, 0]);
  const profile: Vec2[] = [];
  for (const p of bottom) {
    const q = profile[profile.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) profile.push(p);
  }
  const top = f.height + f.lipH + EPS;
  profile.push([span, top], [0, top]);
  const prism = kernel.extrude(profile, len); // local: u across, v up, extrusion along the walls
  if (axis === 'x') {
    // local (u, v, t) → (t, u, v)
    return kernel.translate(kernel.rotate(prism, [90, 0, 90]), [f.x + start, f.y, f.floorZ]);
  }
  // local (u, v, t) → (u, −t, v)
  return kernel.translate(kernel.rotate(prism, [90, 0, 0]), [f.x, f.y + start + len, f.floorZ]);
}

/**
 * Cavity of a cell with a cove on all four walls: the intersection of the
 * coved profile across Y (front and back walls, extruded along X) and the
 * coved profile across X (left and right walls, extruded along Y). Along each
 * wall the floor meets the wall in a quarter circle of radius r, tangent to
 * both. The walls keep their square vertical corners, so in each corner the
 * two coves meet like a groin vault: the floor there is the higher of the two
 * arcs, a shallow valley along the diagonal from the corner (height r) to
 * (r, r) on the floor. No ledge anywhere, and only one boolean.
 *
 * (A ball in the corner would only blend smoothly with rounded vertical
 * corners: with square ones it leaves a flat shelf at height r.)
 */
function coveAllCavity(kernel: GeometryKernel, f: CellFrame, r: number): Solid {
  const rise: Rise = { L: r, h: r };
  return kernel.intersection([risingCavity(kernel, f, 'x', rise, rise), risingCavity(kernel, f, 'y', rise, rise)]);
}

/** The cell cutter for the item's floor shape, with sizes clamped to what can be built (validate reports the rest). */
function cellCavity(kernel: GeometryKernel, f: CellFrame, g: Geom): Solid {
  const flat = () => kernel.box(f.width, f.depth, f.height + f.lipH + EPS, [f.x, f.y, f.floorZ]);
  if (g.floorShape === 'cove') {
    const r = Math.min(g.coveRadius, f.height, g.cove.span / 2 - EPS);
    if (!(r > 0)) return flat();
    if (g.cove.axis === null) return coveAllCavity(kernel, f, r);
    return risingCavity(kernel, f, g.cove.axis, { L: r, h: r }, { L: r, h: r });
  }
  if (g.floorShape === 'ramp') {
    const L = Math.min(g.rampLength, g.twoSided ? g.rampSpan / 2 : g.rampSpan);
    const h = Math.min(g.rampHeight, f.height, L);
    if (!(L > 0 && h > 0)) return flat();
    const rise: Rise = { L, h };
    return risingCavity(kernel, f, g.ramp.axis, g.ramp.low ? rise : null, g.ramp.high ? rise : null);
  }
  return flat();
}

/**
 * Tiling spec of an item tray: one cell = innerWidth × innerDepth ×
 * innerHeight, repeated columns × rows. Dividers are always full height. The
 * cell cutter is the cavity box (through the lip), or the coved / ramped
 * cavity. No finger notches: the curved floor is the access feature.
 */
function spec(item: ResolvedItem): TiledBoxSpec {
  const g = geom(item);
  const t = tilingOf(item, 'xy');
  // All cells have the same cavity: build it once (at x = y = 0) and translate the copies.
  const cache = new Map<string, Solid>();
  return {
    ...t,
    cell: { width: g.width, depth: g.depth, height: g.height },
    wall: item.wall,
    floor: item.floor,
    stacking: stacking(item),
    cellCutters(kernel, f) {
      const key = `${f.floorZ}|${f.lipH}`;
      let c = cache.get(key);
      if (!c) cache.set(key, (c = cellCavity(kernel, { ...f, x: 0, y: 0 }, g)));
      return [kernel.translate(c, [f.x, f.y, 0])];
    },
    cellDraw(f) {
      return [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
    },
  };
}

const RAMP_WALL_LABELS: Record<RampWall, string> = {
  front: 'Front wall (−Y)',
  back: 'Back wall (+Y)',
  left: 'Left wall (−X)',
  right: 'Right wall (+X)',
  'front-back': 'Front and back walls',
  'left-right': 'Left and right walls',
};

export const itemTray: BoxTypeDefinition = {
  id: 'item-tray',
  name: 'Item tray',
  description: 'Small tray for tokens and bits: a grid of equal cells with a flat, coved or ramped floor.',
  params: [
    { key: 'innerWidth', label: 'Cell width', kind: 'number', default: 40, min: 1, step: 0.5, unit: 'mm', group: 'Size',
      help: 'Inner width of one cell.' },
    { key: 'innerDepth', label: 'Cell depth', kind: 'number', default: 30, min: 1, step: 0.5, unit: 'mm', group: 'Size',
      help: 'Inner depth of one cell.' },
    { key: 'innerHeight', label: 'Inner height', kind: 'number', default: 20, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    ...tilingParams('xy'),
    {
      key: 'floorShape',
      label: 'Floor',
      kind: 'select',
      default: 'flat',
      options: [
        { value: 'flat', label: 'Flat' },
        { value: 'cove', label: 'Cove (rounded where the floor meets the walls)' },
        { value: 'ramp', label: 'Ramp (curves up one or two walls)' },
      ],
      group: 'Floor',
    },
    {
      key: 'coveSides',
      label: 'Cove walls',
      kind: 'select',
      default: 'all',
      options: [
        { value: 'all', label: 'All four walls' },
        { value: 'long', label: 'Long walls' },
        { value: 'short', label: 'Short walls' },
      ],
      group: 'Floor',
      help: 'Which walls of each cell get the rounded edge along the floor.',
      visibleIf: (p) => p.floorShape === 'cove',
    },
    {
      key: 'coveRadius',
      label: 'Cove radius',
      kind: 'number',
      default: 8,
      min: 1,
      step: 0.5,
      unit: 'mm',
      group: 'Floor',
      help: 'Radius of the rounding between floor and wall. Bigger is easier to scoop from.',
      visibleIf: (p) => p.floorShape === 'cove',
    },
    {
      key: 'rampWall',
      label: 'Ramp up to',
      kind: 'select',
      default: 'front',
      options: RAMP_WALLS.map((value) => ({ value, label: RAMP_WALL_LABELS[value] })),
      group: 'Floor',
      help: 'The wall (or the two opposite walls) of each cell the floor curves up to. Front faces you: slide the bits toward you and up.',
      visibleIf: (p) => p.floorShape === 'ramp',
    },
    {
      key: 'rampLength',
      label: 'Ramp length',
      kind: 'number',
      default: 0,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Floor',
      help: 'How far from the wall the curve starts on the flat floor. 0 = automatic: half the cell (one wall) or 40 % of it (two walls).',
      visibleIf: (p) => p.floorShape === 'ramp',
    },
    {
      key: 'rampHeight',
      label: 'Ramp height',
      kind: 'number',
      default: 0,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Floor',
      help: 'How high up the wall the curve ends. 0 = automatic: ¾ of the inner height, at most the ramp length.',
      visibleIf: (p) => p.floorShape === 'ramp',
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
    requirePositive(problems, 'Cell width', g.width);
    requirePositive(problems, 'Cell depth', g.depth);
    requirePositive(problems, 'Inner height', g.height);
    if (g.floorShape === 'cove') validateCove(problems, g);
    if (g.floorShape === 'ramp') validateRamp(problems, g);
    tiledValidate(problems, spec(item));
    return problems;
  },

  stackEngagement,
  bearingAreas: (item) => tiledBearingAreas(spec(item)),
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),

  flatBase: stackingFlatBase,
  flatTop: stackingFlatTop,
  /** Taller walls in both modes: the cells get deeper. */
  raise: (item, by) => ({ params: { innerHeight: roundEdit(num(item, 'innerHeight') + by) } }),
};

/** Slack for comparing derived lengths (float noise only). */
const TOL = 1e-9;
const mm = (v: number) => `${Math.round(v * 1000) / 1000} mm`;

function validateCove(problems: string[], g: Geom): void {
  const r = g.coveRadius;
  requirePositive(problems, 'Cove radius', r);
  if (!(r > 0)) return;
  if (g.cove.span > 0 && r >= g.cove.span / 2)
    problems.push(`Cove radius (${mm(r)}) must be less than half the ${g.cove.spanLabel} (${mm(g.cove.span / 2)}).`);
  if (g.height > 0 && r > g.height)
    problems.push(`Cove radius (${mm(r)}) must not be more than the inner height (${mm(g.height)}).`);
}

function validateRamp(problems: string[], g: Geom): void {
  if (g.rampLengthRaw < 0) problems.push(`Ramp length must not be negative (is ${g.rampLengthRaw}).`);
  if (g.rampHeightRaw < 0) problems.push(`Ramp height must not be negative (is ${g.rampHeightRaw}).`);
  if (g.rampLengthRaw < 0 || g.rampHeightRaw < 0 || !(g.rampSpan > 0) || !(g.height > 0)) return;
  const L = g.rampLength;
  const h = g.rampHeight;
  const spanLabel = g.ramp.axis === 'x' ? 'cell depth' : 'cell width';
  if (g.twoSided && 2 * L > g.rampSpan + TOL)
    problems.push(`Ramp length (${mm(L)}) must not be more than half the ${spanLabel} (${mm(g.rampSpan / 2)}) with ramps on two walls.`);
  if (!g.twoSided && L > g.rampSpan + TOL)
    problems.push(`Ramp length (${mm(L)}) must not be more than the ${spanLabel} (${mm(g.rampSpan)}).`);
  if (h > g.height + TOL) problems.push(`Ramp height (${mm(h)}) must not be more than the inner height (${mm(g.height)}).`);
  if (h > L + TOL)
    problems.push(`Ramp height (${mm(h)}) must not be more than the ramp length (${mm(L)}): a curve that starts flat on the floor cannot climb higher than it runs without leaning over.`);
}
