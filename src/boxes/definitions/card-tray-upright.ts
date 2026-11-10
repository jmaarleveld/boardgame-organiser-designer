import type { BoxTypeDefinition, KeepOut, TopViewFeature } from '../types';
import type { ItemParams, ResolvedItem } from '../../model/types';
import type { Solid } from '../../geometry/types';
import {
  AUTO_WEDGE_DEPTH,
  cardDims,
  cardParams,
  EPS,
  bool,
  num,
  round,
  stackEngagement,
  stacking,
  stackingFlatBase,
  stackingFlatTop,
  stackingNewItemParams,
  stackingParams,
  validateCards,
  validateWedgeSizes,
  wedgeCutter,
  wedgeRaw,
  wedgeSize,
  type WallCut,
  type WedgeSize,
} from './common';
import {
  cellFrames,
  dividerHeightParam,
  extraHeightOf,
  extraHeightParam,
  raiseFloorThenWalls,
  tiledBaseFeatures,
  tiledBearingAreas,
  tiledBuild,
  tiledDraw,
  tiledFootprint,
  tiledLayout,
  tiledValidate,
  tilingOf,
  tilingParams,
  type CellFrame,
  type TiledBoxSpec,
} from './tiling';

/**
 * Geometry of an upright card tray cell: the cards stand portrait, faces
 * looking ±X, stacked along X. Cell X = stackHeight + c, Y = cardWidth + 2c,
 * Z = cardHeight − exposedHeight (the rest sticks out above the wall top).
 *
 * Two grips, each its own toggle (both off = no wedges):
 * - `wedgeEnds` (default on): a wedge in the walls perpendicular to the stack
 *   (the outer end walls at X = 0 / max and every divider), centred on the
 *   cell's Y range. Fingers pinch the stack from its first and last card faces.
 * - `wedgeLong` (default off): a wedge in the long outer walls (front / back,
 *   parallel to X), centred on the cell's X range. Fingers pinch the stack
 *   across the card width, from the card edges.
 *
 * Wedge sizes resolve relative to the wall span when 0 (auto): top = 60 % of
 * the span the wedge is cut from (cell X span for the long walls, cell Y span
 * for the ends), bottom = 40 % of the resolved top, depth = 60 % of the inner
 * height. Positive values override (the same for both sets). `raw` keeps the
 * entered values for validation.
 */
function geom(item: ResolvedItem) {
  const cards = cardDims(item);
  const c = cards.clearance;
  const exposed = num(item, 'exposedHeight', 20);
  const height = cards.cardHeight - exposed;
  const width = cards.stackHeight + c;
  const depth = cards.cardWidth + 2 * c;
  const raw = wedgeRaw(item);
  const cutEnds = bool(item, 'wedgeEnds', true);
  const cutLong = bool(item, 'wedgeLong', false);
  return {
    cards,
    exposed,
    width,
    depth,
    height,
    cutLong,
    cutEnds,
    raw,
    /** Sizes for the long walls (relative to the cell X span) and the end walls / dividers (cell Y span). */
    long: wedgeSize(raw, width),
    ends: wedgeSize(raw, depth),
    wedgeDepth: raw.depth > 0 ? raw.depth : AUTO_WEDGE_DEPTH * height,
  };
}

type Geom = ReturnType<typeof geom>;
type Side = 'left' | 'right' | 'front' | 'back';

/**
 * The wedge cuts of one cell. Long walls: front / back, only when outer.
 * Ends: the left side only when outer (the end wall at X = 0; a divider on
 * the left is cut by the neighbour as its right side), the right side always
 * (the end wall at X = max or the divider to the next cell), so every
 * divider is cut exactly once. A cut starts at the top of the material it
 * cuts: topZ on an outer wall (and continues through the lip), dividerTopZ
 * on a divider. On a lowered divider the depth is clamped so at least
 * max(wall, 1) of divider remains above the floor; a cut with nothing left
 * to remove is skipped.
 */
