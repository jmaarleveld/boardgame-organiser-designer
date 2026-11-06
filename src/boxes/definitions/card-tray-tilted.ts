/**
 * Card tray (tilted): a card display / dispenser. Each cell holds a standing
 * card stack leaning back by `tiltAngle` towards X = 0; the cells are stepped
 * one behind the other along X (columns), cell 0 at the back. The front
 * block (+X) has a trapezoid access opening cut from its top down to
 * `frontHeightPct` % of the wall height, so the front deck is exposed and a
 * thumb pushes its front card forward and out.
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
 * Front block (last cell, the mirror of the back): a full-height block
 * between slot n − 1's tilted front face x_front(z) = x_back_{n−1}(z) + s and
 * the vertical outer front face at X = W, `wall` thick at the floor and
 * wall + H·tan θ at the top; the lip ring runs all round. `hollowFront`
 * hollows it like the back: a leaning plate `wall` thick (perpendicular) in
 * front of the slot, the outer front wall (`wall`) and a pocket between them
 * (a downward pointing triangle, from where it is 1 mm wide, or above the
 * recess ring, up to a flat roof `wall` thick under the top face), open
 * through both side walls (see `frontPocketProfile`).
 *
 * Front opening (access): a trapezoid in the YZ plane, centred on the lane,
 * sized like the plate wedges (`wedgeTopWidth` / `wedgeBottomWidth`, auto
 * 60 % of the lane / 40 % of the top, whatever `wedgePlates` says), cut from
 * the top through the whole front block and its lip (outer wall, pocket,
 * plate) down to floorZ + frontHeight, frontHeight = frontHeightPct / 100 · H,
 * i.e. (1 − pct/100)·H deep from the wall top; see `frontOpeningCutter`. With
 * the hollow front the pocket keeps a `wall`-thick lining around it
 * (`wedgeLining`). The slot floor rises T·sin θ toward the front, so the
 * opening bottom stands pct·H − T·sin θ above the slot floor at the front;
 * it must stay ≥ 1 mm above it (validated). At 100 % (≥ 100 − 1e-9,
 * `frontClosed`) there is no opening at all.
 *
 * Hollow back (`hollowBack`, cell 0 only): the solid back wedge becomes a
 * leaning plate `wall` thick (perpendicular) behind slot 0, the vertical outer
 * back wall (`wall`) and a pocket between them, from floorZ up to a flat roof
 * `wall` thick under the top face, running through both side walls (see
 * `pocketProfile`; skipped when it would be thinner than 1 mm). With
 * `wedgePlates` the pocket keeps a `wall`-thick lining around the back wedge
 * (both slanted sides and the bottom, see `wedgeLining`), so the wedge cuts
 * through the whole back without opening into the pocket: the pocket splits
 * into a left and a right half, bridged by a flat ceiling under the wedge.
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
  const frontHeightPct = num(item, 'frontHeightPct', 50);
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
  /** Front wall height above floorZ in mm (frontHeightPct % of H). */
  const frontHeight = (frontHeightPct / 100) * H;
  return {
    cards,
    tilt,
    exposed,
    frontHeightPct,
    frontHeight,
    /** 100 %: no front opening, the front wall is a full wall with its lip. */
    frontClosed: frontHeightPct >= 100 - 1e-9,
    /** Depth of the front opening below the wall top. */
    frontOpeningDepth: H - frontHeight,
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
    hollowFront: bool(item, 'hollowFront', true),
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
 * Front opening of the last cell: the plate wedge trapezoid (centred on the
 * lane, top / bottom as `plateWedge`) from the wall top down to
 * floorZ + frontHeight, continuing up through the lip, extruded along X from
 * the slot's back face at the wall top to EPS beyond the front outer face and
 * clipped to the half space in front of the slot's back face plane (slot
 * local x ≥ 0), so it never reaches the divider behind the last slot.
 */
