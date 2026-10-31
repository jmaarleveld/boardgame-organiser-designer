/**
 * Pure binary STL reader/writer. No WASM dependency, so it is unit‑testable on
 * its own. Layout (little‑endian):
 *   80‑byte header | uint32 triangle count | per triangle:
 *   normal (3×f32) | v0, v1, v2 (3×3×f32) | uint16 attribute byte count (0)
 */
import type { MeshData } from './types';

const HEADER_BYTES = 80;
const TRI_BYTES = 50;

/** Byte length of a binary STL with `triangles` facets. */
export function binaryStlByteLength(triangles: number): number {
  return HEADER_BYTES + 4 + TRI_BYTES * triangles;
}

export function writeBinaryStl(mesh: MeshData, name = 'solid'): ArrayBuffer {
  const { positions: p, indices } = mesh;
  const triCount = Math.floor(indices.length / 3);
  const buffer = new ArrayBuffer(binaryStlByteLength(triCount));
  const view = new DataView(buffer);

  // Header: ASCII text padded with spaces. It must not start with "solid",
  // because some readers sniff that prefix as an ASCII STL.
  const header = `binary STL: ${name}`.slice(0, HEADER_BYTES);
  for (let i = 0; i < HEADER_BYTES; i++) {
    const code = i < header.length ? header.charCodeAt(i) : 0x20;
    view.setUint8(i, code < 128 ? code : 0x3f);
  }
  view.setUint32(HEADER_BYTES, triCount, true);

  let off = HEADER_BYTES + 4;
  for (let t = 0; t < triCount; t++) {
    const a = indices[3 * t] * 3;
    const b = indices[3 * t + 1] * 3;
    const c = indices[3 * t + 2] * 3;
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const bx = p[b], by = p[b + 1], bz = p[b + 2];
    const cx = p[c], cy = p[c + 1], cz = p[c + 2];
    // Face normal from winding (counter‑clockwise = outward).
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = ny = nz = 0;
    }
    view.setFloat32(off, nx, true);
    view.setFloat32(off + 4, ny, true);
    view.setFloat32(off + 8, nz, true);
    view.setFloat32(off + 12, ax, true);
    view.setFloat32(off + 16, ay, true);
    view.setFloat32(off + 20, az, true);
    view.setFloat32(off + 24, bx, true);
    view.setFloat32(off + 28, by, true);
    view.setFloat32(off + 32, bz, true);
    view.setFloat32(off + 36, cx, true);
    view.setFloat32(off + 40, cy, true);
    view.setFloat32(off + 44, cz, true);
    view.setUint16(off + 48, 0, true);
    off += TRI_BYTES;
  }
  return buffer;
}

/**
 * Read a binary STL into an (unindexed) MeshData: every triangle gets its own
 * three vertices. Normals are ignored. Intended for tests and inspection.
 */
export function readBinaryStl(buffer: ArrayBuffer): MeshData {
  if (buffer.byteLength < HEADER_BYTES + 4) throw new Error('STL too short');
  const view = new DataView(buffer);
  const triCount = view.getUint32(HEADER_BYTES, true);
  if (buffer.byteLength !== binaryStlByteLength(triCount)) {
    throw new Error(
      `STL size mismatch: ${buffer.byteLength} bytes for ${triCount} triangles`,
    );
  }
  const positions = new Float32Array(triCount * 9);
  const indices = new Uint32Array(triCount * 3);
  let off = HEADER_BYTES + 4;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 9; k++) {
      positions[t * 9 + k] = view.getFloat32(off + 12 + 4 * k, true);
    }
    indices[3 * t] = 3 * t;
    indices[3 * t + 1] = 3 * t + 1;
    indices[3 * t + 2] = 3 * t + 2;
    off += TRI_BYTES;
  }
  return { positions, indices };
}

/** Read the stored facet normal of triangle `t` (for tests). */
export function readStlNormal(buffer: ArrayBuffer, t: number): [number, number, number] {
  const view = new DataView(buffer);
  const off = HEADER_BYTES + 4 + TRI_BYTES * t;
  return [
    view.getFloat32(off, true),
    view.getFloat32(off + 4, true),
    view.getFloat32(off + 8, true),
  ];
}
