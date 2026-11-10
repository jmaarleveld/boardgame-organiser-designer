/**
 * Tiling framework: a box type describes ONE cell (a cavity plus its access
 * features) and the framework repeats it `cols` times along X and `rows`
 * times along Y inside one printed part with shared inner walls (dividers).
 * Box types never loop over cells themselves. See docs-containers.md.
 *
 * Local frame as everywhere: X = width, Y = depth, Z = up, origin = outer
 * front‑left‑bottom corner, floor on Z = 0 (Z = plug height with a plug).
 *
 *   outer width  W = 2·wall + (cols − 1)·pitchX + cell.width
 *   outer depth  D = 2·wall + (rows − 1)·pitchY + cell.depth
 *   outer height H = plug + floor + cell.height + lip
 *
 * Cell (col, row) has its inner (cavity bounding box) origin at
 * (wall + col·pitchX, wall + row·pitchY, plug + floor). Between two cells
 * along X lies `pitchX − cell.width` of material (= `divider` by default),
 * likewise along Y. Dividers never carry the stacking lip: the lip is the
 * outer half of the outer wall only, so a recessed base above rests on the
 * inner wall half and on full‑height dividers at the wall top.
 */
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid } from '../../geometry/types';
import type { BaseFeature, BearingArea, Footprint, ItemEdit, ParamSpec, RaiseOptions, TopViewFeature } from '../types';
import {
  cavityBaseFeatures,
  cavityBearingAreas,
  EPS,
  num,
  requirePositive,
  round,
  roundEdit,
  stackedBlock,
  stackedHeight,
  validateStacking,
  type LocalRect,
  type Stacking,
} from './common';

/** Which counts a type repeats along: columns (X), rows (Y) or both. */
export type TilingAxes = 'x' | 'y' | 'xy';

/** One cell, as a box type defines it. */
export interface CellSpec {
  /** Inner (cavity) size of one cell, axis aligned bounding box. */
  width: number;
  depth: number;
  height: number;
  /** Distance between cell origins along X; default width + divider. */
  pitchX?: number;
  /** Distance between cell origins along Y; default depth + divider. */
  pitchY?: number;
}

/** Per‑side numbers of a cell, seen from above (left = −X, front = −Y). */
export interface CellSides<T> {
  left: T;
  right: T;
  front: T;
  back: T;
}

/** What the framework hands the cell functions, per cell. */
export interface CellFrame {
  /** 0‑based column (X) and row (Y). */
  col: number;
  row: number;
  /** Inner origin of the cell (min corner of its cavity bounding box) in the outer frame. */
  x: number;
  y: number;
  /** Cell inner size (CellSpec). */
  width: number;
  depth: number;
  height: number;
  /** Z of the cavity floor (plug + floor). */
  floorZ: number;
  /** Z of the wall top (floorZ + height). */
  topZ: number;
  /** Extra material above topZ on the outer walls (stacking lip), 0 if none. Dividers never have it. */
  lipH: number;
  /** Z of the divider tops: topZ, or floorZ + dividerHeight when the dividers are lowered. */
  dividerTopZ: number;
  /**
   * Thickness of the material on each side of this cell: `wall` for an outer
   * wall, the gap to the neighbour cell (pitch − size, = divider by default)
   * for a shared divider. A cutter that spans `[x − sides.left − EPS, x + EPS]`
   * cuts exactly through the left wall / divider.
   */
  sides: CellSides<number>;
  /** Whether that side is an outer wall (true) or a shared divider (false). */
  outer: CellSides<boolean>;
}

