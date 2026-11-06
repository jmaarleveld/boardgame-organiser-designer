import type { BoxTypeDefinition, KeepOut, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid, Vec2 } from '../../geometry/types';
import {
  cardDims,
  cardParams,
  EPS,
  bool,
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
  cellFrames,
  dividerHeightParam,
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

/** Auto wedge depth as a fraction of the inner height (wedgeDepth 0). */
const AUTO_WEDGE_DEPTH = 0.6;
/** Auto wedge top width as a fraction of the span of the wall it is cut from (wedgeTopWidth 0). */
const AUTO_WEDGE_TOP = 0.6;
/** Auto wedge bottom width as a fraction of the resolved top width (wedgeBottomWidth 0). */
const AUTO_WEDGE_BOTTOM = 0.4;

/** Which walls get the wedges (param `wedgeWalls`). */
export const WEDGE_WALLS = ['ends', 'long', 'both'] as const;
export type WedgeWalls = (typeof WEDGE_WALLS)[number];

/** Resolved trapezoid size for one set of walls. */
interface WedgeSize {
  top: number;
  bottom: number;
}

/**
 * Geometry of an upright card tray cell: the cards stand portrait, faces
 * looking ±X, stacked along X. Cell X = stackHeight + c, Y = cardWidth + 2c,
 * Z = cardHeight − exposedHeight (the rest sticks out above the wall top).
 *
 * Two grips, chosen by `wedgeWalls`:
 * - `long`: a wedge in the long outer walls (front / back, parallel to X),
 *   centred on the cell's X range. Fingers pinch the stack across the card
 *   width, from the card edges.
 * - `ends` (default): a wedge in the walls perpendicular to the stack (the
 *   outer end walls at X = 0 / max and every divider), centred on the cell's
 *   Y range. Fingers pinch the stack from its first and last card faces.
 * - `both`: both sets.
 *
 * Wedge sizes resolve relative to the wall span when 0 (auto): top = 60 % of
 * the span the wedge is cut from (cell X span for `long`, cell Y span for
 * `ends`), bottom = 40 % of the resolved top, depth = 60 % of the inner
 * height. Positive values override (the same for both sets). `*Raw` keep the
 * entered values for validation.
 */
function geom(item: ResolvedItem) {
  const cards = cardDims(item);
  const c = cards.clearance;
  const exposed = num(item, 'exposedHeight', 20);
  const height = cards.cardHeight - exposed;
  const width = cards.stackHeight + c;
  const depth = cards.cardWidth + 2 * c;
  const wedgeTopRaw = num(item, 'wedgeTopWidth', 0);
  const wedgeBottomRaw = num(item, 'wedgeBottomWidth', 0);
  const wedgeDepthRaw = num(item, 'wedgeDepth', 0);
  const size = (span: number): WedgeSize => {
    const top = wedgeTopRaw > 0 ? wedgeTopRaw : AUTO_WEDGE_TOP * span;
    return { top, bottom: wedgeBottomRaw > 0 ? wedgeBottomRaw : AUTO_WEDGE_BOTTOM * top };
  };
  const wedgeWalls = str(item, 'wedgeWalls', WEDGE_WALLS, 'ends');
  return {
    cards,
    exposed,
    width,
    depth,
    height,
    wedges: bool(item, 'wedges', true),
    wedgeWalls,
    cutLong: wedgeWalls !== 'ends',
    cutEnds: wedgeWalls !== 'long',
    wedgeTopRaw,
    wedgeBottomRaw,
    /** Sizes for the long walls (relative to the cell X span) and the end walls / dividers (cell Y span). */
    long: size(width),
    ends: size(depth),
    wedgeDepthRaw,
    wedgeDepth: wedgeDepthRaw > 0 ? wedgeDepthRaw : AUTO_WEDGE_DEPTH * height,
  };
}

type Geom = ReturnType<typeof geom>;
type Side = 'left' | 'right' | 'front' | 'back';

/**
 * One wedge cut: the wall material occupies [a0, a0 + t] along `across`
 * (the axis through the wall: 'y' for front / back, 'x' for left / right);
 * the trapezoid is centred on `c` along the other horizontal axis.
 */
interface WallCut {
  across: 'x' | 'y';
  a0: number;
  t: number;
  c: number;
  size: WedgeSize;
  zTop: number;
  zBot: number;
  zCap: number;
}

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

/**
 * Wedge cutter: a trapezoid, `top` wide at the top of the wall and `bottom`
 * wide at zBot, centred on `c`; above the top it continues straight up to
 * zCap (through the lip, +EPS). Extruded through the wall thickness with EPS
 * overshoot on both faces (outside the part and into the cavity, which is cut
 * anyway).
 *
 * Built as an XY polygon (x = along the wall, y standing for Z) extruded
 * along +Z, then rotated so the extrusion runs through the wall:
 * - across 'y' (front / back): rotate +90° about X, (u, v, w) → (u, −w, v),
 *   extrusion along −Y;
 * - across 'x' (left / right): additionally +90° about Z, → (w, u, v),
 *   extrusion along +X.
 */
function wedgeCutter(kernel: GeometryKernel, w: WallCut): Solid {
  const tw = w.size.top / 2;
  const bw = w.size.bottom / 2;
  const { c, zTop, zBot, zCap } = w;
  const poly: Vec2[] =
    bw > 0
      ? [
          [c - bw, zBot],
          [c + bw, zBot],
          [c + tw, zTop],
          [c + tw, zCap],
          [c - tw, zCap],
          [c - tw, zTop],
        ]
      : [
          [c, zBot],
          [c + tw, zTop],
          [c + tw, zCap],
          [c - tw, zCap],
          [c - tw, zTop],
        ];
  const len = w.t + 2 * EPS;
  const prism = kernel.extrude(poly, len);
  if (w.across === 'y') {
    // Y ∈ [−len, 0] after the rotation.
    return kernel.translate(kernel.rotate(prism, [90, 0, 0]), [0, w.a0 - EPS + len, 0]);
  }
  // X ∈ [0, len] after the rotation.
  return kernel.translate(kernel.rotate(prism, [90, 0, 90]), [w.a0 - EPS, 0, 0]);
}

/** Mini-map notch: the top width × the wall thickness, where the wedge meets the top. */
function notchOf(w: WallCut): TopViewFeature {
  return w.across === 'y'
    ? { kind: 'rect', role: 'notch', x: w.c - w.size.top / 2, y: w.a0, w: w.size.top, h: w.t }
    : { kind: 'rect', role: 'notch', x: w.a0, y: w.c - w.size.top / 2, w: w.t, h: w.size.top };
}

function hasWedges(g: Geom): boolean {
  return g.wedges && g.wedgeDepth > 0 && (!g.cutLong || g.long.top > 0) && (!g.cutEnds || g.ends.top > 0);
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
      key: 'wedges',
      label: 'Wedges',
      kind: 'boolean',
      default: true,
      group: 'Wedge',
      help: 'Cut a wedge into the top of the walls around every stack, to grab the cards.',
    },
    {
      key: 'wedgeWalls',
      label: 'Wedged walls',
      kind: 'select',
      default: 'ends',
      options: [
        { value: 'ends', label: 'End walls and dividers: pinch across the stack' },
        { value: 'long', label: 'Long walls: pinch across the card width' },
        { value: 'both', label: 'Both' },
      ],
      group: 'Wedge',
      help:
        'End walls and dividers: a wedge in every wall between and at the ends of the stacks, centred on the card width; ' +
        'grab the stack by its first and last card. Long walls: a wedge in the front and back wall of every stack; ' +
        'grab the cards by their edges.',
      visibleIf: (p) => p.wedges !== false,
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
      visibleIf: (p) => p.wedges !== false,
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
      visibleIf: (p) => p.wedges !== false,
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
      visibleIf: (p) => p.wedges !== false,
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
    if (g.exposed < 0) problems.push(`Exposed height must not be negative (is ${g.exposed}).`);
    if (!(g.height > 0)) {
      problems.push(`Exposed height (${g.exposed} mm) must be smaller than the card height (${g.cards.cardHeight} mm).`);
    }
    if (g.wedges) {
      if (g.wedgeTopRaw < 0) problems.push(`Wedge top width must not be negative (is ${g.wedgeTopRaw}).`);
      if (g.wedgeBottomRaw < 0) problems.push(`Wedge bottom width must not be negative (is ${g.wedgeBottomRaw}).`);
      if (g.wedgeDepthRaw < 0) problems.push(`Wedge depth must not be negative (is ${g.wedgeDepthRaw}).`);
      // Leave a post at least max(wall, 1) mm wide on both sides of the wedge (between neighbours and at the ends).
      const post = Math.max(item.wall, 1);
      const sets: { size: WedgeSize; span: number; what: string }[] = [];
      if (g.cutLong) sets.push({ size: g.long, span: g.width, what: 'the stack slot width' });
      if (g.cutEnds) sets.push({ size: g.ends, span: g.depth, what: 'the card slot width' });
      if (g.wedgeBottomRaw > 0) {
        const top = Math.min(...sets.map((x) => x.size.top));
        if (g.wedgeBottomRaw > top) {
          problems.push(`Wedge bottom width (${round(g.wedgeBottomRaw)} mm) must not exceed the top width (${round(top)} mm).`);
        }
      }
      if (g.wedgeTopRaw > 0) {
        for (const { span, what } of sets) {
          const maxTop = span - 2 * post;
          if (g.wedgeTopRaw >= maxTop) {
            problems.push(
              `Wedge top width (${round(g.wedgeTopRaw)} mm) must be smaller than ${round(maxTop)} mm (${what} ${round(span)} mm minus ${round(post)} mm on each side) so wall remains beside the wedges.`,
            );
          }
        }
      }
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

  /**
   * The cards stand on the floor and stick out exposedHeight above the wall
   * top, i.e. exposedHeight − lipH above the outer top: one rect over each
   * cell's cavity must stay free up to there.
   */
  keepOut(item) {
    const g = geom(item);
    if (!(g.height > 0)) return [];
    const s = spec(item);
    const above = g.exposed - tiledLayout(s).lipH;
    if (!(above > 0)) return [];
    return cellFrames(s).map(
      (f): KeepOut => ({ x: f.x, y: f.y, width: f.width, depth: f.depth, height: above, name: 'standing cards', fix: 'lower the exposed height' }),
    );
  },
};
