/**
 * Shared helpers for box definitions: typed parameter access, stacking and
 * card parameters. Local frame: X = width, Y = depth, Z = up, floor on Z = 0.
 */
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid } from '../../geometry/types';
import type { BaseFeature, BearingArea, ParamSpec } from '../types';

/** Overshoot used to make boolean cuts clean (cutters poke through faces). */
export const EPS = 0.01;

export function num(item: ResolvedItem, key: string, fallback = 0): number {
  const v = item.params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

export function bool(item: ResolvedItem, key: string, fallback = false): boolean {
  const v = item.params[key];
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

export function str<T extends string>(item: ResolvedItem, key: string, allowed: readonly T[], fallback: T): T {
  const v = item.params[key];
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Push a problem when `value` is not strictly positive. */
export function requirePositive(problems: string[], label: string, value: number): void {
  if (!(value > 0)) problems.push(`${label} must be greater than 0 (is ${value}).`);
}

/** Outer box minus an open‑top cavity (inner + 2·wall, height inner + floor). */
export function openBox(
  kernel: GeometryKernel,
  innerWidth: number,
  innerDepth: number,
  innerHeight: number,
  wall: number,
  floor: number,
): Solid {
  const outer = kernel.box(innerWidth + 2 * wall, innerDepth + 2 * wall, innerHeight + floor);
  const cavity = kernel.box(innerWidth, innerDepth, innerHeight + EPS, [wall, wall, floor]);
  return kernel.difference(outer, [cavity]);
}

export function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ---------------------------------------------------------------- stacking */

export const STACK_TOPS = ['none', 'lip'] as const;
export const STACK_BOTTOMS = ['none', 'recess', 'plug'] as const;
export type StackTop = (typeof STACK_TOPS)[number];
export type StackBottom = (typeof STACK_BOTTOMS)[number];

/** Minimum remaining (inner) wall thickness next to a recess. */
export const MIN_RECESS_WALL = 0.4;

/**
 * "Stacking" parameter group shared by every cavity type (item tray and the
 * card trays). Designed for same‑footprint, same‑wall trays stacked directly
 * on top of each other.
 */
export const stackingParams: ParamSpec[] = [
  {
    key: 'stackTop',
    label: 'Top edge',
    kind: 'select',
    default: 'none',
    options: [
      { value: 'none', label: 'Flat' },
      { value: 'lip', label: 'Lip (outer half of the wall rises)' },
    ],
    group: 'Stacking',
    help: 'A lip locates a tray with a recessed base stacked on top.',
  },
  {
    key: 'stackBottom',
    label: 'Base',
    kind: 'select',
    default: 'none',
    options: [
      { value: 'none', label: 'Flat' },
      { value: 'recess', label: 'Recess (sits on a lip)' },
      { value: 'plug', label: 'Plug (retrofit onto a plain tray)' },
    ],
    group: 'Stacking',
    help:
      'Made for a same‑footprint, same‑wall tray below. Recess pairs with a lip tray (the standard). ' +
      'Plug is a retrofit for stacking onto an already printed flat‑topped tray: it drops into the empty cavity below and takes plug height of it.',
  },
  {
    key: 'lipHeight',
    label: 'Lip height',
    kind: 'number',
    default: 2,
    min: 0.2,
    step: 0.1,
    unit: 'mm',
    group: 'Stacking',
    help: 'Height of the lip on top, and of the lip a recessed base receives.',
    visibleIf: (p) => p.stackTop === 'lip' || p.stackBottom === 'recess',
  },
  {
    key: 'plugHeight',
    label: 'Plug height',
    kind: 'number',
    default: 2,
    min: 0.2,
    step: 0.1,
    unit: 'mm',
    group: 'Stacking',
    visibleIf: (p) => p.stackBottom === 'plug',
  },
  {
    key: 'stackClearance',
    label: 'Stack clearance',
    kind: 'number',
    default: 0.15,
    min: 0,
    step: 0.05,
    unit: 'mm',
    group: 'Stacking',
    help: 'Gap between a recess / plug and the tray below.',
    visibleIf: (p) => p.stackBottom === 'recess' || p.stackBottom === 'plug',
  },
];

/**
 * Creation‑time stacking for new cavity trays (`BoxTypeDefinition.newItemParams`):
 * lip/recess is the standard locking mechanism. The ParamSpec defaults stay
 * 'none' so saved projects and the sample keep their geometry.
 */
export const stackingNewItemParams = { stackTop: 'lip', stackBottom: 'recess' } as const satisfies Record<
  string,
  StackTop | StackBottom
>;

export interface Stacking {
  top: StackTop;
  bottom: StackBottom;
  lipHeight: number;
  plugHeight: number;
  clearance: number;
  /** Lip height actually added on top (0 without a lip). */
  lipH: number;
  /** Plug height actually added below the floor (0 without a plug). The floor starts at Z = plugH. */
  plugH: number;
  /** Depth of the recess ring (0 without a recess). */
  recessDepth: number;
}

export function stacking(item: ResolvedItem): Stacking {
  const top = str<StackTop>(item, 'stackTop', STACK_TOPS, 'none');
  const bottom = str<StackBottom>(item, 'stackBottom', STACK_BOTTOMS, 'none');
  const lipHeight = num(item, 'lipHeight', 2);
  const plugHeight = num(item, 'plugHeight', 2);
  const clearance = num(item, 'stackClearance', 0.15);
  return {
    top,
    bottom,
    lipHeight,
    plugHeight,
    clearance,
    lipH: top === 'lip' ? Math.max(0, lipHeight) : 0,
    plugH: bottom === 'plug' ? Math.max(0, plugHeight) : 0,
    recessDepth: bottom === 'recess' ? Math.max(0, lipHeight + clearance) : 0,
  };
}

/**
 * How deep the base sinks into the item below. A recessed base sits with its
 * inner wall half on the inner half of the lower wall, so the lip (lipHeight)
 * is engaged and the extra recess depth (clearance) stays as a gap above the
 * lip — but only when `below` has a lip (stackTop 'lip'); on anything else
 * (plain tray, platform, spacer) it rests on top (0). Without `below` the
 * nominal lip engagement is returned. A plug drops plugHeight into the cavity
 * below, whatever it is.
 */
export function stackEngagement(item: ResolvedItem, below?: ResolvedItem): number {
  const s = stacking(item);
  if (s.bottom === 'recess') {
    if (below && below.params.stackTop !== 'lip') return 0;
    return Math.max(0, s.lipHeight);
  }
  if (s.bottom === 'plug') return s.plugH;
  return 0;
}

/** Outer height of a stackable cavity box. */
export function stackedHeight(innerHeight: number, floor: number, s: Stacking): number {
  return s.plugH + floor + innerHeight + s.lipH;
}

/**
 * Solid outer block of a stackable cavity box (outer W × D, `height` = floor +
 * inner height above the plug) with the stacking features but no cavity:
 * optional plug pad below the floor (the block starts at Z = plugH; the pad
 * is the inner area W − 2·wall minus the clearance), optional lip ring
 * (outer wall/2) above the wall top, optional recess ring cut from the outer
 * bottom edge. `cutters` (cavities, dividers, access features, …) are
 * subtracted in the same boolean as the recess ring.
 */
export function stackedBlock(
  kernel: GeometryKernel,
  W: number,
  D: number,
  height: number,
  wall: number,
  s: Stacking,
  cutters: Solid[] = [],
): Solid {
  const z0 = s.plugH;
  const wallTop = z0 + height;
  const parts: Solid[] = [kernel.box(W, D, height, [0, 0, z0])];
  if (s.lipH > 0) {
    // Ring overlaps the wall by EPS so the union is clean.
    const t = wall / 2;
    const ring = kernel.difference(kernel.box(W, D, s.lipH + EPS, [0, 0, wallTop - EPS]), [
      kernel.box(W - 2 * t, D - 2 * t, s.lipH + 3 * EPS, [t, t, wallTop - 2 * EPS]),
    ]);
    parts.push(ring);
  }
  if (s.plugH > 0) {
    const c = s.clearance;
    const pw = W - 2 * wall - 2 * c;
    const pd = D - 2 * wall - 2 * c;
    if (pw > 0 && pd > 0) parts.push(kernel.box(pw, pd, s.plugH + EPS, [wall + c, wall + c, 0]));
  }
  const solid = parts.length === 1 ? parts[0] : kernel.union(parts);
  const all = [...cutters];
  if (s.recessDepth > 0) {
    const r = wall / 2 + s.clearance;
    if (W - 2 * r > 0 && D - 2 * r > 0) {
      const ring = kernel.difference(kernel.box(W + 2 * EPS, D + 2 * EPS, s.recessDepth + EPS, [-EPS, -EPS, -EPS]), [
        kernel.box(W - 2 * r, D - 2 * r, s.recessDepth + 3 * EPS, [r, r, -2 * EPS]),
      ]);
      all.push(ring);
    }
  }
  return all.length ? kernel.difference(solid, all) : solid;
}

/** Validation of the stacking parameters for a cavity box. */
export function validateStacking(
  problems: string[],
  s: Stacking,
  wall: number,
  floor: number,
  innerWidth: number,
  innerDepth: number,
  innerHeight: number,
): void {
  if (s.top === 'lip' || s.bottom === 'recess') requirePositive(problems, 'Lip height', s.lipHeight);
  if (s.bottom === 'plug') requirePositive(problems, 'Plug height', s.plugHeight);
  if ((s.bottom === 'recess' || s.bottom === 'plug') && s.clearance < 0) {
    problems.push(`Stack clearance must not be negative (is ${s.clearance}).`);
  }
  if (s.bottom === 'recess') {
    const remaining = wall / 2 - s.clearance;
    if (remaining < MIN_RECESS_WALL - 1e-9) {
      problems.push(
        `Recess leaves only ${round(remaining)} mm of wall (wall/2 − clearance); needs at least ${MIN_RECESS_WALL} mm — use a thicker wall or less clearance.`,
      );
    }
    if (s.recessDepth >= floor + innerHeight) {
      problems.push(`Recess depth (${round(s.recessDepth)} mm) must be smaller than the wall height (${round(floor + innerHeight)} mm).`);
    }
  }
  if (s.bottom === 'plug' && (innerWidth - 2 * s.clearance <= 0 || innerDepth - 2 * s.clearance <= 0)) {
    problems.push('Plug clearance is larger than the cavity: the plug would have no size.');
  }
}

/* ---------------------------------------------------------------- stack fit */

/** Local rectangle. */
export interface LocalRect {
  x: number;
  y: number;
  width: number;
  depth: number;
}

/**
 * Ring of thickness `t` just inside the rectangle (x0, y0)–(x1, y1), as four
 * non‑overlapping bars (full‑width front / back, sides in between). Bars of
 * zero size are dropped.
 */
export function ringRects(x0: number, y0: number, x1: number, y1: number, t: number): LocalRect[] {
  const tt = Math.min(t, (x1 - x0) / 2, (y1 - y0) / 2);
  if (!(tt > 0)) return [];
  const bars: LocalRect[] = [
    { x: x0, y: y0, width: x1 - x0, depth: tt },
    { x: x0, y: y1 - tt, width: x1 - x0, depth: tt },
    { x: x0, y: y0 + tt, width: tt, depth: y1 - y0 - 2 * tt },
    { x: x1 - tt, y: y0 + tt, width: tt, depth: y1 - y0 - 2 * tt },
  ];
  return bars.filter((b) => b.width > 1e-9 && b.depth > 1e-9);
}

/**
 * Bearing areas of a stackable open box (outer W × D): the wall ring at the
 * wall top. With a lip, the outer half of the wall is the lip ring (role
 * 'lip', at the lip top) and only the inner half of the wall is at the wall
 * top: that is what a recessed base rests on.
 */
export function cavityBearingAreas(W: number, D: number, wall: number, floor: number, innerHeight: number, s: Stacking): BearingArea[] {
  const wallTop = s.plugH + floor + innerHeight;
  if (s.lipH > 0) {
    const t = wall / 2;
    return [
      ...ringRects(0, 0, W, D, t).map((r) => ({ ...r, height: wallTop + s.lipH, role: 'lip' as const, name: 'lip' })),
      ...ringRects(t, t, W - t, D - t, wall - t).map((r) => ({ ...r, height: wallTop, name: 'wall' })),
    ];
  }
  return ringRects(0, 0, W, D, wall).map((r) => ({ ...r, height: wallTop, name: 'wall' }));
}

/** Base features of a stackable open box: the recess ring or the plug pad. */
export function cavityBaseFeatures(W: number, D: number, wall: number, s: Stacking): BaseFeature[] {
  if (s.recessDepth > 0) {
    return ringRects(0, 0, W, D, wall / 2 + s.clearance).map((r) => ({
      ...r,
      kind: 'recess' as const,
      height: s.recessDepth,
      name: 'recess',
    }));
  }
  if (s.plugH > 0) {
    const c = s.clearance;
    const pw = W - 2 * wall - 2 * c;
    const pd = D - 2 * wall - 2 * c;
    if (pw > 0 && pd > 0) return [{ kind: 'protrusion', x: wall + c, y: wall + c, width: pw, depth: pd, height: s.plugH, name: 'plug' }];
  }
  return [];
}

/* ---------------------------------------------------------------- cards */

/** "Cards" parameter group shared by the card holders. */
export const cardParams: ParamSpec[] = [
  { key: 'cardWidth', label: 'Card width', kind: 'number', default: 63.5, min: 1, step: 0.5, unit: 'mm', group: 'Cards' },
  { key: 'cardHeight', label: 'Card height', kind: 'number', default: 88, min: 1, step: 0.5, unit: 'mm', group: 'Cards' },
  {
    key: 'clearance',
    label: 'Clearance',
    kind: 'number',
    default: 1,
    min: 0,
    step: 0.1,
    unit: 'mm',
    group: 'Cards',
    help: 'Extra space on each side of the cards.',
  },
  {
    key: 'stackHeight',
    label: 'Stack thickness',
    kind: 'number',
    default: 30,
    min: 1,
    step: 0.5,
    unit: 'mm',
    group: 'Cards',
    help: 'Thickness of the card stack (sleeved cards are ~0.5 mm each).',
  },
];

/** Card size, clearance (per side) and stack thickness, from `cardParams`. */
export interface CardDims {
  cardWidth: number;
  cardHeight: number;
  clearance: number;
  stackHeight: number;
}

export function cardDims(item: ResolvedItem): CardDims {
  return {
    cardWidth: num(item, 'cardWidth', 63.5),
    cardHeight: num(item, 'cardHeight', 88),
    clearance: num(item, 'clearance', 1),
    stackHeight: num(item, 'stackHeight', 30),
  };
}

/** Checks of the `cardParams` values. */
export function validateCards(problems: string[], c: CardDims): void {
  requirePositive(problems, 'Card width', c.cardWidth);
  requirePositive(problems, 'Card height', c.cardHeight);
  requirePositive(problems, 'Stack thickness', c.stackHeight);
  if (c.clearance < 0) problems.push(`Clearance must not be negative (is ${c.clearance}).`);
}

/* ---------------------------------------------------------------- wedges */

/** Auto wedge depth as a fraction of the inner height (wedgeDepth 0). */
export const AUTO_WEDGE_DEPTH = 0.6;
/** Auto wedge top width as a fraction of the span of the wall it is cut from (wedgeTopWidth 0). */
export const AUTO_WEDGE_TOP = 0.6;
/** Auto wedge bottom width as a fraction of the resolved top width (wedgeBottomWidth 0). */
export const AUTO_WEDGE_BOTTOM = 0.4;

/** Resolved trapezoid size for one set of walls. */
export interface WedgeSize {
  top: number;
  bottom: number;
}

/** Entered wedge sizes (`wedgeTopWidth`, `wedgeBottomWidth`, `wedgeDepth`; 0 = auto). */
export interface WedgeRaw {
  top: number;
  bottom: number;
  depth: number;
}

export function wedgeRaw(item: ResolvedItem): WedgeRaw {
  return { top: num(item, 'wedgeTopWidth', 0), bottom: num(item, 'wedgeBottomWidth', 0), depth: num(item, 'wedgeDepth', 0) };
}

/** Wedge size for a wall `span` wide: explicit values, or top 60 % of the span and bottom 40 % of the top. */
export function wedgeSize(raw: WedgeRaw, span: number): WedgeSize {
  const top = raw.top > 0 ? raw.top : AUTO_WEDGE_TOP * span;
  return { top, bottom: raw.bottom > 0 ? raw.bottom : AUTO_WEDGE_BOTTOM * top };
}

/**
 * Validation of the wedge sizes: non-negative values, an explicit bottom <=
 * the smallest top in use, an explicit top < span − 2·max(wall, 1) for every
 * wall set in use (so a post remains beside the wedges). The depth range is
 * the type's business.
 */
export function validateWedgeSizes(
  problems: string[],
  raw: WedgeRaw,
  wall: number,
  sets: { size: WedgeSize; span: number; what: string }[],
): void {
  if (raw.top < 0) problems.push(`Wedge top width must not be negative (is ${raw.top}).`);
  if (raw.bottom < 0) problems.push(`Wedge bottom width must not be negative (is ${raw.bottom}).`);
  if (raw.depth < 0) problems.push(`Wedge depth must not be negative (is ${raw.depth}).`);
  const post = Math.max(wall, 1);
  if (raw.bottom > 0 && sets.length) {
    const top = Math.min(...sets.map((x) => x.size.top));
    if (raw.bottom > top) {
      problems.push(`Wedge bottom width (${round(raw.bottom)} mm) must not exceed the top width (${round(top)} mm).`);
    }
  }
  if (raw.top > 0) {
    for (const { span, what } of sets) {
      const maxTop = span - 2 * post;
      if (raw.top >= maxTop) {
        problems.push(
          `Wedge top width (${round(raw.top)} mm) must be smaller than ${round(maxTop)} mm (${what} ${round(span)} mm minus ${round(post)} mm on each side) so wall remains beside the wedges.`,
        );
      }
    }
  }
}

/**
 * One wedge cut through a vertical wall: the wall material occupies
 * [a0, a0 + t] along `across` (the axis through the wall: 'y' for a wall
 * parallel to X, 'x' for a wall parallel to Y); the trapezoid is centred on
 * `c` along the other horizontal axis.
 */
export interface WallCut {
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
 * Wedge cutter: a trapezoid, `top` wide at zTop and `bottom` wide at zBot,
 * centred on `c`; above zTop it continues straight up to zCap (through the
 * lip, +EPS). Extruded through the wall thickness with EPS overshoot on both
 * faces.
 *
 * Built as an XY polygon (x = along the wall, y standing for Z) extruded
 * along +Z, then rotated so the extrusion runs through the wall:
 * - across 'y': rotate +90° about X, (u, v, w) → (u, −w, v), extrusion along −Y;
 * - across 'x': additionally +90° about Z, → (w, u, v), extrusion along +X.
 */
export function wedgeCutter(kernel: GeometryKernel, w: WallCut): Solid {
  const tw = w.size.top / 2;
  const bw = w.size.bottom / 2;
  const { c, zTop, zBot, zCap } = w;
  const poly: [number, number][] =
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
