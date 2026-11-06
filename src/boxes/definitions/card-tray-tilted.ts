/**
 * Card tray (tilted): a card dispenser. Each cell holds a standing card stack
 * leaning back by `tiltAngle` onto the back wall (the wall at X = 0); the
 * front (+X) is cut down to `frontHeight` so the cards are exposed and a thumb
 * pushes the front card forward and out. Lanes repeat along Y (rows).
 *
 * The part is chiral: the cards always lean towards −X, so its mirror image
 * (leaning towards +X) is a different part. The layout only knows the
 * rotations 0 and 90, so in the game box the cards lean towards −x
 * (rotation 0) or −y (rotation 90), never +x / +y.
 *
 * Geometry per cell, in the XZ plane (θ = tiltAngle, T = stackHeight + c,
 * H = inner height, z measured from the cavity floor floorZ):
 *
 *   H          = (cardHeight − exposedHeight)·cos θ
 *   s          = T / cos θ                       slot width, horizontal
 *   x_back(z)  = wall + (H − z)·tan θ            back face of the slot
 *   cell width = H·tan θ + s                     axis aligned, x ∈ [wall, wall + width]
 *
 * The slot is the box T × (cardWidth + 2c) × L rotated by −θ about Y (its top
 * goes towards −X) with its lowest corner at (x_back(0), y, floorZ): the
 * slot floor is tilted too, the cards stand on it with their bottom edge
 * against the back face. The back wall is `wall` thick at the wall top and
 * thicker below. The slot is not clipped above the wall top, so with a
 * stacking lip and a steep angle it notches the back lip where the cards
 * lean over it (otherwise the cards would rest on the lip).
 *
 * Front opening: everything in front of the slot's front face plane above
 * floorZ + frontHeight is removed, within the cell's Y range only (flush at
 * dividers and side walls), through the front outer wall and its lip. Below
 * frontHeight the material in front of the slot holds the stack.
 */
import type { BearingArea, BoxTypeDefinition, KeepOut, TopViewFeature } from '../types';
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
  validateCards,
  type LocalRect,
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

export const MIN_TILT = 5;
export const MAX_TILT = 40;

