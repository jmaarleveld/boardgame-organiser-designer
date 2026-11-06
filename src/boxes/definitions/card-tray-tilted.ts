/**
 * Card tray (tilted): a card display / dispenser. Each cell holds a standing
 * card stack leaning back by `tiltAngle` towards X = 0; the cells are stepped
 * one behind the other along X (columns), cell 0 at the back. The front
 * outer wall (+X) is cut down to `frontHeight` so the front deck is exposed
 * and a thumb pushes its front card forward and out.
 *
 * The part is chiral: the cards always lean towards −X, so its mirror image
 * (leaning towards +X) is a different part. The layout only knows the
 * rotations 0 and 90, so in the game box the cards lean towards −x
 * (rotation 0) or −y (rotation 90), never +x / +y.
 *
 * Geometry, in the XZ plane (θ = tiltAngle, T = stackHeight + c,
 * t = dividerThickness, H = inner height, z measured from the cavity floor
 * floorZ, cell i = 0 … n − 1):
 *
 *   H            = (cardHeight − exposedHeight)·cos θ
 *   s            = T / cos θ                     slot width, horizontal
 *   pitchX       = s + t / cos θ                 slot to slot along X
 *   x_back_i(z)  = wall + i·pitchX + (H − z)·tan θ   back face of slot i
 *   cell width   = H·tan θ + s                   axis aligned (> pitchX: the
 *                                                bounding boxes overlap, the slots do not)
 *   outer width  = 2·wall + (n − 1)·pitchX + cell width
 *
 * The slot is the box T × (cardWidth + 2c) × L rotated by −θ about Y (its top
 * goes towards −X) with its lowest corner at (x_back_i(0), y, floorZ): the
 * slot floor is tilted too, the cards stand on it with their bottom edge
 * against the back face. Between slot i and slot i + 1 stands a tilted
 * divider, t thick perpendicular to the cards (t / cos θ horizontally). The
 * back wall is `wall` thick at the wall top and thicker below. Slot 0 is not
 * clipped above the wall top, so with a stacking lip and a steep angle it
 * notches the back lip where the cards lean over it (otherwise the cards
 * would rest on the lip).
 *
 * `dividerHeight` (0 = full height) lowers every tilted divider: the material
 * between slot i's front face and slot i + 1's back face above
 * floorZ + dividerHeight is cut (clipped to the inner lane, so the outer walls
 * and the lip are never touched). Trade‑off: with full dividers every deck
 * leans on its own divider and is separated from its neighbours, but only the
 * top `exposedHeight` of each deck is reachable; lowered to about
 * `frontHeight` the tray becomes a terraced display where each deck leans on
 * the deck behind it (more of every card visible and easier to grab, but
 * pulling a back card drags on the deck in front, and the decks are no longer
 * held apart above the divider).
 *
 * Front opening (last cell only): everything in front of slot n − 1's front
 * face plane above floorZ + frontHeight is removed, within the lane's Y range
 * only (flush at the side walls), through the front outer wall and its lip.
 * Below frontHeight the material in front of the slot holds the stack.
 */
