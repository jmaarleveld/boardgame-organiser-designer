import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel, disposeSolid } from './kernel';
import { readBinaryStl } from './stl';
import type { GeometryKernel } from './types';

let k: GeometryKernel;
beforeAll(async () => {
  k = await createKernel();
});

describe('geometry kernel', () => {
  it('is memoised', async () => {
    expect(await createKernel()).toBe(k);
  });

  it('box volume and corner origin', () => {
    const b = k.box(10, 20, 30);
    expect(k.volume(b)).toBeCloseTo(6000, 6);
    expect(k.bounds(b)).toEqual({ min: [0, 0, 0], max: [10, 20, 30] });
    const moved = k.box(1, 2, 3, [5, 6, 7]);
    expect(k.bounds(moved)).toEqual({ min: [5, 6, 7], max: [6, 8, 10] });
  });

  it('difference volume = outer − inner', () => {
    const outer = k.box(10, 10, 10);
    const inner = k.box(6, 6, 20, [2, 2, 2]);
    const d = k.difference(outer, [inner]);
    expect(k.volume(d)).toBeCloseTo(1000 - 6 * 6 * 8, 6);
    expect(k.isValid(d)).toBe(true);
    // inputs are untouched
    expect(k.volume(outer)).toBeCloseTo(1000, 6);
  });

  it('difference with several cutters and none', () => {
    const base = k.box(10, 10, 10);
    const d = k.difference(base, [k.box(2, 2, 20, [1, 1, -1]), k.box(2, 2, 20, [5, 5, -1])]);
    expect(k.volume(d)).toBeCloseTo(1000 - 2 * 40, 6);
    expect(k.volume(k.difference(base, []))).toBeCloseTo(1000, 6);
  });

  it('union of overlapping boxes', () => {
    const u = k.union([k.box(10, 10, 10), k.box(10, 10, 10, [5, 0, 0])]);
    expect(k.volume(u)).toBeCloseTo(1500, 6);
    expect(k.bounds(u).max).toEqual([15, 10, 10]);
  });

  it('intersection', () => {
    const i = k.intersection([k.box(10, 10, 10), k.box(10, 10, 10, [5, 5, 5])]);
    expect(k.volume(i)).toBeCloseTo(125, 6);
  });

  it('cylinder volume ≈ πr²h', () => {
    const r = 5;
    const h = 10;
    const n = 64;
    const c = k.cylinder(r, h, [1, 2, 3], n);
    const polygonArea = (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
    expect(k.volume(c)).toBeCloseTo(polygonArea * h, 4);
    expect(Math.abs(k.volume(c) - Math.PI * r * r * h) / (Math.PI * r * r * h)).toBeLessThan(0.01);
    const b = k.bounds(c);
    expect(b.min[2]).toBeCloseTo(3, 9);
    expect(b.max[2]).toBeCloseTo(13, 9);
    expect(b.max[0]).toBeCloseTo(6, 9);
  });

  it('extrude of a square', () => {
    const e = k.extrude(
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      5,
      [1, 1, 1],
    );
    expect(k.volume(e)).toBeCloseTo(80, 6);
    expect(k.bounds(e)).toEqual({ min: [1, 1, 1], max: [5, 5, 6] });
  });

  it('transforms', () => {
    const b = k.box(10, 2, 3);
    const r = k.rotate(b, [0, 0, 90]);
    const rb = k.bounds(r);
    expect(rb.min[0]).toBeCloseTo(-2, 6);
    expect(rb.max[1]).toBeCloseTo(10, 6);
    const t = k.translate(b, [1, 1, 1]);
    expect(k.bounds(t).min).toEqual([1, 1, 1]);
    const m = k.mirror(b, [1, 0, 0]);
    expect(k.bounds(m).min[0]).toBeCloseTo(-10, 6);
    expect(k.volume(m)).toBeCloseTo(60, 6);
  });

  it('toMesh and STL round‑trip triangle count', () => {
    const d = k.difference(k.box(10, 10, 10), [k.box(4, 4, 20, [3, 3, 2])]);
    const mesh = k.toMesh(d);
    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.indices.length % 3).toBe(0);
    const tris = mesh.indices.length / 3;
    expect(tris).toBeGreaterThan(12);
    const stl = k.toSTL(d, 'test');
    expect(stl.byteLength).toBe(84 + 50 * tris);
    expect(readBinaryStl(stl).indices.length / 3).toBe(tris);
    expect(k.toMesh(k.box(1, 1, 1)).indices.length / 3).toBe(12);
  });

  it('isValid', () => {
    expect(k.isValid(k.box(1, 1, 1))).toBe(true);
    // Cutting everything away leaves an empty (invalid) solid.
    expect(k.isValid(k.difference(k.box(1, 1, 1), [k.box(3, 3, 3, [-1, -1, -1])]))).toBe(false);
  });

  it('disposeSolid frees and guards reuse', () => {
    const b = k.box(1, 1, 1);
    disposeSolid(b);
    disposeSolid(b); // idempotent
    expect(() => k.volume(b)).toThrow(/disposed/);
  });
});
