import type { BoxTypeDefinition } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid, Vec2 } from '../../geometry/types';
import {
  EPS,
  num,
  requirePositive,
  stackEngagement,
  stacking,
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

const FLOOR_SHAPES = ['flat', 'scoop'] as const;
type FloorShape = (typeof FLOOR_SHAPES)[number];
const SCOOP_SIDES = ['long', 'short'] as const;
type ScoopSides = (typeof SCOOP_SIDES)[number];

/**
 * Which walls of a cell get a scoop. `long`: the two walls along the longer
 * inner side (for a cell wider than deep, the walls parallel to X at the
 * front and back of the cell); `short`: the other two. Returns the direction
 * the scooped walls run along ('x' = walls parallel to X) and the inner span
 * across them.
 */
function scoopAxis(width: number, depth: number, sides: ScoopSides): { axis: 'x' | 'y'; span: number } {
  const longAlongX = width >= depth;
  const alongX = sides === 'long' ? longAlongX : !longAlongX;
  return alongX ? { axis: 'x', span: depth } : { axis: 'y', span: width };
}

/** Radius of the circular segment spanning `w` across that rises `h` at its ends. */
export function troughRadius(w: number, h: number): number {
  return (w * w) / 4 / (2 * h) + h / 2;
}

function geom(item: ResolvedItem) {
  const floorShape = str<FloorShape>(item, 'floorShape', FLOOR_SHAPES, 'flat');
  const scoopSides = str<ScoopSides>(item, 'scoopSides', SCOOP_SIDES, 'long');
  const width = num(item, 'innerWidth');
  const depth = num(item, 'innerDepth');
  const height = num(item, 'innerHeight');
  const riseRaw = num(item, 'scoopRise', 3);
  const { axis, span } = scoopAxis(width, depth, scoopSides);
  // Rise actually built: 0 (flat) unless scoop; never above the inner height.
  const rise = floorShape === 'scoop' && riseRaw > 0 ? Math.min(riseRaw, height) : 0;
  return { floorShape, scoopSides, width, depth, height, riseRaw, rise, axis, span };
}

/**
 * Cavity of one cell with a trough floor: the cross-section across the two
 * scoop walls is bounded below by a circular arc (radius `troughRadius(span,
 * rise)`, axis parallel to the scoop walls, centred across the cell) that
 * touches floorZ in the middle and meets the walls at floorZ + rise; above
 * it the section is the full cell span up through the lip. Built as an
 * extruded profile (the arc sampled every ≤ 0.5 mm, a vertex at the lowest
 * point) rather than cylinder ∩ box: same shape, no facets outside the span.
 */
function troughCavity(kernel: GeometryKernel, f: CellFrame, axis: 'x' | 'y', rise: number): Solid {
  const span = axis === 'x' ? f.depth : f.width;
  const len = axis === 'x' ? f.width : f.depth;
  const R = troughRadius(span, rise);
  const n = 2 * Math.max(16, Math.ceil(span / 2 / 0.5)); // even: the middle is a vertex
  const profile: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const u = (span * i) / n;
    const d = u - span / 2;
    profile.push([u, R - Math.sqrt(Math.max(0, R * R - d * d))]);
  }
  const top = f.height + f.lipH + EPS;
  profile.push([span, top], [0, top]);
  const prism = kernel.extrude(profile, len); // local: u across, v up, extrusion along the trough
  if (axis === 'x') {
    // local (u, v, t) → (t, u, v)
    return kernel.translate(kernel.rotate(prism, [90, 0, 90]), [f.x, f.y, f.floorZ]);
  }
  // local (u, v, t) → (u, −t, v)
  return kernel.translate(kernel.rotate(prism, [90, 0, 0]), [f.x, f.y + len, f.floorZ]);
}

/**
 * Tiling spec of an item tray: one cell = innerWidth × innerDepth ×
 * innerHeight, repeated columns × rows. Dividers are always full height. The
 * cell cutter is the cavity box (through the lip), or for a scoop floor the
 * trough cavity. No finger notches: the trough is the access feature.
 */
function spec(item: ResolvedItem): TiledBoxSpec {
  const g = geom(item);
  const t = tilingOf(item, 'xy');
  return {
    ...t,
    cell: { width: g.width, depth: g.depth, height: g.height },
    wall: item.wall,
    floor: item.floor,
    stacking: stacking(item),
    cellCutters(kernel, f) {
      if (g.rise > 0) return [troughCavity(kernel, f, g.axis, g.rise)];
      return [kernel.box(f.width, f.depth, f.height + f.lipH + EPS, [f.x, f.y, f.floorZ])];
    },
    cellDraw(f) {
      return [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
    },
  };
}

export const itemTray: BoxTypeDefinition = {
  id: 'item-tray',
  name: 'Item tray',
  description: 'Small tray for tokens and bits: a grid of equal cells with a flat floor or a shallow trough floor.',
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
        { value: 'scoop', label: 'Scoop (shallow trough between two walls)' },
      ],
      group: 'Floor',
    },
    {
      key: 'scoopSides',
      label: 'Scoop walls',
      kind: 'select',
      default: 'long',
      options: [
        { value: 'long', label: 'Long walls' },
        { value: 'short', label: 'Short walls' },
      ],
      group: 'Floor',
      help: 'The two opposite walls of each cell the floor curves up toward.',
      visibleIf: (p) => p.floorShape === 'scoop',
    },
    {
      key: 'scoopRise',
      label: 'Rise at the walls',
      kind: 'number',
      default: 3,
      min: 0.2,
      step: 0.5,
      unit: 'mm',
      group: 'Floor',
      help: 'How much the floor curves up at the two scoop walls (lowest in the middle of the cell).',
      visibleIf: (p) => p.floorShape === 'scoop',
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
    if (g.floorShape === 'scoop') {
      requirePositive(problems, 'Rise at the walls', g.riseRaw);
      if (g.riseRaw >= g.height && g.height > 0)
        problems.push(`Rise at the walls (${g.riseRaw} mm) must be less than the inner height (${g.height} mm).`);
    }
    tiledValidate(problems, spec(item));
    return problems;
  },

  stackEngagement,
  bearingAreas: (item) => tiledBearingAreas(spec(item)),
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),
};
