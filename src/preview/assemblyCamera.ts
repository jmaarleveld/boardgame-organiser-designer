/**
 * Pure (three.js‑free) camera math for the Assembly view.
 *
 * The three.js world IS the game box frame (DESIGN.md §2): no mirroring at the
 * scene root, so chiral geometry renders as it prints.
 *
 * Handedness note: the game box frame as the 2D top view draws it (x right,
 * y down the screen, z up out of the screen) is a *left*‑handed picture, while
 * the geometry kernel / STL frame is right‑handed. A proper camera (no
 * mirroring) looking straight down can therefore show either
 *   - 'y-up':   x right, y UP the screen (origin at the bottom‑left), or
 *   - 'y-down': y down the screen, but x pointing LEFT (origin at the top‑right),
 * never "x right AND y down". `ViewOrientation` picks one; every preset
 * (front / side / iso) is defined relative to that choice so they stay
 * consistent with the Top preset ("front" = the edge at the bottom of the Top
 * view, "side" = the edge on the right of the Top view).
 */

export type Vec3 = [number, number, number];

export type CameraPreset = 'top' | 'front' | 'side' | 'iso';
export const CAMERA_PRESETS: readonly CameraPreset[] = ['top', 'front', 'side', 'iso'];

/** How the straight‑down Top camera is rolled; see the module comment. */
export type ViewOrientation = 'y-up' | 'y-down';
export const DEFAULT_VIEW_ORIENTATION: ViewOrientation = 'y-up';

export interface BoxSize {
  width: number;
  depth: number;
  height: number;
}

/** Game‑frame directions of the Top view's screen axes and of "up". */
export interface ViewAxes {
  /** Screen‑right in the Top view (±x). */
  right: Vec3;
  /** Screen‑up in the Top view (±y). */
  screenUp: Vec3;
  /** Toward the viewer from the box in the Front preset (= −screenUp). */
  near: Vec3;
  /** World up (z). */
  up: Vec3;
}

export function viewAxes(orientation: ViewOrientation = DEFAULT_VIEW_ORIENTATION): ViewAxes {
  const s = orientation === 'y-up' ? 1 : -1;
  return { right: [s, 0, 0], screenUp: [0, s, 0], near: [0, -s, 0], up: [0, 0, 1] };
}

export interface CameraPose {
  /** True → orthographic camera (Top preset). */
  ortho: boolean;
  position: Vec3;
  target: Vec3;
  /** camera.up — must be set before creating OrbitControls (they cache it). */
  up: Vec3;
  /** Orthographic only: half of the visible height at zoom 1 (half width = × aspect). */
  halfHeight: number;
  near: number;
  far: number;
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function safeBox(box: BoxSize): BoxSize {
  return { width: Math.max(box.width, 1), depth: Math.max(box.depth, 1), height: Math.max(box.height, 0.5) };
}

/** Centre of the game box volume. */
export function boxCenter(box: BoxSize): Vec3 {
  const b = safeBox(box);
  return [b.width / 2, b.depth / 2, b.height / 2];
}

/** Distance at which a perspective camera sees a sphere of `radius` whole. */
export function perspectiveFitDistance(radius: number, vfovDeg: number, aspect: number, margin = 1.02): number {
  const vfov = (vfovDeg * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(aspect, 1e-6));
  return (Math.max(radius, 1) / Math.sin(Math.min(vfov, hfov) / 2)) * margin;
}

/** Ortho half height so a `spanX` × `spanY` rectangle (screen axes) fits at `aspect`. */
export function orthoHalfHeight(spanX: number, spanY: number, aspect: number, margin = 1.08): number {
  return Math.max(spanY / 2, spanX / 2 / Math.max(aspect, 1e-6), 1) * margin;
}

/** Unit direction from the target toward the camera for a perspective preset. */
export function presetDirection(preset: Exclude<CameraPreset, 'top'>, orientation: ViewOrientation = DEFAULT_VIEW_ORIENTATION): Vec3 {
  const { right, near, up } = viewAxes(orientation);
  switch (preset) {
    case 'front':
      return norm(add(near, up, 0.12));
    case 'side':
      return norm(add(right, up, 0.12));
    case 'iso':
      return norm(add(add(right, near, 1.4), up, 1.5));
  }
}

/**
 * Camera pose for a preset, framing the whole game box. `wallMargin` is the
 * extra outline around the inner box (the drawn walls) that Top keeps visible.
 */
export function presetPose(
  preset: CameraPreset,
  box: BoxSize,
  aspect: number,
  opts: { fovDeg?: number; orientation?: ViewOrientation; wallMargin?: number } = {},
): CameraPose {
  const b = safeBox(box);
  const orientation = opts.orientation ?? DEFAULT_VIEW_ORIENTATION;
  const center = boxCenter(b);
  if (preset === 'top') {
    const m = 2 * (opts.wallMargin ?? 3);
    const halfHeight = orthoHalfHeight(b.width + m, b.depth + m, aspect);
    const dist = Math.max(b.width, b.depth, b.height) * 2 + 100;
    return {
      ortho: true,
      position: [center[0], center[1], center[2] + dist],
      target: center,
      up: viewAxes(orientation).screenUp,
      halfHeight,
      near: 0.1,
      far: dist * 4,
    };
  }
  const radius = 0.5 * Math.hypot(b.width, b.depth, b.height);
  const dist = perspectiveFitDistance(radius, opts.fovDeg ?? 35, aspect);
  return {
    ortho: false,
    position: add(center, presetDirection(preset, orientation), dist),
    target: center,
    up: [0, 0, 1],
    halfHeight: 0,
    near: Math.max(dist / 200, 0.5),
    far: dist * 20,
  };
}

/** Client (CSS pixel) coordinates → normalised device coordinates in [−1, 1]. */
export function clientToNdc(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  return [((clientX - rect.left) / w) * 2 - 1, -((clientY - rect.top) / h) * 2 + 1];
}

/**
 * Intersect the ray `origin + t·dir` (t ≥ 0) with the horizontal plane at
 * height `z`. Returns game‑frame [x, y], or null when the ray is parallel to
 * the plane or points away from it.
 */
export function rayPlaneZ(origin: Vec3, dir: Vec3, z: number): [number, number] | null {
  if (Math.abs(dir[2]) < 1e-9) return null;
  const t = (z - origin[2]) / dir[2];
  if (!(t >= 0) || !Number.isFinite(t)) return null;
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t];
}

/** New camera position and target after recentring the target on (x, y), keeping the view direction. */
export function recenter(position: Vec3, target: Vec3, x: number, y: number): { position: Vec3; target: Vec3 } {
  const d: Vec3 = [x - target[0], y - target[1], 0];
  return { position: add(position, d), target: add(target, d) };
}
