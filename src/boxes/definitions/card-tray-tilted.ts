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
 *   overhang     = exposedHeight·sin θ           how far the exposed cards lean back
 *   back         = overhang + overhangClearance  extra back wall at the top
 *   x_back_i(z)  = wall + back + i·pitchX + (H − z)·tan θ   back face of slot i
 *   cell width   = back + H·tan θ + s            axis aligned (> pitchX: the
 *                                                bounding boxes overlap, the slots do not)
 *   outer width  = 2·wall + (n − 1)·pitchX + cell width
 *
 * The slot is the box T × (cardWidth + 2c) × L rotated by −θ about Y (its top
 * goes towards −X) with its lowest corner at (x_back_i(0), y, floorZ): the
 * slot floor is tilted too, the cards stand on it with their bottom edge
 * against the back face. Between slot i and slot i + 1 stands a tilted
 * divider, t thick perpendicular to the cards (t / cos θ horizontally),
 * always full height. The back wall is `wall + back` thick at the wall top
 * and thicker below, so the exposed cards of slot 0, leaning back by
 * `overhang` above the top, stay `overhangClearance` inside the footprint
 * (the cards of slot i > 0 lean over slot i − 1, inside the part anyway).
 * Slot 0 is not clipped above the wall top, so with a stacking lip, a steep
 * angle and a small `back` it may notch the back lip where the cards lean
 * over it (otherwise the cards would rest on the lip).
 *
 * Front opening (last cell only): everything in front of slot n − 1's front
 * face plane above floorZ + frontHeight is removed, within the lane's Y range
 * only (flush at the side walls), through the front outer wall and its lip.
 * Below frontHeight the material in front of the slot holds the stack.
 *
 * Hollow back (`hollowBack`, cell 0 only): the solid back wedge becomes a
 * leaning plate `wall` thick (perpendicular) behind slot 0, the vertical outer
 * back wall (`wall`) and a pocket between them, from floorZ up to a flat roof
 * `wall` thick under the top face, running through both side walls (see
 * `pocketProfile`; skipped when it would be thinner than 1 mm).
 *
 * Wedges (group "Wedge", sizes 0 = auto: top 60 % of the span cut across,
 * bottom 40 % of the top, depth 60 % of H clamped to H − T·sin θ − 1):
 * `wedgePlates` cuts a vertical YZ trapezoid, centred on the lane, from the
 * top of the plate behind every slot (the back block for slot 0, through the
 * back lip; the divider for i > 0), see `plateWedgeCutter`; `wedgeSides` cuts
 * a trapezoid in the slot's tilted frame from both side walls at every slot,
 * see `sideWedgeCutters`.
 */