export interface TiledBoxSpec {
  /** Counts as given (may be invalid: the framework rounds to whole numbers ≥ 1; `tiledValidate` reports bad ones). */
  cols: number;
  rows: number;
  cell: CellSpec;
  wall: number;
  floor: number;
  divider: number;
  stacking: Stacking;
  /**
   * Solids to subtract per cell: the cavity and its access features (gaps,
   * wedges, floor grooves). The cavity must reach up through the lip
   * (topZ + lipH + EPS). Overshoot into a neighbouring cavity or outside the
   * part by EPS is fine. A feature in a shared divider should be cut by one
   * of the two cells only (e.g. only on a side that is `outer`, or always on
   * the right / back), so it is drawn once.
   */
  cellCutters(kernel: GeometryKernel, frame: CellFrame): Solid[];
  /** Mini‑map features per cell (cavity rect, notch rects). */
  cellDraw(frame: CellFrame): TopViewFeature[];
  /** Optional extra bearing areas per cell (default: none; dividers are added by the framework). */
  cellBearing?(frame: CellFrame): BearingArea[];
  /**
   * Optional divider height above the floor. Lowered only when > 0 and
   * < cell height (the framework cuts the strip above each divider); 0 /
   * undefined / ≥ height = full height.
   */
  dividerHeight?: number;
  /**
   * false when the dividers are not straight vertical walls (e.g. the tilted
   * dispenser): the framework then neither draws, reports nor lowers them,
   * and an explicit pitch may be smaller than the cell size (overlapping
   * bounding boxes; `sides` / `gapX` / `gapY` are then negative and
   * meaningless for shared sides). Default true.
   */
  straightDividers?: boolean;
  /**
   * Extra wall height (mm, ≥ 0; `extraHeightParam`): the finished part is
   * stretched at `stretchZ` (just under the wall top), so the outer walls,
   * full‑height dividers and the lip rise by this much and everything cut
   * through that plane (cavities, slots, wedges, openings) continues straight
   * up. The cell callbacks never see it: they build the part as without it.
   */
  extraHeight?: number;
  /**
   * Optional Z values (outer frame) of horizontal faces just under the wall
   * top that the stretch plane must stay above (e.g. the bottom of an access
   * opening). The floor and lowered divider tops are known to the framework.
   */
  stretchKeepBelow?: number[];
}

/** How far under the wall top the part is stretched for `extraHeight` (at most; see `tiledLayout`). */
export const STRETCH_BELOW_TOP = 0.2;

/** Normalised count: a whole number ≥ 1. */
function countOf(v: number): number {
  return Number.isFinite(v) ? Math.max(1, Math.round(v)) : 1;
}

/** Derived layout of a tiled box (see the file comment). */
export interface TiledLayout {
  cols: number;
  rows: number;
  pitchX: number;
  pitchY: number;
  /** Material between two cells along X / Y (pitch − cell size). */
  gapX: number;
  gapY: number;
  /** Outer size. */
  width: number;
  depth: number;
  height: number;
  floorZ: number;
  topZ: number;
  lipH: number;
  dividerTopZ: number;
  /** True when the dividers are lowered below the wall top. */
  lowDividers: boolean;
  /** Extra wall height actually applied (0 when none or invalid). Included in `height`. */
  extraH: number;
  /**
   * Z of the stretch plane for `extraH`, in the unstretched part: STRETCH_BELOW_TOP
   * under the wall top, but at most half way down to the highest horizontal
   * face below it (floor, lowered divider tops, `stretchKeepBelow`).
   */
  stretchZ: number;
}

export function tiledLayout(spec: TiledBoxSpec): TiledLayout {
  const { cell, wall, floor, stacking: s } = spec;
  const cols = countOf(spec.cols);
  const rows = countOf(spec.rows);
  const pitchX = spec.cell.pitchX ?? cell.width + spec.divider;
  const pitchY = spec.cell.pitchY ?? cell.depth + spec.divider;
  const floorZ = s.plugH + floor;
  const topZ = floorZ + cell.height;
  const dh = spec.dividerHeight ?? 0;
  const lowDividers = spec.straightDividers !== false && dh > 0 && dh < cell.height;
  const dividerTopZ = lowDividers ? floorZ + dh : topZ;
  const extraRaw = spec.extraHeight ?? 0;
  const extraH = Number.isFinite(extraRaw) && extraRaw > 0 ? extraRaw : 0;
  let below = floorZ;
  for (const z of [lowDividers ? dividerTopZ : -Infinity, ...(spec.stretchKeepBelow ?? [])]) {
    if (Number.isFinite(z) && z < topZ - 1e-9) below = Math.max(below, z);
  }
  const stretchZ = topZ - Math.min(STRETCH_BELOW_TOP, (topZ - below) / 2);
  return {
    cols,
    rows,
    pitchX,
    pitchY,
    gapX: pitchX - cell.width,
    gapY: pitchY - cell.depth,
    width: 2 * wall + (cols - 1) * pitchX + cell.width,
    depth: 2 * wall + (rows - 1) * pitchY + cell.depth,
    height: stackedHeight(cell.height, floor, s) + extraH,
    floorZ,
    topZ,
    lipH: s.lipH,
    dividerTopZ,
    lowDividers,
    extraH,
    stretchZ,
  };
}

