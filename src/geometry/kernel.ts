/**
 * GeometryKernel implementation over manifold-3d (WASM). This is the only module
 * that imports manifold-3d (DESIGN.md §5).
 *
 * WASM memory: every manifold-3d `Manifold` lives on the WASM heap and must be
 * freed with `.delete()`. All kernel operations are pure (they never mutate or
 * free their inputs), so a `Solid` can safely be reused. Each `Solid` wrapper is
 * registered with a `FinalizationRegistry` that deletes the underlying
 * `Manifold` once the wrapper is garbage‑collected, so intermediates created by
 * box builders are reclaimed automatically. Callers that churn through many
 * solids (e.g. the exporter) can free one eagerly with `disposeSolid()`; using a
 * disposed solid afterwards throws.
 *
 * Manifold's booleans are lazy CSG trees that hold their own (ref‑counted)
 * references to operands, so deleting an operand's JS handle after a boolean
 * is safe.
 */
import Module from 'manifold-3d';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Bounds, GeometryKernel, MeshData, Solid, Vec2, Vec3 } from './types';
import { writeBinaryStl } from './stl';

interface SolidImpl extends Solid {
  manifold: Manifold | null;
}

const finalizer: FinalizationRegistry<Manifold> | null =
  typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry<Manifold>((m) => {
        try {
          m.delete();
        } catch {
          // Already deleted or module torn down; nothing to do.
        }
      })
    : null;

function wrap(m: Manifold): Solid {
  const s = { manifold: m } as SolidImpl;
  finalizer?.register(s, m, s);
  return s;
}

function unwrap(s: Solid): Manifold {
  const m = (s as SolidImpl).manifold;
  if (!m) throw new Error('Solid has been disposed');
  return m;
}

/** Eagerly free the WASM memory behind a solid. The solid must not be used afterwards. */
export function disposeSolid(solid: Solid): void {
  const impl = solid as SolidImpl;
  if (!impl.manifold) return;
  finalizer?.unregister(impl);
  impl.manifold.delete();
  impl.manifold = null;
}

/** Default circular segment count for cylinders when not specified. */
const DEFAULT_SEGMENTS = 48;

function makeKernel(wasm: ManifoldToplevel): GeometryKernel {
  const { Manifold } = wasm;

  const at3 = (at?: Vec3): Vec3 => at ?? [0, 0, 0];
  const isZero = (v: Vec3) => v[0] === 0 && v[1] === 0 && v[2] === 0;

  /** Translate a freshly created manifold and free the untranslated original. */
  const placed = (m: Manifold, at?: Vec3): Manifold => {
    const offset = at3(at);
    if (isZero(offset)) return m;
    const t = m.translate(offset);
    m.delete();
    return t;
  };

  const toMesh = (solid: Solid): MeshData => {
    const mesh = unwrap(solid).getMesh();
    const { numProp, vertProperties, triVerts } = mesh;
    const nVerts = Math.floor(vertProperties.length / numProp);
    const positions = new Float32Array(nVerts * 3);
    if (numProp === 3) {
      positions.set(vertProperties.subarray(0, nVerts * 3));
    } else {
      for (let i = 0; i < nVerts; i++) {
        positions[3 * i] = vertProperties[i * numProp];
        positions[3 * i + 1] = vertProperties[i * numProp + 1];
        positions[3 * i + 2] = vertProperties[i * numProp + 2];
      }
    }
    return { positions, indices: new Uint32Array(triVerts) };
  };

  return {
    box(width, depth, height, at) {
      return wrap(placed(Manifold.cube([width, depth, height], false), at));
    },

    cylinder(radius, height, at, segments) {
      return wrap(
        placed(
          Manifold.cylinder(height, radius, radius, segments ?? DEFAULT_SEGMENTS, false),
          at,
        ),
      );
    },

    extrude(polygon: Vec2[], height, at) {
      return wrap(placed(Manifold.extrude([polygon], height), at));
    },

    union(solids) {
      return wrap(Manifold.union(solids.map(unwrap)));
    },

    difference(base, cutters) {
      const b = unwrap(base);
      if (cutters.length === 0) return wrap(b.translate([0, 0, 0]));
      if (cutters.length === 1) return wrap(b.subtract(unwrap(cutters[0])));
      const cut = Manifold.union(cutters.map(unwrap));
      const out = b.subtract(cut);
      cut.delete();
      return wrap(out);
    },

    intersection(solids) {
      return wrap(Manifold.intersection(solids.map(unwrap)));
    },

    translate(solid, offset) {
      return wrap(unwrap(solid).translate(offset));
    },

    rotate(solid, degrees) {
      return wrap(unwrap(solid).rotate(degrees));
    },

    mirror(solid, normal) {
      return wrap(unwrap(solid).mirror(normal));
    },

    volume(solid) {
      return unwrap(solid).volume();
    },

    bounds(solid): Bounds {
      const bb = unwrap(solid).boundingBox();
      return { min: [...bb.min] as Vec3, max: [...bb.max] as Vec3 };
    },

    isValid(solid) {
      const m = unwrap(solid);
      // v3.x returns a string; older builds returned an enum object `{ value }`.
      const status: unknown = m.status();
      const ok =
        status === 'NoError' ||
        (typeof status === 'object' &&
          status !== null &&
          (status as { value?: unknown }).value === 0);
      // An empty result (e.g. a cut that removed everything) is treated as invalid.
      return ok && !m.isEmpty() && m.volume() > 0;
    },

    toMesh,

    toSTL(solid, name) {
      return writeBinaryStl(toMesh(solid), name);
    },
  };
}

let kernelPromise: Promise<GeometryKernel> | null = null;

/** Load the manifold WASM once and return the kernel (memoised). */
export function createKernel(): Promise<GeometryKernel> {
  if (!kernelPromise) {
    kernelPromise = (async () => {
      const wasm = await Module();
      wasm.setup();
      return makeKernel(wasm);
    })();
    // Allow a retry if loading failed (e.g. transient network error).
    kernelPromise.catch(() => {
      kernelPromise = null;
    });
  }
  return kernelPromise;
}
