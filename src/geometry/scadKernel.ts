/**
 * A GeometryKernel implementation that records construction calls and emits
 * OpenSCAD source instead of computing geometry. Analysis and mesh methods
 * are unsupported.
 */
import { requireFiniteOffset, requirePositiveDims, requireValidPolygon } from './guards';
import type { Bounds, GeometryKernel, MeshData, Solid, Vec2, Vec3 } from './types';

const UNSUPPORTED = 'not supported by the OpenSCAD kernel';
const DEFAULT_FN = 48;

interface ScadSolid extends Solid {
  /** OpenSCAD statement(s), no indentation, no trailing newline. */
  readonly node: string;
}

/** Up to 4 decimals, no trailing zeros, no negative zero. */
export function scadNum(n: number): string {
  const r = Math.round(n * 1e4) / 1e4;
  if (r === 0) return '0';
  return String(Number(r.toFixed(4)));
}

const vec = (v: readonly number[]): string => `[${v.map(scadNum).join(', ')}]`;
const isZero = (v?: Vec3): boolean => !v || v.every((c) => Math.abs(c) < 5e-5);
const indent = (s: string): string => s.split('\n').map((l) => `  ${l}`).join('\n');

function node(s: string): ScadSolid {
  return { __brand: 'Solid', node: s };
}

function nodeOf(solid: Solid): string {
  const n = (solid as Partial<ScadSolid>).node;
  if (typeof n !== 'string') throw new Error('Solid was not created by the OpenSCAD kernel');
  return n;
}

function withTranslate(at: Vec3 | undefined, body: string): string {
  return isZero(at) ? body : `translate(${vec(at as Vec3)}) ${body}`;
}

/** Statement of the form `name() { children }`. */
function block(name: string, children: string[]): string {
  return `${name}() {\n${children.map((c) => indent(c)).join('\n')}\n}`;
}

/** Append a transform to a child; blocks and statements both work as-is in OpenSCAD. */
function wrap(prefix: string, child: string): string {
  return `${prefix} ${child}`;
}

export type ScadKernel = GeometryKernel & { toScad(solid: Solid, header?: string): string };

export function createScadKernel(): ScadKernel {
  return {
    box(w, d, h, at) {
      requirePositiveDims('box', { width: w, depth: d, height: h });
      requireFiniteOffset('box', at);
      return node(withTranslate(at, `cube(${vec([w, d, h])});`));
    },
    cylinder(r, h, at, segments) {
      requirePositiveDims('cylinder', { radius: r, height: h });
      requireFiniteOffset('cylinder', at);
      return node(withTranslate(at, `cylinder(r=${scadNum(r)}, h=${scadNum(h)}, $fn=${segments ?? DEFAULT_FN});`));
    },
    extrude(poly: Vec2[], h, at) {
      requirePositiveDims('extrude', { height: h });
      requireValidPolygon('extrude', poly);
      requireFiniteOffset('extrude', at);
      const pts = `[${poly.map((p) => vec(p)).join(', ')}]`;
      return node(withTranslate(at, `linear_extrude(height=${scadNum(h)}) polygon(${pts});`));
    },
    union(solids) {
      const kids = solids.map(nodeOf);
      return node(kids.length === 1 ? kids[0] : block('union', kids));
    },
    difference(base, cutters) {
      if (cutters.length === 0) return node(nodeOf(base));
      return node(block('difference', [nodeOf(base), ...cutters.map(nodeOf)]));
    },
    intersection(solids) {
      const kids = solids.map(nodeOf);
      return node(kids.length === 1 ? kids[0] : block('intersection', kids));
    },
    translate(solid, offset) {
      return node(wrap(`translate(${vec(offset)})`, nodeOf(solid)));
    },
    rotate(solid, degrees) {
      return node(wrap(`rotate(${vec(degrees)})`, nodeOf(solid)));
    },
    mirror(solid, normal) {
      return node(wrap(`mirror(${vec(normal)})`, nodeOf(solid)));
    },

    volume(): number {
      throw new Error(UNSUPPORTED);
    },
    bounds(): Bounds {
      throw new Error(UNSUPPORTED);
    },
    isValid(): boolean {
      throw new Error(UNSUPPORTED);
    },
    toMesh(): MeshData {
      throw new Error(UNSUPPORTED);
    },
    toSTL(): ArrayBuffer {
      throw new Error(UNSUPPORTED);
    },

    toScad(solid, header) {
      const head = header
        ? header.split('\n').map((l) => (l ? `// ${l}` : '//')).join('\n') + '\n\n'
        : '';
      return `${head}$fn = ${DEFAULT_FN};\n\n${nodeOf(solid)}\n`;
    },
  };
}