function frontOpeningCutter(kernel: GeometryKernel, f: CellFrame, g: Geom, outerW: number): Solid {
  const x0 = f.x + g.back;
  const prism = wedgeCutter(kernel, {
    across: 'x',
    a0: x0,
    t: outerW - x0,
    c: f.y + f.depth / 2,
    size: g.plateWedge,
    zTop: f.topZ,
    zBot: f.topZ - g.frontOpeningDepth,
    zCap: f.topZ + f.lipH + EPS,
  });
  const big = outerW + f.topZ + f.lipH + g.T + 10;
  const slab = tiltedBox(kernel, f, g, [big, f.depth + 2, 2 * big], [0, -1, -big]);
  return kernel.intersection([prism, slab]);
}

/**
 * Profile of the hollow front pocket in the XZ plane (last cell only), as
 * (x, z) pairs counter‑clockwise, or null when it would be less than 1 mm
 * high or wide. The leaning plate in front of the last slot is `wall` thick
 * perpendicular to the cards, so its front face is
 * x_front(z) + wall / cos θ = xIn − (z − floorZ)·tan θ + wall / cos θ, with
 * xIn = f.x + f.width the inner face of the outer front wall. The pocket lies
 * between them: (z − floorZ)·tan θ − wall / cos θ wide, a triangle pointing
 * down, cut off where it is 1 mm wide (or at `zBottom`, above the recess
 * ring), up to topZ − wall (a flat roof `wall` thick under the top face).
 */