/**
 * Bearing areas of the unstretched part moved to where they are after the
 * `extraHeight` stretch: every face above the stretch plane rises by it.
 */
export function stretchedAreas<A extends { height: number }>(spec: TiledBoxSpec, areas: A[]): A[] {
  const L = tiledLayout(spec);
  if (!(L.extraH > 0)) return areas;
  return areas.map((a) => (a.height > L.stretchZ ? { ...a, height: a.height + L.extraH } : a));
}

/** Outer size of the tiled box. */
export function tiledFootprint(spec: TiledBoxSpec): Footprint {
  const L = tiledLayout(spec);
  return { width: L.width, depth: L.depth, height: L.height };
}

/** Every cell's frame, row‑major (row 0 = front, col 0 = left). */
export function cellFrames(spec: TiledBoxSpec): CellFrame[] {
  const L = tiledLayout(spec);
  const { cell, wall } = spec;
  const out: CellFrame[] = [];
  for (let row = 0; row < L.rows; row++) {
    for (let col = 0; col < L.cols; col++) {
      const outer = { left: col === 0, right: col === L.cols - 1, front: row === 0, back: row === L.rows - 1 };
      out.push({
        col,
        row,
        x: wall + col * L.pitchX,
        y: wall + row * L.pitchY,
        width: cell.width,
        depth: cell.depth,
        height: cell.height,
        floorZ: L.floorZ,
        topZ: L.topZ,
        lipH: L.lipH,
        dividerTopZ: L.dividerTopZ,
        sides: {
          left: outer.left ? wall : L.gapX,
          right: outer.right ? wall : L.gapX,
          front: outer.front ? wall : L.gapY,
          back: outer.back ? wall : L.gapY,
        },
        outer,
      });
    }
  }
  return out;
}

/** A straight divider's top‑view rect; `axis` = the direction it runs along. */
export interface DividerRect extends LocalRect {
  axis: 'x' | 'y';
}

/**
 * The straight dividers: one per column boundary (parallel to Y, spanning the
 * whole inner depth) and one per row boundary (parallel to X, spanning the
 * whole inner width); they overlap where they cross. None when
 * `straightDividers` is false or the gap between cells is not positive.
 */
export function dividerRects(spec: TiledBoxSpec): DividerRect[] {
  if (spec.straightDividers === false) return [];
  const L = tiledLayout(spec);
  const { wall, cell } = spec;
  const out: DividerRect[] = [];
  const innerW = L.width - 2 * wall;
  const innerD = L.depth - 2 * wall;
  if (L.gapX > 0) {
    for (let i = 1; i < L.cols; i++) {
      out.push({ axis: 'y', x: wall + (i - 1) * L.pitchX + cell.width, y: wall, width: L.gapX, depth: innerD });
    }
  }
  if (L.gapY > 0) {
    for (let j = 1; j < L.rows; j++) {
      out.push({ axis: 'x', x: wall, y: wall + (j - 1) * L.pitchY + cell.depth, width: innerW, depth: L.gapY });
    }
  }
  return out;
}

/**
 * Outer block with the stacking features (`stackedBlock`) minus: the strip
 * above every divider down to the divider height (when lowered; only the
 * dividers, the outer walls keep their full height and lip) and every cell's
 * cutters. One boolean for everything.
 */
export function tiledBuild(kernel: GeometryKernel, spec: TiledBoxSpec): Solid {
  const L = tiledLayout(spec);
  const cutters: Solid[] = [];
  for (const f of cellFrames(spec)) cutters.push(...spec.cellCutters(kernel, f));
  if (L.lowDividers) {
    const z = L.dividerTopZ;
    const h = L.topZ + EPS - z;
    // Overshoot into the neighbouring cavities across the divider, not into the outer walls along it.
    for (const d of dividerRects(spec)) {
      cutters.push(
        d.axis === 'y'
          ? kernel.box(d.width + 2 * EPS, d.depth, h, [d.x - EPS, d.y, z])
          : kernel.box(d.width, d.depth + 2 * EPS, h, [d.x, d.y - EPS, z]),
      );
    }
  }
  const part = stackedBlock(kernel, L.width, L.depth, spec.floor + spec.cell.height, spec.wall, spec.stacking, cutters);
  return L.extraH > 0 ? kernel.stretchZ(part, L.stretchZ, L.extraH) : part;
}

