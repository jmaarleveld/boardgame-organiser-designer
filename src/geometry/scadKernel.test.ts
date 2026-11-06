import { describe, expect, it } from 'vitest';
import { createScadKernel, scadNum } from './scadKernel';

const k = createScadKernel();
const s = (x: ReturnType<typeof k.box>) => k.toScad(x).split('$fn = 48;\n\n')[1].trimEnd();

describe('scadNum', () => {
  it('formats compactly', () => {
    expect(scadNum(1.5)).toBe('1.5');
    expect(scadNum(2)).toBe('2');
    expect(scadNum(1 / 3)).toBe('0.3333');
    expect(scadNum(-0)).toBe('0');
    expect(scadNum(-0.00001)).toBe('0');
    expect(scadNum(-2.25)).toBe('-2.25');
  });
});

describe('scad kernel primitives', () => {
  it('box with and without offset', () => {
    expect(s(k.box(1, 2, 3))).toBe('cube([1, 2, 3]);');
    expect(s(k.box(1, 2, 3, [0, 0, 0]))).toBe('cube([1, 2, 3]);');
    expect(s(k.box(1, 2, 3, [4, 5, -0]))).toBe('translate([4, 5, 0]) cube([1, 2, 3]);');
  });
  it('cylinder', () => {
    expect(s(k.cylinder(2, 5))).toBe('cylinder(r=2, h=5, $fn=48);');
    expect(s(k.cylinder(2, 5, [1, 1, 0], 12))).toBe('translate([1, 1, 0]) cylinder(r=2, h=5, $fn=12);');
  });
  it('extrude', () => {
    expect(s(k.extrude([[0, 0], [1, 0], [0, 1.5]], 2, [0, 0, 1]))).toBe(
      'translate([0, 0, 1]) linear_extrude(height=2) polygon([[0, 0], [1, 0], [0, 1.5]]);',
    );
  });
  it('transforms', () => {
    const b = k.box(1, 1, 1);
    expect(s(k.translate(b, [1, 2, 3]))).toBe('translate([1, 2, 3]) cube([1, 1, 1]);');
    expect(s(k.rotate(b, [0, 0, 90]))).toBe('rotate([0, 0, 90]) cube([1, 1, 1]);');
    expect(s(k.mirror(b, [1, 0, 0]))).toBe('mirror([1, 0, 0]) cube([1, 1, 1]);');
  });
  it('union, difference, intersection nest with indentation', () => {
    const a = k.box(1, 1, 1);
    const b = k.box(2, 2, 2, [1, 0, 0]);
    expect(s(k.union([a, b]))).toBe('union() {\n  cube([1, 1, 1]);\n  translate([1, 0, 0]) cube([2, 2, 2]);\n}');
    expect(s(k.intersection([a, b]))).toBe('intersection() {\n  cube([1, 1, 1]);\n  translate([1, 0, 0]) cube([2, 2, 2]);\n}');
    const nested = k.difference(k.union([a, b]), [k.cylinder(1, 1)]);
    expect(s(nested)).toBe(
      'difference() {\n  union() {\n    cube([1, 1, 1]);\n    translate([1, 0, 0]) cube([2, 2, 2]);\n  }\n  cylinder(r=1, h=1, $fn=48);\n}',
    );
  });
  it('collapses single-child union and empty difference', () => {
    const a = k.box(1, 1, 1);
    expect(s(k.union([a]))).toBe('cube([1, 1, 1]);');
    expect(s(k.difference(a, []))).toBe('cube([1, 1, 1]);');
  });
  it('toScad emits header comments and $fn', () => {
    const out = k.toScad(k.box(1, 1, 1), 'Line one\n\nLine two');
    expect(out.startsWith('// Line one\n//\n// Line two\n\n$fn = 48;\n')).toBe(true);
  });
  it('unsupported methods throw', () => {
    const a = k.box(1, 1, 1);
    for (const f of [() => k.volume(a), () => k.bounds(a), () => k.isValid(a), () => k.toMesh(a), () => k.toSTL(a)]) {
      expect(f).toThrow('not supported by the OpenSCAD kernel');
    }
  });
});

describe('scad kernel argument guard', () => {
  it('rejects the same bad sizes as the manifold kernel', () => {
    expect(() => k.box(1, -2, 3)).toThrow('Invalid box(width=1, depth=-2, height=3): depth must be a finite number > 0');
    expect(() => k.cylinder(0, 1)).toThrow(/Invalid cylinder\(radius=0, height=1\)/);
    expect(() => k.extrude([[0, 0], [1, 0], [0, 1]], NaN)).toThrow(/Invalid extrude\(height=NaN\)/);
    expect(() => k.box(1, 1, 1, [0, 0, Infinity])).toThrow(/box position/);
  });
});
