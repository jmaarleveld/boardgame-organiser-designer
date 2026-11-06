import type { BoxTypeDefinition } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid } from '../../geometry/types';
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
  dividerHeightParam,
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

/** Scoop radius actually used: ≤ inner height and ≤ half the span across, never negative. */
function clampRadius(r: number, height: number, span: number): number {
  return Math.max(0, Math.min(r, height, span / 2));
}

function geom(item: ResolvedItem) {
  const floorShape = str<FloorShape>(item, 'floorShape', FLOOR_SHAPES, 'flat');
  const scoopSides = str<ScoopSides>(item, 'scoopSides', SCOOP_SIDES, 'long');
  const width = num(item, 'innerWidth');
  const depth = num(item, 'innerDepth');
  const height = num(item, 'innerHeight');
  const rRaw = num(item, 'scoopRadius', 10);
  const { axis, span } = scoopAxis(width, depth, scoopSides);
  const r = floorShape === 'scoop' ? clampRadius(rRaw, height, span) : 0;
  return { floorShape, scoopSides, width, depth, height, rRaw, r, axis };
}

/**
 * Concave fillets of radius `r` between the cell floor and the two walls
 * running along `axis`: per wall a bar r × r in the floor corner minus a
 * cylinder whose axis lies along the wall at height floorZ + r, r from the
 * wall. The bars overshoot the cavity by EPS (they are only subtracted from
 * the cavity cutter, so overshoot never touches the part).
 */
function scoopFillets(kernel: GeometryKernel, f: CellFrame, axis: 'x' | 'y', r: number): Solid[] {
  const zc = f.floorZ + r;
  const zb = f.floorZ - EPS;
  if (axis === 'x') {
    const len = f.width + 4 * EPS;
    const x0 = f.x - 2 * EPS;
    const cyl = kernel.rotate(kernel.cylinder(r, len + 2 * EPS), [0, 90, 0]);
    return [
      kernel.difference(kernel.box(len, r + EPS, r + EPS, [x0, f.y - EPS, zb]), [kernel.translate(cyl, [x0 - EPS, f.y + r, zc])]),
      kernel.difference(kernel.box(len, r + EPS, r + EPS, [x0, f.y + f.depth - r, zb]), [
        kernel.translate(cyl, [x0 - EPS, f.y + f.depth - r, zc]),
      ]),
    ];
  }
  const len = f.depth + 4 * EPS;
  const y0 = f.y - 2 * EPS;
  const cyl = kernel.rotate(kernel.cylinder(r, len + 2 * EPS), [-90, 0, 0]);
  return [
    kernel.difference(kernel.box(r + EPS, len, r + EPS, [f.x - EPS, y0, zb]), [kernel.translate(cyl, [f.x + r, y0 - EPS, zc])]),
    kernel.difference(kernel.box(r + EPS, len, r + EPS, [f.x + f.width - r, y0, zb]), [
      kernel.translate(cyl, [f.x + f.width - r, y0 - EPS, zc]),
    ]),
  ];
}

/**
 * Tiling spec of an item tray: one cell = innerWidth × innerDepth ×
 * innerHeight, repeated columns × rows. The cell cutter is the cavity box
 * (through the lip), minus the scoop fillets for a scoop floor. No finger
 * notches: the scoop is the access feature.
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
    dividerHeight: num(item, 'dividerHeight'),
    cellCutters(kernel, f) {
      const cavity = kernel.box(f.width, f.depth, f.height + f.lipH + EPS, [f.x, f.y, f.floorZ]);
      if (!(g.r > 0)) return [cavity];
      return [kernel.difference(cavity, scoopFillets(kernel, f, g.axis, g.r))];
    },
    cellDraw(f) {
      return [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
    },
  };
}

export const itemTray: BoxTypeDefinition = {
  id: 'item-tray',
  name: 'Item tray',
  description: 'Small tray for tokens and bits: a grid of equal cells with a flat or scooped floor.',
  params: [
    { key: 'innerWidth', label: 'Cell width', kind: 'number', default: 40, min: 1, step: 0.5, unit: 'mm', group: 'Size',
      help: 'Inner width of one cell.' },
    { key: 'innerDepth', label: 'Cell depth', kind: 'number', default: 30, min: 1, step: 0.5, unit: 'mm', group: 'Size',
      help: 'Inner depth of one cell.' },
    { key: 'innerHeight', label: 'Inner height', kind: 'number', default: 20, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    ...tilingParams('xy'),
    { ...dividerHeightParam, visibleIf: (p) => Number(p.columns) > 1 || Number(p.rows) > 1 },
    {
      key: 'floorShape',
      label: 'Floor',
      kind: 'select',
      default: 'flat',
      options: [
        { value: 'flat', label: 'Flat' },
        { value: 'scoop', label: 'Scoop (rounded into two walls)' },
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
      help: 'The two opposite walls of each cell the floor curves up into.',
      visibleIf: (p) => p.floorShape === 'scoop',
    },
    {
      key: 'scoopRadius',
      label: 'Scoop radius',
      kind: 'number',
      default: 10,
      min: 0.5,
      step: 0.5,
      unit: 'mm',
      group: 'Floor',
      help: 'Clamped to the inner height and to half the cell span across the scooped walls.',
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
    if (g.floorShape === 'scoop') requirePositive(problems, 'Scoop radius', g.rRaw);
    tiledValidate(problems, spec(item));
    return problems;
  },

  stackEngagement,
  bearingAreas: (item) => tiledBearingAreas(spec(item)),
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),
};