import type { BearingArea, BoxTypeDefinition, KeepOut, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid } from '../../geometry/types';
import {
  cardDims,
  cardParams,
  EPS,
  num,
  requirePositive,
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

/** Slot pitch along X: s + t / cos θ (a divider of perpendicular thickness t between slots). */
export function tiltedPitch(item: ResolvedItem): number {
  const g = tiltedGeom(item);
  return g.s + tilingOf(item, 'x').divider / g.cos;
}

/** X where the slot's front face plane meets z = floorZ + frontHeight: the front opening starts here. */
function cutX(f: CellFrame, g: Geom): number {
  return f.x + f.width - g.frontHeight * g.tan;
}

/**
 * A box in the slot's local frame (x across the cards, from the slot's back
 * face; z along the cards), rotated by −θ about Y and placed with the local
 * origin at the slot's lowest back corner (x_back(0), y, floorZ).
 */
function tiltedBox(kernel: GeometryKernel, f: CellFrame, g: Geom, size: [number, number, number], at: [number, number, number]): Solid {
  const local = kernel.box(size[0], size[1], size[2], at);
  return kernel.translate(kernel.rotate(local, [0, -g.tilt, 0]), [f.x + g.H * g.tan, f.y, f.floorZ]);
}

/** The tilted slot. */
function slotCutter(kernel: GeometryKernel, f: CellFrame, g: Geom): Solid {
  const L = (f.height + f.lipH + 1) / g.cos + g.T * g.tan;
  return tiltedBox(kernel, f, g, [g.T, f.depth, L], [0, 0, 0]);
}

/**
 * Front opening: the half space in front of the slot's front face plane
 * (a big rotated box), intersected with the lane's Y range from
 * floorZ + frontHeight up past the top, to EPS beyond the front outer face.
 */
function frontCutter(kernel: GeometryKernel, f: CellFrame, g: Geom, outerW: number): Solid {
  const big = outerW + f.topZ + f.lipH + g.T + 10;
  const half = tiltedBox(kernel, f, g, [big, f.depth + 2, 2 * big], [g.T, -1, -big]);
  const z0 = f.floorZ + g.frontHeight;
  const x0 = f.x;
  const clip = kernel.box(outerW + EPS - x0, f.depth, f.topZ + f.lipH + EPS - z0, [x0, f.y, z0]);
  return kernel.intersection([half, clip]);
}

/**
 * Lowered divider behind slot i + 1 (cut by cell i): the slab between slot
 * i's front face and slot i + 1's back face (local x ∈ [T, T + t], EPS more
 * on both sides into the slots), above floorZ + dividerHeight, clipped to
 * the inner lane between the two cells so it cannot touch an outer wall or
 * the lip.
 */
function lowerDividerCutter(kernel: GeometryKernel, f: CellFrame, g: Geom, t: number, pitch: number, dividerTopZ: number): Solid {
  const big = f.height + f.lipH + g.T + 10;
  const slab = tiltedBox(kernel, f, g, [t + 2 * EPS, f.depth + 2, 2 * big], [g.T - EPS, -1, -big]);
  const clip = kernel.box(pitch + f.width, f.depth, f.topZ + EPS - dividerTopZ, [f.x, f.y, dividerTopZ]);
  return kernel.intersection([slab, clip]);
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

/** Tilted divider height above the floor actually used: 0 (full) unless 0 < dividerHeight < H. */
function loweredTo(item: ResolvedItem, g: Geom): number {
  const dh = num(item, 'dividerHeight');
  return dh > 0 && dh < g.H ? dh : 0;
}

/**
 * Tiling spec: one cell = one tilted slot, (H·tan θ + s) (X) × cardWidth + 2c
 * (Y) × H (Z), stepped along X (columns) with pitch s + t / cos θ. The
 * dividers are tilted (`straightDividers: false`): this type cuts, draws and
 * reports them itself.
 */
function spec(item: ResolvedItem): TiledBoxSpec {
  const g = tiltedGeom(item);
  const tiling = tilingOf(item, 'x');
  const pitch = g.s + tiling.divider / g.cos;
  const base: Omit<TiledBoxSpec, 'cellCutters' | 'cellDraw'> = {
    ...tiling,
    cell: { width: g.width, depth: g.depth, height: g.H, pitchX: pitch },
    wall: item.wall,
    floor: item.floor,
    stacking: stacking(item),
    dividerHeight: num(item, 'dividerHeight'),
    straightDividers: false,
  };
  const L = tiledLayout({ ...base, cellCutters: () => [], cellDraw: () => [] });
  const low = loweredTo(item, g);
  return {
    ...base,
    cellCutters(kernel, f) {
      const out = [slotCutter(kernel, f, g)];
      if (f.outer.right) out.push(frontCutter(kernel, f, g, L.width));
      else if (low > 0) out.push(lowerDividerCutter(kernel, f, g, tiling.divider, pitch, f.floorZ + low));
      return out;
    },
    cellDraw(f) {
      const xTop = f.x; // x_back_i(H): the slot's back face at the wall top
      if (!f.outer.right) {
        return [
          { kind: 'rect', role: 'cavity', x: xTop, y: f.y, w: g.s, h: f.depth },
          // The tilted divider in front of this slot, at the wall top.
          { kind: 'rect', role: 'divider', x: xTop + g.s, y: f.y, w: pitch - g.s, h: f.depth },
        ];
      }
      // Last cell: the slot is open from above up to where the front opening
      // ends (x0), then the shelf at frontHeight, then the gap in the front wall.
      const x0 = Math.max(cutX(f, g), xTop + g.s);
      const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: xTop, y: f.y, w: x0 - xTop, h: f.depth }];
      if (f.x + f.width - x0 > 1e-9) out.push({ kind: 'rect', role: 'solid', x: x0, y: f.y, w: f.x + f.width - x0, h: f.depth });
      out.push({ kind: 'rect', role: 'notch', x: f.x + f.width, y: f.y, w: f.sides.right, h: f.depth });
      return out;
    },
  };
}