/** Cell features (cavities first), then the divider rects, then the other cell features (notches) on top. */
export function tiledDraw(spec: TiledBoxSpec): TopViewFeature[] {
  const cellFeats = cellFrames(spec).flatMap((f) => spec.cellDraw(f));
  const isCavity = (f: TopViewFeature) => f.kind === 'rect' && f.role === 'cavity';
  const dividers: TopViewFeature[] = dividerRects(spec).map((d) => ({
    kind: 'rect',
    role: 'divider',
    x: d.x,
    y: d.y,
    w: d.width,
    h: d.depth,
  }));
  return [...cellFeats.filter(isCavity), ...dividers, ...cellFeats.filter((f) => !isCavity(f))];
}

/**
 * The outer wall ring (`cavityBearingAreas`, with the lip), every straight
 * divider at its top (role 'bearing' at full height, 'low' when lowered) and
 * the cells' own areas.
 */
export function tiledBearingAreas(spec: TiledBoxSpec): BearingArea[] {
  const L = tiledLayout(spec);
  const areas = cavityBearingAreas(L.width, L.depth, spec.wall, spec.floor, spec.cell.height, spec.stacking);
  const role = L.lowDividers ? ('low' as const) : ('bearing' as const);
  for (const d of dividerRects(spec)) {
    areas.push({ x: d.x, y: d.y, width: d.width, depth: d.depth, height: L.dividerTopZ, role, name: 'divider' });
  }
  if (spec.cellBearing) for (const f of cellFrames(spec)) areas.push(...spec.cellBearing(f));
  return stretchedAreas(spec, areas);
}

/** Recess ring or plug pad of the outer box. */
export function tiledBaseFeatures(spec: TiledBoxSpec): BaseFeature[] {
  const L = tiledLayout(spec);
  return cavityBaseFeatures(L.width, L.depth, spec.wall, spec.stacking);
}

/**
 * Framework checks: whole counts ≥ 1, wall / floor > 0, a positive divider
 * (pitch ≥ cell size) along every axis with more than one cell, divider
 * height range, and the stacking checks on the outer box. With
 * `straightDividers: false` an explicit pitch may be smaller than the cell
 * (the cells' bounding boxes overlap, their cavities must not: the type
 * checks that, and its divider thickness, itself). The cell's own
 * size and features are the type's business.
 */
export function tiledValidate(problems: string[], spec: TiledBoxSpec): void {
  if (!(spec.cols >= 1) || !Number.isInteger(spec.cols)) problems.push(`Columns must be a whole number ≥ 1 (is ${spec.cols}).`);
  if (!(spec.rows >= 1) || !Number.isInteger(spec.rows)) problems.push(`Rows must be a whole number ≥ 1 (is ${spec.rows}).`);
  requirePositive(problems, 'Wall thickness', spec.wall);
  requirePositive(problems, 'Floor thickness', spec.floor);
  const L = tiledLayout(spec);
  // The divider sets the pitch along every repeated axis without an explicit one.
  if ((L.cols > 1 && spec.cell.pitchX === undefined) || (L.rows > 1 && spec.cell.pitchY === undefined)) {
    requirePositive(problems, 'Divider thickness', spec.divider);
  }
  // Non‑straight (e.g. tilted) dividers: the cells' bounding boxes may overlap
  // although their cavities do not, so the pitch may be smaller than the cell.
  const straight = spec.straightDividers !== false;
  if (straight && L.cols > 1 && spec.cell.pitchX !== undefined && !(L.gapX >= 0)) {
    problems.push(`Column pitch (${round(L.pitchX)} mm) must not be smaller than the cell width (${round(spec.cell.width)} mm).`);
  }
  if (straight && L.rows > 1 && spec.cell.pitchY !== undefined && !(L.gapY >= 0)) {
    problems.push(`Row pitch (${round(L.pitchY)} mm) must not be smaller than the cell depth (${round(spec.cell.depth)} mm).`);
  }
  const dh = spec.dividerHeight ?? 0;
  if (dh < 0) problems.push(`Divider height must not be negative (is ${dh}).`);
  if (dh > spec.cell.height) {
    problems.push(`Divider height (${dh} mm) must not exceed the inner height (${round(spec.cell.height)} mm).`);
  }
  const extra = spec.extraHeight ?? 0;
  if (!(extra >= 0)) problems.push(`Extra wall height must not be negative (is ${extra}).`);
  validateStacking(
    problems,
    spec.stacking,
    spec.wall,
    spec.floor,
    L.width - 2 * spec.wall,
    L.depth - 2 * spec.wall,
    spec.cell.height,
  );
}