/** Derived geometry of one cell (see the file comment). */
export function tiltedGeom(item: ResolvedItem) {
  const cards = cardDims(item);
  const c = cards.clearance;
  const tilt = num(item, 'tiltAngle', 15);
  const exposed = num(item, 'exposedHeight', 20);
  const frontHeight = num(item, 'frontHeight', 20);
  const th = (tilt * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const tan = Math.tan(th);
  /** Slot thickness across the cards (perpendicular to them). */
  const T = cards.stackHeight + c;
  const H = (cards.cardHeight - exposed) * cos;
  const s = T / cos;
  return {
    cards,
    tilt,
    exposed,
    frontHeight,
    th,
    cos,
    sin,
    tan,
    T,
    H,
    s,
    width: H * tan + s,
    depth: cards.cardWidth + 2 * c,
  };
}

type Geom = ReturnType<typeof tiltedGeom>;

/** X where the slot's front face plane meets z = floorZ + frontHeight: the front opening starts here. */
function cutX(f: CellFrame, g: Geom): number {
  return f.x + f.width - g.frontHeight * g.tan;
}

/** The tilted slot (local box rotated by −θ about Y, lowest corner at (x_back(0), y, floorZ)). */
function slotCutter(kernel: GeometryKernel, f: CellFrame, g: Geom): Solid {
  const L = (f.height + f.lipH + 1) / g.cos + g.T * g.tan;
  const local = kernel.box(g.T, f.depth, L);
  return kernel.translate(kernel.rotate(local, [0, -g.tilt, 0]), [f.x + g.H * g.tan, f.y, f.floorZ]);
}

/**
 * Front opening: the half space in front of the slot's front face plane
 * (a big rotated box), intersected with the cell's Y range from
 * floorZ + frontHeight up past the top, to EPS beyond the front outer face.
 */
function frontCutter(kernel: GeometryKernel, f: CellFrame, g: Geom, outerW: number): Solid {
  const big = outerW + f.topZ + f.lipH + g.T + 10;
  const local = kernel.box(big, f.depth + 2, 2 * big, [g.T, -1, -big]);
  const half = kernel.translate(kernel.rotate(local, [0, -g.tilt, 0]), [f.x + g.H * g.tan, f.y, f.floorZ]);
  const z0 = f.floorZ + g.frontHeight;
  const x0 = f.x;
  const clip = kernel.box(outerW + EPS - x0, f.depth, f.topZ + f.lipH + EPS - z0, [x0, f.y, z0]);
  return kernel.intersection([half, clip]);
}

/** True when the tilted slot reaches into the back lip ring (outer half of the back wall). */
function notchesBackLip(f: CellFrame, g: Geom, wall: number): boolean {
  return f.lipH > 0 && f.lipH * g.tan > wall / 2;
}

/** r minus cut, as up to four non‑overlapping rects. */
function subtractRect<R extends LocalRect>(r: R, cut: LocalRect): R[] {
  const x0 = Math.max(r.x, cut.x);
  const x1 = Math.min(r.x + r.width, cut.x + cut.width);
  const y0 = Math.max(r.y, cut.y);
  const y1 = Math.min(r.y + r.depth, cut.y + cut.depth);
  if (!(x1 - x0 > 1e-9 && y1 - y0 > 1e-9)) return [r];
  const out: R[] = [
    { ...r, depth: y0 - r.y },
    { ...r, y: y1, depth: r.y + r.depth - y1 },
    { ...r, y: y0, depth: y1 - y0, width: x0 - r.x },
    { ...r, x: x1, y: y0, depth: y1 - y0, width: r.x + r.width - x1 },
  ];
  return out.filter((p) => p.width > 1e-9 && p.depth > 1e-9);
}

/**
 * Tiling spec: one cell = one tilted lane, (H·tan θ + s) (X) × cardWidth + 2c
 * (Y) × H (Z), repeated along Y (rows). The dividers between lanes are plain
 * walls parallel to X (straight dividers).
 */
function spec(item: ResolvedItem): TiledBoxSpec {
  const g = tiltedGeom(item);
  const base = {
    ...tilingOf(item, 'y'),
    cell: { width: g.width, depth: g.depth, height: g.H },
    wall: item.wall,
    floor: item.floor,
    stacking: stacking(item),
    dividerHeight: num(item, 'dividerHeight'),
    straightDividers: true,
  };
  const outerW = 2 * item.wall + g.width;
  return {
    ...base,
    cellCutters(kernel, f) {
      return [slotCutter(kernel, f, g), frontCutter(kernel, f, g, outerW)];
    },
    cellDraw(f) {
      const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }];
      const x0 = cutX(f, g);
      // Shelf in front of the slot (the front wall cut down to frontHeight), inside the cell…
      if (f.x + f.width - x0 > 1e-9) out.push({ kind: 'rect', role: 'solid', x: x0, y: f.y, w: f.x + f.width - x0, h: f.depth });
      // …and the gap it leaves in the front outer wall.
      out.push({ kind: 'rect', role: 'notch', x: f.x + f.width, y: f.y, w: f.sides.right, h: f.depth });
      return out;
    },
  };
}

/**
 * Bearing areas: the framework's (outer ring, dividers) minus the front
 * opening of every lane, plus the cut‑down front as a 'low' shelf at
 * floorZ + frontHeight; where the slot notches the back lip, that lip piece
 * becomes 'low' too (solid, carries nothing).
 */
function bearingAreas(item: ResolvedItem): BearingArea[] {
  const sp = spec(item);
  const g = tiltedGeom(item);
  const L = tiledLayout(sp);
  let areas = tiledBearingAreas(sp);
  const extra: BearingArea[] = [];
  for (const f of cellFrames(sp)) {
    const x0 = cutX(f, g);
    const front = { x: x0, y: f.y, width: L.width - x0, depth: f.depth };
    areas = areas.flatMap((a) => subtractRect(a, front));
    extra.push({ ...front, height: f.floorZ + g.frontHeight, role: 'low', name: 'front wall' });
    if (notchesBackLip(f, g, sp.wall)) {
      const back = { x: 0, y: f.y, width: sp.wall / 2, depth: f.depth };
      areas = areas.flatMap((a) => {
        if (a.role !== 'lip') return [a];
        const rest = subtractRect(a, back);
        if (rest.length === 1 && rest[0] === a) return [a];
        const x = Math.max(a.x, back.x);
        const y = Math.max(a.y, back.y);
        const cut: BearingArea = {
          ...a,
          x,
          y,
          width: Math.min(a.x + a.width, back.x + back.width) - x,
          depth: Math.min(a.y + a.depth, back.y + back.depth) - y,
          role: 'low',
        };
        return [...rest, cut];
      });
    }
  }
  return [...areas, ...extra];
}

