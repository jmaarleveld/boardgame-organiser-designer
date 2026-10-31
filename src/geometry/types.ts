/**
 * Geometry kernel contract. Implemented over manifold-3d in src/geometry/kernel.ts.
 * All primitives are corner‑origin (not centred) unless stated. Lengths in mm.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Opaque handle to a solid. Never inspect its internals outside the kernel. */
export interface Solid {
  readonly __brand: 'Solid';
}

export interface MeshData {
  /** xyz triples */
  positions: Float32Array;
  /** triangle vertex indices */
  indices: Uint32Array;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export interface GeometryKernel {
  /** Axis‑aligned box with its min corner at `at` (default origin). */
  box(width: number, depth: number, height: number, at?: Vec3): Solid;
  /** Cylinder along +Z, base centre at `at` (default origin). */
  cylinder(radius: number, height: number, at?: Vec3, segments?: number): Solid;
  /** Extrude a simple polygon (XY, counter‑clockwise) by `height` along +Z, offset by `at`. */
  extrude(polygon: Vec2[], height: number, at?: Vec3): Solid;

  union(solids: Solid[]): Solid;
  difference(base: Solid, cutters: Solid[]): Solid;
  intersection(solids: Solid[]): Solid;

  translate(solid: Solid, offset: Vec3): Solid;
  /** Rotate about the origin by Euler angles in degrees (applied X, then Y, then Z). */
  rotate(solid: Solid, degrees: Vec3): Solid;
  mirror(solid: Solid, normal: Vec3): Solid;

  volume(solid: Solid): number;
  bounds(solid: Solid): Bounds;
  /** True if the solid is a valid, closed manifold. */
  isValid(solid: Solid): boolean;

  toMesh(solid: Solid): MeshData;
  /** Binary STL, little‑endian, in mm. */
  toSTL(solid: Solid, name?: string): ArrayBuffer;
}

/** Loads the WASM module once and returns the kernel (memoised). */
export type KernelFactory = () => Promise<GeometryKernel>;
