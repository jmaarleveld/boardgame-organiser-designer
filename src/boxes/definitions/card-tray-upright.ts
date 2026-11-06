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
/** Auto wedge top width as a fraction of the cell's X span (wedgeTopWidth 0). */
const AUTO_WEDGE_TOP = 0.6;
/** Auto wedge bottom width as a fraction of the resolved top width (wedgeBottomWidth 0). */
const AUTO_WEDGE_BOTTOM = 0.4;

/**
 * Geometry of an upright card tray cell: the cards stand portrait, faces
 * looking ±X, stacked along X. Cell X = stackHeight + c, Y = cardWidth + 2c,
 * Z = cardHeight − exposedHeight (the rest sticks out above the wall top).
 *
 * Wedge sizes resolve relative to the cell when 0 (auto): top = 60 % of the
 * cell X span, bottom = 40 % of the resolved top, depth = 60 % of the inner
 * height. Positive values override. `*Raw` keep the entered values for
 * validation.
 */
function geom(item: ResolvedItem) {
  const cards = cardDims(item);
  const c = cards.clearance;
  const exposed = num(item, 'exposedHeight', 20);
  const height = cards.cardHeight - exposed;
  const width = cards.stackHeight + c;
  const wedgeTopRaw = num(item, 'wedgeTopWidth', 0);
  const wedgeBottomRaw = num(item, 'wedgeBottomWidth', 0);
  const wedgeDepthRaw = num(item, 'wedgeDepth', 0);
  const wedgeTop = wedgeTopRaw > 0 ? wedgeTopRaw : AUTO_WEDGE_TOP * width;
  return {
    cards,
    exposed,
    width,
    depth: cards.cardWidth + 2 * c,
    height,
    wedges: bool(item, 'wedges', true),
    wedgeTopRaw,
    wedgeBottomRaw,
    wedgeTop,
    wedgeBottom: wedgeBottomRaw > 0 ? wedgeBottomRaw : AUTO_WEDGE_BOTTOM * wedgeTop,
    wedgeDepthRaw,
    wedgeDepth: wedgeDepthRaw > 0 ? wedgeDepthRaw : AUTO_WEDGE_DEPTH * height,
  };
}

type Geom = ReturnType<typeof geom>;
type WallSide = 'front' | 'back';

/** The long outer walls of a cell that get a wedge (front / back, only when outer). */
function wedgeSidesOf(f: CellFrame): WallSide[] {
  const out: WallSide[] = [];
  if (f.outer.front) out.push('front');
  if (f.outer.back) out.push('back');
  return out;
}

/** Y range [y0, y0 + t] of the wall on `side` of the cell. */
function wallSpan(f: CellFrame, side: WallSide): { y0: number; t: number } {
  const t = f.sides[side];
  return side === 'front' ? { y0: f.y - t, t } : { y0: f.y + f.depth, t };
}

/**
 * Wedge cutter: a trapezoid in the XZ plane, `top` wide at the wall top and
 * `bottom` wide `depth` below it, centred on the cell's X range; above the
 * wall top it continues straight up through the lip (+EPS). Extruded through
 * the wall thickness with EPS overshoot on both faces (outer face and into
 * the cavity, which is cut anyway).
 *
 * Built as an XY polygon (y standing for Z) extruded along +Z and rotated
 * +90° about X: (x, y, z) → (x, −z, y), so the polygon lands in XZ and the
 * extrusion runs along −Y; then translated into place.
 */
function wedgeCutter(kernel: GeometryKernel, f: CellFrame, side: WallSide, g: Geom): Solid {
  const cx = f.x + f.width / 2;
  const zTop = f.topZ;
  const zBot = f.topZ - g.wedgeDepth;
  const zCap = f.topZ + f.lipH + EPS;
  const tw = g.wedgeTop / 2;
  const bw = g.wedgeBottom / 2;
  const poly: Vec2[] =
    bw > 0
      ? [
          [cx - bw, zBot],
          [cx + bw, zBot],
          [cx + tw, zTop],
          [cx + tw, zCap],
          [cx - tw, zCap],
          [cx - tw, zTop],
        ]
      : [
          [cx, zBot],
          [cx + tw, zTop],
          [cx + tw, zCap],
          [cx - tw, zCap],
          [cx - tw, zTop],
        ];
  const { y0, t } = wallSpan(f, side);
  const len = t + 2 * EPS;
  const prism = kernel.rotate(kernel.extrude(poly, len), [90, 0, 0]); // Y ∈ [−len, 0]
  return kernel.translate(prism, [0, y0 - EPS + len, 0]);
}

function hasWedges(g: Geom): boolean {
  return g.wedges && g.wedgeTop > 0 && g.wedgeDepth > 0;
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
      if (wedges) for (const side of wedgeSidesOf(f)) out.push(wedgeCutter(kernel, f, side, g));
      return out;
    },
    cellDraw(f) {
      const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
      if (wedges) {
        const cx = f.x + f.width / 2;
        for (const side of wedgeSidesOf(f)) {
          const { y0, t } = wallSpan(f, side);
          out.push({ kind: 'rect', role: 'notch', x: cx - g.wedgeTop / 2, y: y0, w: g.wedgeTop, h: t });
        }
      }
      return out;
    },
  };
}

export const cardTrayUpright: BoxTypeDefinition = {
  id: 'card-tray-upright',
  name: 'Card tray (upright)',
  description: 'Standing card stacks side by side, with wedges in the long walls to grab the cards.',
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
      help: 'Cut a wedge into the top of both long outer walls of every stack, to grab the cards.',
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
      help: 'Width of the wedge at the wall top; 0 = auto (60 % of the stack slot width).',
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
      help: 'How far the wedge reaches down from the wall top; 0 = auto (60 % of the inner height).',
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
      if (g.wedgeBottomRaw > 0 && g.wedgeBottom > g.wedgeTop) {
        problems.push(`Wedge bottom width (${round(g.wedgeBottom)} mm) must not exceed the top width (${round(g.wedgeTop)} mm).`);
      }
      // Leave a post at least max(wall, 1) mm wide on both sides of the wedge (between neighbours and at the ends).
      const post = Math.max(item.wall, 1);
      const maxTop = g.width - 2 * post;
      if (g.wedgeTopRaw > 0 && g.wedgeTop >= maxTop) {
        problems.push(
          `Wedge top width (${round(g.wedgeTop)} mm) must be smaller than ${round(maxTop)} mm (the stack slot width ${round(g.width)} mm minus ${round(post)} mm on each side) so wall remains between the wedges.`,
        );
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