import type { BearingArea, BoxTypeDefinition, KeepOut, TopViewFeature } from '../types';
import type { ItemParams, ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid, Vec2 } from '../../geometry/types';
import {
  AUTO_WEDGE_DEPTH,
  bool,
  cardDims,
  cardParams,
  EPS,
  MIN_RECESS_WALL,
  num,
  requirePositive,
  round,
  stackEngagement,
  stacking,
  type Stacking,
  stackingNewItemParams,
  stackingParams,
  validateCards,
  validateWedgeSizes,
  wedgeCutter,
  wedgeRaw,
  wedgeSize,
  type LocalRect,
} from './common';
import {
  cellFrames,
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
  const overhangClearance = num(item, 'overhangClearance', 2);
  const th = (tilt * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const tan = Math.tan(th);
  /** Slot thickness across the cards (perpendicular to them). */
  const T = cards.stackHeight + c;
  const H = (cards.cardHeight - exposed) * cos;
  const s = T / cos;
  const overhang = exposed * sin;
  const back = overhang + overhangClearance;
  const raw = wedgeRaw(item);
  /** Deepest wedge that stays 1 mm above the floor wedge under a slot (its front corner stands T·sin θ high). */
  const wedgeMaxDepth = H - T * sin - 1;
  const depth = cards.cardWidth + 2 * c;
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
    overhang,
    overhangClearance,
    back,
    width: back + H * tan + s,
    depth,
    hollowBack: bool(item, 'hollowBack', true),
    wedgePlates: bool(item, 'wedgePlates', true),
    wedgeSides: bool(item, 'wedgeSides', false),
    wedgeRaw: raw,
    /** Plate wedges are cut across the lane (Y span), side wedges across the slot (T, perpendicular to the cards). */
    plateWedge: wedgeSize(raw, depth),
    sideWedge: wedgeSize(raw, T),
    wedgeMaxDepth,
    /** Auto: 60 % of H, clamped to wedgeMaxDepth (only bites at steep tilts with thick stacks). */
    wedgeDepth: raw.depth > 0 ? raw.depth : Math.min(AUTO_WEDGE_DEPTH * H, wedgeMaxDepth),
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
 * origin at the slot's lowest back corner (x_back(0) = f.x + back + H·tan θ, y, floorZ).
 */
function tiltedBox(kernel: GeometryKernel, f: CellFrame, g: Geom, size: [number, number, number], at: [number, number, number]): Solid {
  return toSlotFrame(kernel, f, g, kernel.box(size[0], size[1], size[2], at));
}

/**
 * A solid given in the slot's local frame (x across the cards from the back
 * face, y along the lane from f.y, z along the cards from the slot's lowest
 * back corner), rotated by −θ about Y — local +x becomes v = (cos θ, 0, sin θ),
 * local +z becomes u = (−sin θ, 0, cos θ) — and moved to that corner.
 */
function toSlotFrame(kernel: GeometryKernel, f: CellFrame, g: Geom, local: Solid): Solid {
  return kernel.translate(kernel.rotate(local, [0, -g.tilt, 0]), [f.x + g.back + g.H * g.tan, f.y, f.floorZ]);
}

/** A polygon in the XZ plane ((x, z) pairs) extruded along Y over [y0, y1] (rotate +90° about X: (u, v, w) → (u, −w, v)). */
function extrudeXZ(kernel: GeometryKernel, poly: Vec2[], y0: number, y1: number): Solid {
  return kernel.translate(kernel.rotate(kernel.extrude(poly, y1 - y0), [90, 0, 0]), [0, y1, 0]);
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
 * Profile of the hollow back pocket in the XZ plane (cell 0 only), as (x, z)
 * pairs counter‑clockwise, or null when the pocket would be thinner than
 * 1 mm anywhere (then the back stays solid). The leaning plate behind slot 0
 * is `wall` thick perpendicular to the cards, so its back face is
 * x_back_0(z) − wall / cos θ; the pocket lies between the inner face of the
 * outer back wall (x = wall) and that plate, from `zBottom` (default floorZ:
 * the structural floor stays; with a recessed base the caller raises it to
 * the recess top + MIN_RECESS_WALL so the hole through the side walls never
 * opens into the recess ring) to topZ − wall (a flat roof `wall` thick under
 * the top face). It is narrowest at the roof: back + wall·tan θ − wall / cos θ,
 * so a small `back` (little exposed card, no clearance) or a steep tilt with
 * a thick wall skips it.
 */
export function pocketProfile(g: Geom, wall: number, floorZ: number, topZ: number, zBottom = floorZ): Vec2[] | null {
  const plateBack = (z: number) => wall + g.back + (g.H - (z - floorZ)) * g.tan - wall / g.cos;
  const z0 = Math.max(floorZ, zBottom);
  const z1 = topZ - wall;
  if (!(z1 - z0 >= 1) || !(plateBack(z1) - wall >= 1)) return null;
  return [
    [wall, z0],
    [plateBack(z0), z0],
    [plateBack(z1), z1],
    [wall, z1],
  ];
}

/** Bottom of the pocket: the cavity floor, or the recess top + MIN_RECESS_WALL when the base is recessed. */
function pocketBottom(floorZ: number, s: Stacking): number {
  return Math.max(floorZ, s.recessDepth > 0 ? s.plugH + s.recessDepth + MIN_RECESS_WALL : 0);
}

/**
 * Plate wedge of cell i: a trapezoid in the YZ plane centred on the lane,
 * extruded along X over the plate behind slot i (cell 0: from the outer back
 * face through the back wall, the pocket and the leaning plate, and through
 * the back lip; cell i > 0: the tilted divider between slot i − 1 and slot i),
 * from x_back_i(H) − pitch (i > 0) or 0 (i = 0) to x_back_i(zBot) + EPS.
 * The neighbouring slots are air; the box is clipped to the slab between
 * slot i − 1's back face and slot i's front face (slot i's local
 * x ∈ [−pitch·cos θ, T]; for cell 0 everything behind slot 0's front face),
 * so it never reaches divider i or the last cell's front stub, however steep
 * the tilt. Its bottom stays above the floor wedges under the slots
 * (depth ≤ H − T·sin θ − 1).
 */
function plateWedgeCutter(kernel: GeometryKernel, f: CellFrame, g: Geom, pitch: number, outerW: number): Solid {
  const xBack = (z: number) => f.x + g.back + (f.topZ - z) * g.tan;
  const zBot = f.topZ - g.wedgeDepth;
  const x0 = f.outer.left ? 0 : xBack(f.topZ) - pitch;
  const x1 = xBack(zBot) + EPS;
  const prism = wedgeCutter(kernel, {
    across: 'x',
    a0: x0,
    t: x1 - x0,
    c: f.y + f.depth / 2,
    size: g.plateWedge,
    zTop: f.topZ,
    zBot,
    zCap: f.topZ + f.lipH + EPS,
  });
  const big = outerW + f.topZ + f.lipH + g.T + 10;
  const lo = f.outer.left ? -big : -pitch * g.cos;
  const slab = tiltedBox(kernel, f, g, [g.T - lo, f.depth + 2, 2 * big], [lo, -1, -big]);
  return kernel.intersection([prism, slab]);
}

/**
 * Side wedges of one cell: a trapezoid in the slot's tilted frame, `top`
 * wide along v (across the stack) and reaching `depth` down along −u (along
 * the cards), centred on the slot's top opening: its top edge passes through
 * the point where the slot's mid plane (local x = T/2) meets the wall top,
 * local z_c = (H − (T/2)·sin θ) / cos θ. Above that edge it continues along u
 * through the wall top and the lip (to topZ + lipH + EPS everywhere), so at the
 * wall top the cut is top / cos θ wide horizontally, centred on
 * x_back_i(H) + s/2. Extruded along Y through each side wall (+EPS outside
 * and into the lane, which is slot air there). Stays inside the slot's local
 * x range [0, T] (top < T − 2·post), so it never touches a divider.
 */
function sideWedgeCutters(kernel: GeometryKernel, f: CellFrame, g: Geom): Solid[] {
  const tw = g.sideWedge.top / 2;
  const bw = g.sideWedge.bottom / 2;
  const cx = g.T / 2;
  const zc = (g.H - cx * g.sin) / g.cos;
  const zb = zc - g.wedgeDepth;
  const zCap = (f.height + f.lipH + 2 * EPS - (cx - tw) * g.sin) / g.cos;
  const poly: Vec2[] =
    bw > 0
      ? [
          [cx - bw, zb],
          [cx + bw, zb],
          [cx + tw, zc],
          [cx + tw, zCap],
          [cx - tw, zCap],
          [cx - tw, zc],
        ]
      : [
          [cx, zb],
          [cx + tw, zc],
          [cx + tw, zCap],
          [cx - tw, zCap],
          [cx - tw, zc],
        ];
  return [
    toSlotFrame(kernel, f, g, extrudeXZ(kernel, poly, -f.sides.front - EPS, EPS)),
    toSlotFrame(kernel, f, g, extrudeXZ(kernel, poly, f.depth - EPS, f.depth + f.sides.back + EPS)),
  ];
}

/** Whether the wedges have a size at all (the toggles are checked separately). */
function wedgesSized(g: Geom): boolean {
  return g.wedgeDepth > 0 && g.plateWedge.top > 0 && g.sideWedge.top > 0;
}

/**
 * True when the tilted slot reaches into the back lip ring (outer half of the
 * back wall): its back face at the lip top, wall + back − lipH·tan θ, lies
 * below wall / 2.
 */
function notchesBackLip(f: CellFrame, g: Geom, wall: number): boolean {
  return f.lipH > 0 && f.lipH * g.tan - g.back > wall / 2;
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
 * Tiling spec: one cell = one tilted slot plus the extra back wall,
 * (back + H·tan θ + s) (X) × cardWidth + 2c (Y) × H (Z), stepped along X
 * (columns) with pitch s + t / cos θ. Only cell 0's `back` strip is really
 * solid at the top; in the other cells it overlaps the previous slot. The
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
    straightDividers: false,
  };
  const L = tiledLayout({ ...base, cellCutters: () => [], cellDraw: () => [] });
  const plates = g.wedgePlates && wedgesSized(g);
  const sides = g.wedgeSides && wedgesSized(g);
  return {
    ...base,
    cellCutters(kernel, f) {
      const out = [slotCutter(kernel, f, g)];
      if (f.outer.right) out.push(frontCutter(kernel, f, g, L.width));
      if (f.outer.left && g.hollowBack) {
        const poly = pocketProfile(g, base.wall, f.floorZ, f.topZ, pocketBottom(f.floorZ, base.stacking));
        if (poly) out.push(extrudeXZ(kernel, poly, -EPS, L.depth + EPS));
      }
      if (plates) out.push(plateWedgeCutter(kernel, f, g, pitch, L.width));
      if (sides) out.push(...sideWedgeCutters(kernel, f, g));
      return out;
    },
    cellDraw(f) {
      const xTop = f.x + g.back; // x_back_i(H): the slot's back face at the wall top
      const out: TopViewFeature[] = [];
      if (!f.outer.right) {
        out.push(
          { kind: 'rect', role: 'cavity', x: xTop, y: f.y, w: g.s, h: f.depth },
          // The tilted divider in front of this slot, at the wall top.
          { kind: 'rect', role: 'divider', x: xTop + g.s, y: f.y, w: pitch - g.s, h: f.depth },
        );
      } else {
        // Last cell: the slot is open from above up to where the front opening
        // ends (x0), then the shelf at frontHeight, then the gap in the front wall.
        const x0 = Math.max(cutX(f, g), xTop + g.s);
        out.push({ kind: 'rect', role: 'cavity', x: xTop, y: f.y, w: x0 - xTop, h: f.depth });
        if (f.x + f.width - x0 > 1e-9) out.push({ kind: 'rect', role: 'solid', x: x0, y: f.y, w: f.x + f.width - x0, h: f.depth });
        out.push({ kind: 'rect', role: 'notch', x: f.x + f.width, y: f.y, w: f.sides.right, h: f.depth });
      }
      if (plates) {
        // The plate behind the slot at the wall top: the whole back (outer face to slot 0) or the divider.
        const x0 = f.outer.left ? 0 : xTop - pitch + g.s;
        const top = g.plateWedge.top;
        out.push({ kind: 'rect', role: 'notch', x: x0, y: f.y + f.depth / 2 - top / 2, w: xTop - x0, h: top });
      }
      if (sides) {
        const w = g.sideWedge.top / g.cos;
        const x = xTop + g.s / 2 - w / 2;
        out.push(
          { kind: 'rect', role: 'notch', x, y: f.y - f.sides.front, w, h: f.sides.front },
          { kind: 'rect', role: 'notch', x, y: f.y + f.depth, w, h: f.sides.back },
        );
      }
      return out;
    },
  };
}

/**
 * Bearing areas: the framework's outer ring minus the front opening of the
 * last cell, plus the cut‑down front as a 'low' shelf at floorZ + frontHeight,
 * plus every tilted divider's top at the wall top (x from slot i's front
 * face to slot i + 1's back face) and the extra back wall strip
 * (wall … wall + back) at the wall top; where slot 0 notches the back lip,
 * that lip piece becomes 'low' (solid, carries nothing).
 */
function bearingAreas(item: ResolvedItem): BearingArea[] {
  const sp = spec(item);
  const g = tiltedGeom(item);
  const L = tiledLayout(sp);
  let areas = tiledBearingAreas(sp);
  const extra: BearingArea[] = [];
  for (const f of cellFrames(sp)) {
    if (f.outer.left && g.back > 1e-9) {
      extra.push({ x: f.x, y: f.y, width: g.back, depth: f.depth, height: f.topZ, role: 'bearing', name: 'back wall' });
    }
    if (f.outer.right) {
      const x0 = cutX(f, g);
      const front = { x: x0, y: f.y, width: L.width - x0, depth: f.depth };
      areas = areas.flatMap((a) => subtractRect(a, front));
      extra.push({ ...front, height: f.floorZ + g.frontHeight, role: 'low', name: 'front wall' });
    } else {
      // At the wall top the divider spans [x_back_i(H) + s, x_back_i(H) + pitch].
      extra.push({ x: f.x + g.back + g.s, y: f.y, width: L.pitchX - g.s, depth: f.depth, height: f.topZ, role: 'bearing', name: 'divider' });
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
 * x_back_i(H) − overhang at its top edge: for slot 0 that is
 * wall + overhangClearance, inside the footprint (the back wall grows by
 * `back` for that); slots i > 0 overhang the previous slot, which is the same
 * part. The front card's front face is
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
  return cellFrames(sp).map((f) => ({
    x: f.x + g.back - g.overhang,
    y: f.y,
    width: g.s + g.overhang,
    depth: f.depth,
    height,
    name: 'standing cards',
    fix: 'lower the exposed height',
  }));
}

/** The wedge size params are shown when either toggle is on. */
const wedgesOn = (p: ItemParams): boolean => p.wedgePlates !== false || p.wedgeSides === true;

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
    {
      key: 'overhangClearance',
      label: 'Clearance behind the cards',
      kind: 'number',
      default: 2,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Dispenser',
      help: 'Extra space kept behind the leaning cards, added to the back wall.',
    },
    {
      key: 'hollowBack',
      label: 'Hollow back',
      kind: 'boolean',
      default: true,
      group: 'Dispenser',
      help: 'A pocket in the solid back wedge, open through the side walls, to save material; its roof is a short bridge.',
    },
    ...tilingParams('x'),
    {
      key: 'wedgePlates',
      label: 'Wedges in the leaning plates',
      kind: 'boolean',
      default: true,
      group: 'Wedge',
      help: 'A trapezoid cut from the top edge of the back plate and every divider, so you pinch the deck front and back.',
    },
    {
      key: 'wedgeSides',
      label: 'Wedges in the side walls',
      kind: 'boolean',
      default: false,
      group: 'Wedge',
      help: 'A cut in both side walls at each slot, so you pinch the deck across its width.',
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
      help: 'Width of the wedge at the wall top; 0 = auto (60 % of the span it is cut across: the lane width for the plates, the slot thickness for the side walls).',
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
      help: 'How far the wedge reaches down from the wall top (along the cards in the side walls); 0 = auto (60 % of the inner height, kept 1 mm above the floor under the slots).',
      visibleIf: wedgesOn,
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
    if (g.overhangClearance < 0) problems.push(`Clearance behind the cards must not be negative (is ${g.overhangClearance}).`);
    if (g.frontHeight < 0) problems.push(`Front wall height must not be negative (is ${g.frontHeight}).`);
    else if (g.H > 0 && !(g.frontHeight < g.H)) {
      problems.push(`Front wall height (${g.frontHeight} mm) must be lower than the inner height (${round(g.H)} mm).`);
    }
    if (g.wedgePlates || g.wedgeSides) {
      const sets = [];
      if (g.wedgePlates) sets.push({ size: g.plateWedge, span: g.depth, what: 'the lane width' });
      if (g.wedgeSides) sets.push({ size: g.sideWedge, span: g.T, what: 'the slot thickness' });
      validateWedgeSizes(problems, g.wedgeRaw, item.wall, sets);
      if (g.wedgeRaw.depth > 0 && g.H > 0 && g.wedgeRaw.depth > g.wedgeMaxDepth) {
        problems.push(
          `Wedge depth (${round(g.wedgeRaw.depth)} mm) must not exceed ${round(g.wedgeMaxDepth)} mm (the inner height ${round(g.H)} mm minus the floor under the slots, ${round(g.T * g.sin)} mm, minus 1 mm).`,
        );
      }
    }
    const sp = spec(item);
    const L = tiledLayout(sp);
    // The pitch is explicit, so the framework does not check the divider itself.
    if (L.cols > 1) requirePositive(problems, 'Divider thickness', sp.divider);
    tiledValidate(problems, sp);
    return problems;
  },

  stackEngagement,
  bearingAreas,
  baseFeatures: (item) => tiledBaseFeatures(spec(item)),
  keepOut,
};