/**
 * The "Repeat" parameter group: `columns` (axes 'x' / 'xy'), `rows`
 * (axes 'y' / 'xy') and `dividerThickness`. Defaults 1 column, 1 row, 1.2 mm.
 */
export function tilingParams(axes: TilingAxes): ParamSpec[] {
  const out: ParamSpec[] = [];
  if (axes !== 'y') {
    out.push({ key: 'columns', label: 'Columns', kind: 'number', default: 1, min: 1, max: 20, step: 1, unit: 'count', group: 'Repeat',
      help: 'Number of cells side by side along the width.' });
  }
  if (axes !== 'x') {
    out.push({ key: 'rows', label: 'Rows', kind: 'number', default: 1, min: 1, max: 20, step: 1, unit: 'count', group: 'Repeat',
      help: 'Number of cells side by side along the depth.' });
  }
  out.push({
    key: 'dividerThickness',
    label: 'Divider thickness',
    kind: 'number',
    default: 1.2,
    min: 0.4,
    step: 0.1,
    unit: 'mm',
    group: 'Repeat',
    help: 'Thickness of the shared walls between cells.',
  });
  return out;
}

/** Optional `dividerHeight` param for the "Repeat" group (0 = full height). */
export const dividerHeightParam: ParamSpec = {
  key: 'dividerHeight',
  label: 'Divider height',
  kind: 'number',
  default: 0,
  min: 0,
  step: 0.5,
  unit: 'mm',
  group: 'Repeat',
  help: 'Height above the floor; 0 = full inner height.',
};

/**
 * Optional `extraHeight` param (group "Height"): raises the walls above the
 * cavity without changing the cell. Set by "Flatten top" to level the insert.
 */
export const extraHeightParam: ParamSpec = {
  key: 'extraHeight',
  label: 'Extra wall height',
  kind: 'number',
  default: 0,
  min: 0,
  step: 0.5,
  unit: 'mm',
  group: 'Height',
  help: 'Raises the walls (and the full‑height dividers and the lip) by this much; the cavity and its slots and wedges continue straight up. Used by “Flatten top” to level the insert for the game board.',
};

/** The `extraHeight` value, as given (`tiledValidate` reports a negative one). */
export function extraHeightOf(item: ResolvedItem): number {
  return num(item, 'extraHeight', 0);
}

/** `raise` by taller walls: `by` more extra wall height. */
export function raiseWalls(item: ResolvedItem, by: number): ItemEdit {
  return { params: { extraHeight: roundEdit(Math.max(0, extraHeightOf(item)) + by) } };
}

/**
 * `raise` of a card tray with standing cards: with mode 'type' the floor goes
 * up as far as the cards allow (`headroom`), so they stick out as much as
 * before; the rest (and everything in mode 'walls') is extra wall height.
 */
export function raiseFloorThenWalls(item: ResolvedItem, by: number, opts: RaiseOptions): ItemEdit {
  const floorBy = opts.mode === 'type' ? Math.min(by, Math.max(0, opts.headroom)) : 0;
  const rest = by - floorBy;
  const edit: ItemEdit = {};
  if (floorBy > 1e-9) edit.floor = roundEdit(item.floor + floorBy);
  if (rest > 1e-9) edit.params = raiseWalls(item, rest).params;
  return edit;
}

/**
 * Counts and divider thickness from the `tilingParams(axes)` values, as
 * given (not rounded: the framework normalises, `tiledValidate` reports).
 * An axis the type does not repeat along is always 1.
 */
export function tilingOf(item: ResolvedItem, axes: TilingAxes): { cols: number; rows: number; divider: number } {
  return {
    cols: axes === 'y' ? 1 : num(item, 'columns', 1),
    rows: axes === 'x' ? 1 : num(item, 'rows', 1),
    divider: num(item, 'dividerThickness', 1.2),
  };
}