/**
 * The cards above the outer top, per lane. The back card's back face leaves
 * the slot at x = wall (the wall top) and leans back to
 * x = wall − exposed·sin θ at its top edge (may be < 0: the cards overhang
 * the back of the footprint; the layout maps and overlaps keep‑out rects
 * generically, so this is not clamped). The front card's front face is at
 * x = wall + s at the wall top. The highest card corner is the front card's
 * top: it stands stackHeight·sin θ higher on the tilted slot floor, so the
 * cards reach exposed·cos θ + stackHeight·sin θ above the wall top.
 */
function keepOut(item: ResolvedItem): KeepOut[] {
  const g = tiltedGeom(item);
  if (!(g.H > 0) || !(g.tilt > 0)) return [];
  const sp = spec(item);
  const L = tiledLayout(sp);
  const height = g.exposed * g.cos + g.cards.stackHeight * g.sin - L.lipH;
  if (!(height > 0)) return [];
  const back = g.exposed * g.sin;
  return cellFrames(sp).map((f) => ({
    x: f.x - back,
    y: f.y,
    width: g.s + back,
    depth: f.depth,
    height,
    name: 'standing cards',
    fix: 'lower the exposed height',
  }));
}

export const cardTrayTilted: BoxTypeDefinition = {
  id: 'card-tray-tilted',
  name: 'Card tray (tilted)',
  description: 'Standing card stacks leaning back with an open front: works as a card dispenser during play.',
  params: [
    ...cardParams,
    {
      key: 'tiltAngle',
      label: 'Tilt angle (°)',
      kind: 'number',
      default: 15,
      min: MIN_TILT,
      max: MAX_TILT,
      step: 1,
      group: 'Dispenser',
      help: 'How far the cards lean back from vertical, in degrees.',
    },
    {
      key: 'exposedHeight',
      label: 'Exposed height',
      kind: 'number',
      default: 20,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Dispenser',
      help: 'How much of the card length sticks out above the walls.',
    },
    {
      key: 'frontHeight',
      label: 'Front wall height',
      kind: 'number',
      default: 20,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Dispenser',
      help: 'Height of the front wall above the floor; above it the front is open so the cards can be pushed out.',
    },
    ...tilingParams('y'),
    { ...dividerHeightParam, visibleIf: (p) => Number(p.rows) > 1 },
    ...stackingParams,
  ],
  newItemParams: { ...stackingNewItemParams },

  footprint: (item) => tiledFootprint(spec(item)),
  build: (item, kernel) => tiledBuild(kernel, spec(item)),
  draw: (item) => tiledDraw(spec(item)),

  validate(item) {
    const g = tiltedGeom(item);
    const problems: string[] = [];
    validateCards(problems, g.cards);
    if (!(g.tilt >= MIN_TILT && g.tilt <= MAX_TILT)) {
      problems.push(`Tilt angle must be between ${MIN_TILT}° and ${MAX_TILT}° (is ${g.tilt}°).`);
    }
    if (g.exposed < 0) problems.push(`Exposed height must not be negative (is ${g.exposed}).`);
    if (!(g.exposed < g.cards.cardHeight)) {
      problems.push(`Exposed height (${g.exposed} mm) must be smaller than the card height (${g.cards.cardHeight} mm).`);
    }
    if (g.frontHeight < 0) problems.push(`Front wall height must not be negative (is ${g.frontHeight}).`);
    else if (g.H > 0 && !(g.frontHeight < g.H)) {
      problems.push(`Front wall height (${g.frontHeight} mm) must be lower than the inner height (${round(g.H)} mm).`);
    }
    tiledValidate(problems, spec(item));
    return problems;
  },

  stackEngagement,
  bearingAreas,
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),
  keepOut,
};