function wallCuts(f: CellFrame, g: Geom, wall: number): WallCut[] {
  const out: WallCut[] = [];
  const zCap = f.topZ + f.lipH + EPS;
  const outerCut = (across: 'x' | 'y', a0: number, t: number, c: number, size: WedgeSize): WallCut => ({
    across,
    a0,
    t,
    c,
    size,
    zTop: f.topZ,
    zBot: f.topZ - g.wedgeDepth,
    zCap,
  });
  if (g.cutLong) {
    const cx = f.x + f.width / 2;
    if (f.outer.front) out.push(outerCut('y', f.y - f.sides.front, f.sides.front, cx, g.long));
    if (f.outer.back) out.push(outerCut('y', f.y + f.depth, f.sides.back, cx, g.long));
  }
  if (g.cutEnds) {
    const cy = f.y + f.depth / 2;
    const sides: Side[] = f.outer.left ? ['left', 'right'] : ['right'];
    for (const side of sides) {
      const t = f.sides[side];
      const a0 = side === 'left' ? f.x - t : f.x + f.width;
      if (f.outer[side]) {
        out.push(outerCut('x', a0, t, cy, g.ends));
        continue;
      }
      const lowered = f.dividerTopZ < f.topZ - EPS;
      const maxDepth = lowered ? f.dividerTopZ - f.floorZ - Math.max(wall, 1) : Infinity;
      const depth = Math.min(g.wedgeDepth, maxDepth);
      if (!(depth > 0)) continue;
      out.push({ across: 'x', a0, t, c: cy, size: g.ends, zTop: f.dividerTopZ, zBot: f.dividerTopZ - depth, zCap });
    }
  }
  return out;
}

/** Mini-map notch: the top width × the wall thickness, where the wedge meets the top. */
function notchOf(w: WallCut): TopViewFeature {
  return w.across === 'y'
    ? { kind: 'rect', role: 'notch', x: w.c - w.size.top / 2, y: w.a0, w: w.size.top, h: w.t }
    : { kind: 'rect', role: 'notch', x: w.a0, y: w.c - w.size.top / 2, w: w.t, h: w.size.top };
}

function hasWedges(g: Geom): boolean {
  return (g.cutLong || g.cutEnds) && g.wedgeDepth > 0 && (!g.cutLong || g.long.top > 0) && (!g.cutEnds || g.ends.top > 0);
}

/**
 * Tiling spec: one cell holds a standing card stack, repeated along X
 * (columns) with shared dividers parallel to Y between the stacks.
 */
function spec(item: ResolvedItem): TiledBoxSpec {
  const g = geom(item);
  const wedges = hasWedges(g);
  return {
    ...tilingOf(item, 'x'),
    cell: { width: g.width, depth: g.depth, height: g.height },
    wall: item.wall,
    floor: item.floor,
    stacking: stacking(item),
    dividerHeight: num(item, 'dividerHeight'),
    extraHeight: extraHeightOf(item),
    cellCutters(kernel, f) {
      const out: Solid[] = [kernel.box(f.width, f.depth, f.height + f.lipH + EPS, [f.x, f.y, f.floorZ])];
      if (wedges) for (const w of wallCuts(f, g, item.wall)) out.push(wedgeCutter(kernel, w));
      return out;
    },
    cellDraw(f) {
      const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
      if (wedges) for (const w of wallCuts(f, g, item.wall)) out.push(notchOf(w));
      return out;
    },
  };
}

/** The wedge size params are shown when either toggle is on. */
const wedgesOn = (p: ItemParams): boolean => p.wedgeEnds !== false || p.wedgeLong === true;