export function frontPocketProfile(g: Geom, wall: number, xIn: number, floorZ: number, topZ: number, zBottom = floorZ): Vec2[] | null {
  if (!(g.tan > 0)) return null;
  const plateFront = (z: number) => xIn - (z - floorZ) * g.tan + wall / g.cos;
  const z0 = Math.max(zBottom, floorZ + (wall / g.cos + 1) / g.tan);
  const z1 = topZ - wall;
  if (!(z1 - z0 >= 1) || !(xIn - plateFront(z1) >= 1)) return null;
  return [
    [plateFront(z0), z0],
    [xIn, z0],
    [xIn, z1],
    [plateFront(z1), z1],
  ];
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
 * face through the back wall, the pocket roof and the leaning plate, and
 * through the back lip, the pocket keeping a lining around it, see
 * `wedgeLining`; cell i > 0: the tilted divider between slot i − 1 and slot i),
 * from x_back_i(H) − pitch (i > 0) or 0 (i = 0) to x_back_i(zBot) + EPS.
 * The neighbouring slots are air; the box is clipped to the slab between
 * slot i − 1's back face and slot i's front face (slot i's local
 * x ∈ [−pitch·cos θ, T]; for cell 0 everything behind slot 0's front face),
 * so it never reaches divider i or the last cell's front block, however steep
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
 * The plate wedge of cell 0 grown by `wall` (a true offset: each slanted side
 * shifted outward by `wall` perpendicular to it, the bottom edge down by
 * `wall`, the top at topZ + EPS), extruded along X over [a0, a0 + t] (the
 * whole pocket). `depth` is the wedge depth below the wall top. Also used,
 * with the front opening's depth, for the front pocket. Subtracted from the pocket cutter, so a
 * `wall`-thick lining stays around the wedge cut and nothing looks into the
 * pocket; the pocket splits into a left and a right half, each still open
 * through its side wall, with a flat ceiling bridging the pocket under the
 * wedge bottom.
 */
function wedgeLining(kernel: GeometryKernel, f: CellFrame, g: Geom, wall: number, depth: number, a0: number, t: number): Solid {
  const tw = g.plateWedge.top / 2;
  const bw = g.plateWedge.bottom / 2;
  const zTop = f.topZ;
  const zb = zTop - depth;
  // Right slanted side from (bw, zb) to (tw, zTop) relative to the centre; outward normal (dz, −dx) / len.
  const dx = tw - bw;
  const dz = zTop - zb;
  const len = Math.hypot(dx, dz);
  const nx = dz / len;
  const nz = -dx / len;
  // Half width of the offset side at height z.
  const half = (z: number) => bw + wall * nx + (z - (zb + wall * nz)) * (dx / dz);
  const zBot = zb - wall;
  return wedgeCutter(kernel, {
    across: 'x',
    a0,
    t,
    c: f.y + f.depth / 2,
    size: { top: 2 * half(zTop), bottom: 2 * half(zBot) },
    zTop,
    zBot,
    zCap: zTop + EPS,
  });
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

/** Whether the front access opening is cut: below 100 % and with a positive size. */
function frontOpen(g: Geom): boolean {
  return !g.frontClosed && g.frontOpeningDepth > 1e-9 && g.plateWedge.top > 0;
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
  /** The front access opening exists (below 100 %, with a size). */
  const front = frontOpen(g);
  return {
    ...base,
    cellCutters(kernel, f) {
      const out = [slotCutter(kernel, f, g)];
      if (f.outer.left && g.hollowBack) {
        const poly = pocketProfile(g, base.wall, f.floorZ, f.topZ, pocketBottom(f.floorZ, base.stacking));
        if (poly) {
          const pocket = extrudeXZ(kernel, poly, -EPS, L.depth + EPS);
          const lining = () => wedgeLining(kernel, f, g, base.wall, g.wedgeDepth, 0, base.wall + g.back + g.H * g.tan + 1);
          out.push(plates ? kernel.difference(pocket, [lining()]) : pocket);
        }
      }
      if (f.outer.right && g.hollowFront) {
        const poly = frontPocketProfile(g, base.wall, f.x + f.width, f.floorZ, f.topZ, pocketBottom(f.floorZ, base.stacking));
        if (poly) {
          const pocket = extrudeXZ(kernel, poly, -EPS, L.depth + EPS);
          const a0 = f.x + g.back;
          out.push(front ? kernel.difference(pocket, [wedgeLining(kernel, f, g, base.wall, g.frontOpeningDepth, a0, L.width - a0 + 1)]) : pocket);
        }
      }
      if (f.outer.right && front) out.push(frontOpeningCutter(kernel, f, g, L.width));
      if (plates) out.push(plateWedgeCutter(kernel, f, g, pitch, L.width));
      if (sides) out.push(...sideWedgeCutters(kernel, f, g));
      return out;
    },
    cellDraw(f) {
      const xTop = f.x + g.back; // x_back_i(H): the slot's back face at the wall top
      const out: TopViewFeature[] = [];
      out.push({ kind: 'rect', role: 'cavity', x: xTop, y: f.y, w: g.s, h: f.depth });
      if (!f.outer.right) {
        // The tilted divider in front of this slot, at the wall top.
        out.push({ kind: 'rect', role: 'divider', x: xTop + g.s, y: f.y, w: pitch - g.s, h: f.depth });
      } else if (front) {
        // The front access opening across the front block (the block itself is solid: no rect).
        const top = g.plateWedge.top;
        out.push({ kind: 'rect', role: 'notch', x: xTop + g.s, y: f.y + f.depth / 2 - top / 2, w: f.x + f.width + f.sides.right - xTop - g.s, h: top });
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
 * Bearing areas: the framework's outer ring (lip all round), plus the top of
 * the front block in front of the last slot ('front wall', wall top); the
 * front access opening's top width (over the block, the outer wall and the
 * lip) is taken out of both and added as 'low' at its bottom
 * (floorZ + frontHeight),
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
      const x0 = f.x + g.back + g.s;
      let block: BearingArea[] =
        f.x + f.width - x0 > 1e-9
          ? [{ x: x0, y: f.y, width: f.x + f.width - x0, depth: f.depth, height: f.topZ, role: 'bearing', name: 'front wall' }]
          : [];
      if (frontOpen(g)) {
        const top = g.plateWedge.top;
        const hole = { x: x0, y: f.y + f.depth / 2 - top / 2, width: L.width - x0, depth: top };
        areas = areas.flatMap((a) => subtractRect(a, hole));
        block = block.flatMap((a) => subtractRect(a, hole));
        block.push({ ...hole, height: f.floorZ + g.frontHeight, role: 'low', name: 'front opening' });
      }
      extra.push(...block);
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

/** The wedge depth is shown when either toggle is on. */
const wedgesOn = (p: ItemParams): boolean => p.wedgePlates !== false || p.wedgeSides === true;
/** The wedge widths also size the front access opening, so they are shown below 100 % too. */
const wedgeWidthsOn = (p: ItemParams): boolean => wedgesOn(p) || !(typeof p.frontHeightPct === 'number' && p.frontHeightPct >= 100);

export const cardTrayTilted: BoxTypeDefinition = {
  id: 'card-tray-tilted',
  name: 'Card tray (tilted)',
  description: 'Standing card stacks leaning back, stepped one behind the other, with an access opening in the front: a card display and dispenser during play.',
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
      key: 'frontHeightPct',
      label: 'Front wall height (% of wall)',
      kind: 'number',
      default: 50,
      min: 0,
      max: 100,
      step: 5,
      group: 'Dispenser',
      help: 'Height of the front wall left below the access opening, as a percentage of the wall height (from the floor): the opening is cut from the top down to here, so the cards can be pushed out. The slot floor rises toward the front by the stack thickness × sin of the tilt, so the opening bottom stands that much less above the slot floor and must stay at least 1 mm above it. 100 closes the front like a normal wall. The opening widths are the wedge widths.',
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
      help: 'A pocket in the solid back wedge, open through the side walls, to save material; its roof is a short bridge. With wedges in the plates the pocket is sealed around the back wedge by a lining one wall thick.',
    },
    {
      key: 'hollowFront',
      label: 'Hollow front',
      kind: 'boolean',
      default: true,
      group: 'Dispenser',
      help: 'A pocket in the solid front block, open through the side walls, like the hollow back; it is sealed around the front access opening by a lining one wall thick.',
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
      help: 'Width of the wedge at the wall top; 0 = auto (60 % of the span it is cut across: the lane width for the plates and the front access opening, the slot thickness for the side walls).',
      visibleIf: wedgeWidthsOn,
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
      visibleIf: wedgeWidthsOn,
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
    if (!(g.frontHeightPct >= 0 && g.frontHeightPct <= 100)) {
      problems.push(`Front wall height must be between 0 % and 100 % of the wall (is ${g.frontHeightPct} %).`);
    }
    if (g.frontHeightPct >= 0 && !g.frontClosed && g.H > 0 && g.frontHeight < g.T * g.sin + 1) {
      problems.push(
        `Front wall height (${g.frontHeightPct} % = ${round(g.frontHeight)} mm) must be at least ${round(g.T * g.sin + 1)} mm (${round(((g.T * g.sin + 1) / g.H) * 100)} %): the front access opening must stay 1 mm above the slot floor's front corner (${round(g.T * g.sin)} mm above the floor).`,
      );
    }
    const frontUsesWedge = !g.frontClosed;
    if (g.wedgePlates || g.wedgeSides || frontUsesWedge) {
      const sets = [];
      if (g.wedgePlates || frontUsesWedge) sets.push({ size: g.plateWedge, span: g.depth, what: 'the lane width' });
      if (g.wedgeSides) sets.push({ size: g.sideWedge, span: g.T, what: 'the slot thickness' });
      validateWedgeSizes(problems, g.wedgeRaw, item.wall, sets);
      if ((g.wedgePlates || g.wedgeSides) && g.wedgeRaw.depth > 0 && g.H > 0 && g.wedgeRaw.depth > g.wedgeMaxDepth) {
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