/**
 * Bearing areas: the framework's outer ring minus the front opening of the
 * last cell, plus the cut‑down front as a 'low' shelf at floorZ + frontHeight,
 * plus every tilted divider's top (x from slot i's front face to slot
 * i + 1's back face at that height: 'bearing' at the wall top, 'low' at
 * floorZ + dividerHeight when lowered); where slot 0 notches the back lip,
 * that lip piece becomes 'low' too (solid, carries nothing).
 */
function bearingAreas(item: ResolvedItem): BearingArea[] {
  const sp = spec(item);
  const g = tiltedGeom(item);
  const L = tiledLayout(sp);
  const low = loweredTo(item, g);
  let areas = tiledBearingAreas(sp);
  const extra: BearingArea[] = [];
  for (const f of cellFrames(sp)) {
    if (f.outer.right) {
      const x0 = cutX(f, g);
      const front = { x: x0, y: f.y, width: L.width - x0, depth: f.depth };
      areas = areas.flatMap((a) => subtractRect(a, front));
      extra.push({ ...front, height: f.floorZ + g.frontHeight, role: 'low', name: 'front wall' });
    } else {
      // At height z the divider spans [x_back_i(z) + s, x_back_i(z) + pitch].
      const z = low > 0 ? low : f.height;
      const xb = f.x + (f.height - z) * g.tan;
      extra.push({
        x: xb + g.s,
        y: f.y,
        width: L.pitchX - g.s,
        depth: f.depth,
        height: f.floorZ + z,
        role: low > 0 ? 'low' : 'bearing',
        name: 'divider',
      });
    }
    if (f.outer.left && notchesBackLip(f, g, sp.wall)) {
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
 * The cards above the outer top, per slot. The back card's back face leaves
 * the slot at x = x_back_i(H) (the wall top) and leans back to
 * x_back_i(H) − exposed·sin θ at its top edge (for slot 0 this may be < 0:
 * the cards overhang the back of the footprint; the layout maps and overlaps
 * keep‑out rects generically, so this is not clamped; slots i > 0 overhang
 * the previous slot, which is the same part). The front card's front face is
 * at x_back_i(H) + s at the wall top. The highest card corner is the front
 * card's top: it stands stackHeight·sin θ higher on the tilted slot floor, so
 * the cards reach exposed·cos θ + stackHeight·sin θ above the wall top.
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
  description: 'Standing card stacks leaning back, stepped one behind the other, with an open front: a card display and dispenser during play.',
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
    ...tilingParams('x'),
    {
      ...dividerHeightParam,
      visibleIf: (p) => Number(p.columns) > 1,
      help: 'Height of the tilted dividers above the floor; 0 = full inner height. About the front wall height gives a terraced display where each deck leans on the deck behind it.',
    },
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
    const sp = spec(item);
    // The pitch is explicit, so the framework does not check the divider itself.
    if (tiledLayout(sp).cols > 1) requirePositive(problems, 'Divider thickness', sp.divider);
    tiledValidate(problems, sp);
    return problems;
  },

  stackEngagement,
  bearingAreas,
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),
  keepOut,
};
