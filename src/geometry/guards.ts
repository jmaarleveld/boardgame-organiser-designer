/**
 * Argument checks shared by the geometry kernels.
 *
 * manifold-3d does not throw on a non-positive size: `Manifold.cube` with a
 * negative height yields an invalid solid, and any boolean with it silently
 * returns an EMPTY solid (the item vanishes from the 3D views). The kernels
 * therefore reject such sizes up front, with a message that names the
 * primitive and the bad values, so the build fails loudly instead.
 */

const fmt = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 1e4) / 1e4) : String(n));

/**
 * Throw unless every named dimension is finite and > 0.
 * `dims` maps a dimension name to its value, e.g. `{ width, depth, height }`.
 */
export function requirePositiveDims(primitive: string, dims: Record<string, number>): void {
  const bad = Object.entries(dims).filter(([, v]) => !(Number.isFinite(v) && v > 0));
  if (bad.length === 0) return;
  const all = Object.entries(dims)
    .map(([k, v]) => `${k}=${fmt(v)}`)
    .join(', ');
  const which = bad.map(([k]) => k).join(', ');
  throw new Error(`Invalid ${primitive}(${all}): ${which} must be a finite number > 0`);
}

/** Throw unless every coordinate of the offset is finite. */
export function requireFiniteOffset(primitive: string, at: readonly number[] | undefined): void {
  if (!at || at.every((c) => Number.isFinite(c))) return;
  throw new Error(`Invalid ${primitive} position [${at.map(fmt).join(', ')}]: coordinates must be finite`);
}

/** Throw unless the polygon has at least 3 points, all finite. */
export function requireValidPolygon(primitive: string, polygon: readonly (readonly number[])[]): void {
  if (polygon.length < 3) throw new Error(`Invalid ${primitive}: polygon needs at least 3 points (got ${polygon.length})`);
  const bad = polygon.find((p) => !p.every((c) => Number.isFinite(c)));
  if (bad) throw new Error(`Invalid ${primitive}: polygon point [${bad.map(fmt).join(', ')}] is not finite`);
}
