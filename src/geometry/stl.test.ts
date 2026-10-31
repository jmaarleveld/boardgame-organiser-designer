import { describe, expect, it } from 'vitest';
import { binaryStlByteLength, readBinaryStl, readStlNormal, writeBinaryStl } from './stl';
import type { MeshData } from './types';

// Unit tetrahedron with outward (counter‑clockwise) winding.
const tetra: MeshData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
};

describe('binary STL', () => {
  it('has length 84 + 50·n', () => {
    const buf = writeBinaryStl(tetra, 'tetra');
    expect(buf.byteLength).toBe(84 + 50 * 4);
    expect(binaryStlByteLength(4)).toBe(284);
    expect(new DataView(buf).getUint32(80, true)).toBe(4);
  });

  it('header does not start with "solid"', () => {
    const buf = writeBinaryStl(tetra, 'solid thing');
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, 5));
    expect(head).not.toBe('solid');
  });

  it('round‑trips vertices', () => {
    const back = readBinaryStl(writeBinaryStl(tetra));
    expect(back.indices.length).toBe(tetra.indices.length);
    for (let t = 0; t < 4; t++) {
      for (let k = 0; k < 3; k++) {
        const src = tetra.indices[3 * t + k] * 3;
        const dst = back.indices[3 * t + k] * 3;
        for (let c = 0; c < 3; c++) expect(back.positions[dst + c]).toBe(tetra.positions[src + c]);
      }
    }
  });

  it('computes outward face normals from winding', () => {
    const buf = writeBinaryStl(tetra);
    const n0 = readStlNormal(buf, 0); // floor triangle → −Z
    expect(n0[0]).toBeCloseTo(0);
    expect(n0[1]).toBeCloseTo(0);
    expect(n0[2]).toBeCloseTo(-1);
    const n3 = readStlNormal(buf, 3); // slanted face → (1,1,1)/√3
    for (const c of n3) expect(c).toBeCloseTo(1 / Math.sqrt(3));
  });

  it('writes an empty mesh', () => {
    const buf = writeBinaryStl({ positions: new Float32Array(), indices: new Uint32Array() });
    expect(buf.byteLength).toBe(84);
    expect(readBinaryStl(buf).indices.length).toBe(0);
  });

  it('rejects truncated input', () => {
    const buf = writeBinaryStl(tetra).slice(0, 200);
    expect(() => readBinaryStl(buf)).toThrow();
  });
});
