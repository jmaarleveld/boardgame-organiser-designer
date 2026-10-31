/**
 * Shared helpers for box definitions: typed parameter access and the finger
 * notch cutter. Local frame: X = width, Y = depth, Z = up, floor on Z = 0.
 */
import type { ResolvedItem } from '../../model/types';
import type { GeometryKernel, Solid } from '../../geometry/types';
import type { TopViewFeature } from '../types';

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

/**
 * A wall (or divider) to cut a finger notch into.
 * `axis` is the direction the wall runs along: 'x' = wall parallel to X
 * (its thickness is along Y), 'y' = wall parallel to Y (thickness along X).
 */
export interface NotchSpec {
  axis: 'x' | 'y';
  /** Centre of the notch along the wall's running axis. */
  center: number;
  /** Min coordinate of the wall along its thickness axis. */
  wallPos: number;
  /** Wall thickness. */
  thickness: number;
  /** Z of the wall's top edge. */
  top: number;
  /** Notch width along the wall. */
  width: number;
  /** Notch depth from the top edge. */
  depth: number;
}

/**
 * Rounded‑bottom slot (box + cylinder) through the wall thickness, oversized by
 * EPS on both faces and above the top so the boolean is clean.
 */
export function notchCutter(kernel: GeometryKernel, n: NotchSpec): Solid | null {
  if (!(n.width > 0) || !(n.depth > 0) || !(n.thickness > 0)) return null;
  const r = n.width / 2;
  const zc = n.top - n.depth + r; // centre of the rounded bottom
  const len = n.thickness + 2 * EPS;
  const parts: Solid[] = [];
  const rectBottom = Math.min(zc, n.top);
  const rectHeight = n.top + EPS - rectBottom;
  if (n.axis === 'x') {
    const y0 = n.wallPos - EPS;
    if (rectHeight > 0) parts.push(kernel.box(n.width, len, rectHeight, [n.center - r, y0, rectBottom]));
    // Cylinder along +Z rotated so its axis runs along +Y.
    const cyl = kernel.rotate(kernel.cylinder(r, len), [-90, 0, 0]);
    parts.push(kernel.translate(cyl, [n.center, y0, zc]));
  } else {
    const x0 = n.wallPos - EPS;
    if (rectHeight > 0) parts.push(kernel.box(len, n.width, rectHeight, [x0, n.center - r, rectBottom]));
    // Cylinder along +Z rotated so its axis runs along +X.
    const cyl = kernel.rotate(kernel.cylinder(r, len), [0, 90, 0]);
    parts.push(kernel.translate(cyl, [x0, n.center, zc]));
  }
  return parts.length === 1 ? parts[0] : kernel.union(parts);
}

/** Top‑view rectangle for a notch. */
export function notchRect(n: NotchSpec): TopViewFeature {
  return n.axis === 'x'
    ? { kind: 'rect', role: 'notch', x: n.center - n.width / 2, y: n.wallPos, w: n.width, h: n.thickness }
    : { kind: 'rect', role: 'notch', x: n.wallPos, y: n.center - n.width / 2, w: n.thickness, h: n.width };
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

/** Notch specs for the two walls running along `axis` of a simple open box, centred. */
export function wallPairNotches(
  axis: 'x' | 'y',
  innerWidth: number,
  innerDepth: number,
  innerHeight: number,
  wall: number,
  floor: number,
  width: number,
  depth: number,
): NotchSpec[] {
  const top = innerHeight + floor;
  if (axis === 'x') {
    const center = wall + innerWidth / 2;
    return [
      { axis, center, wallPos: 0, thickness: wall, top, width, depth },
      { axis, center, wallPos: wall + innerDepth, thickness: wall, top, width, depth },
    ];
  }
  const center = wall + innerDepth / 2;
  return [
    { axis, center, wallPos: 0, thickness: wall, top, width, depth },
    { axis, center, wallPos: wall + innerWidth, thickness: wall, top, width, depth },
  ];
}

/** Common checks for a notch cut from a wall of inner span `span`. */
export function validateNotch(
  problems: string[],
  width: number,
  depth: number,
  span: number,
  innerHeight: number,
  where: string,
): void {
  requirePositive(problems, 'Notch width', width);
  requirePositive(problems, 'Notch depth', depth);
  if (width >= span) {
    problems.push(`Notch width (${width} mm) must be smaller than the ${where} it is cut from (${round(span)} mm).`);
  }
  if (depth > innerHeight) {
    problems.push(`Notch depth (${depth} mm) exceeds the inner height (${innerHeight} mm) and would cut into the floor.`);
  }
}

export function round(v: number): number {
  return Math.round(v * 100) / 100;
}