export const cardTrayUpright: BoxTypeDefinition = {
  id: 'card-tray-upright',
  name: 'Card tray (upright)',
  description: 'Standing card stacks side by side, with wedges in the end walls and dividers (or the long walls) to grab the cards.',
  params: [
    ...cardParams,
    {
      key: 'exposedHeight',
      label: 'Exposed height',
      kind: 'number',
      default: 20,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Cards',
      help: 'How far the standing cards stick out above the walls.',
    },
    ...tilingParams('x'),
    { ...dividerHeightParam, visibleIf: (p) => Number(p.columns) > 1 },
    {
      key: 'wedgeEnds',
      label: 'Wedges in the end walls and dividers',
      kind: 'boolean',
      default: true,
      group: 'Wedge',
      help: 'A wedge in every wall between and at the ends of the stacks, centred on the card width: pinch the stack by its first and last card.',
    },
    {
      key: 'wedgeLong',
      label: 'Wedges in the long walls',
      kind: 'boolean',
      default: false,
      group: 'Wedge',
      help: 'A wedge in the front and back wall of every stack: pinch the cards by their edges, across the card width.',
    },
    {
      key: 'wedgeTopWidth',
      label: 'Top width',
      kind: 'number',
      default: 0,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Wedge',
      help: 'Width of the wedge at the wall top; 0 = auto (60 % of the wall span it is cut from: the card slot width for end walls and dividers, the stack slot width for long walls).',
      visibleIf: wedgesOn,
    },
    {
      key: 'wedgeBottomWidth',
      label: 'Bottom width',
      kind: 'number',
      default: 0,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Wedge',
      help: 'Width of the wedge at its lowest point; 0 = auto (40 % of the top width).',
      visibleIf: wedgesOn,
    },
    {
      key: 'wedgeDepth',
      label: 'Depth',
      kind: 'number',
      default: 0,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Wedge',
      help: 'How far the wedge reaches down from the wall top; 0 = auto (60 % of the inner height). On lowered dividers it is clamped to leave material above the floor.',
      visibleIf: wedgesOn,
    },
    ...stackingParams,
    extraHeightParam,
  ],
  newItemParams: { ...stackingNewItemParams },

  footprint: (item) => tiledFootprint(spec(item)),
  build: (item, kernel) => tiledBuild(kernel, spec(item)),
  draw: (item) => tiledDraw(spec(item)),

  validate(item) {
    const g = geom(item);
    const problems: string[] = [];
    validateCards(problems, g.cards);
    if (g.exposed < 0) problems.push(`Exposed height must not be negative (is ${g.exposed}).`);
    if (!(g.height > 0)) {
      problems.push(`Exposed height (${g.exposed} mm) must be smaller than the card height (${g.cards.cardHeight} mm).`);
    }
    if (g.cutEnds || g.cutLong) {
      const sets: { size: WedgeSize; span: number; what: string }[] = [];
      if (g.cutLong) sets.push({ size: g.long, span: g.width, what: 'the stack slot width' });
      if (g.cutEnds) sets.push({ size: g.ends, span: g.depth, what: 'the card slot width' });
      validateWedgeSizes(problems, g.raw, item.wall, sets);
      if (g.height > 0 && g.wedgeDepth > g.height) {
        problems.push(`Wedge depth (${round(g.wedgeDepth)} mm) must not exceed the inner height (${round(g.height)} mm).`);
      }
    }
    tiledValidate(problems, spec(item));
    return problems;
  },

  stackEngagement,
  bearingAreas: (item) => tiledBearingAreas(spec(item)),
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),

  flatBase: stackingFlatBase,
  flatTop: stackingFlatTop,
  raise: raiseFloorThenWalls,

  /**
   * The cards stand on the floor and stick out exposedHeight above the wall
   * top, i.e. exposedHeight − lipH − extra wall height above the outer top:
   * one rect over each cell's cavity must stay free up to there.
   */
  keepOut(item) {
    const g = geom(item);
    if (!(g.height > 0)) return [];
    const s = spec(item);
    const L = tiledLayout(s);
    const above = g.exposed - L.lipH - L.extraH;
    if (!(above > 0)) return [];
    return cellFrames(s).map(
      (f): KeepOut => ({ x: f.x, y: f.y, width: f.width, depth: f.depth, height: above, name: 'standing cards', fix: 'lower the exposed height' }),
    );
  },
};
