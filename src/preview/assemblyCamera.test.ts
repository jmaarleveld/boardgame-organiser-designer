import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import {
  CAMERA_PRESETS,
  clientToNdc,
  orthoHalfHeight,
  perspectiveFitDistance,
  presetPose,
  rayPlaneZ,
  recenter,
  viewAxes,
  type CameraPose,
  type CameraPreset,
  type ViewOrientation,
} from './assemblyCamera';

const box = { width: 200, depth: 150, height: 50 };
const aspect = 1.5;

/** A three.js camera set up exactly as assemblyRenderer's fit() does. */
function cameraFor(pose: CameraPose) {
  const cam = pose.ortho ? new OrthographicCamera() : new PerspectiveCamera(35, aspect);
  cam.up.set(...pose.up);
  cam.position.set(...pose.position);
  cam.near = pose.near;
  cam.far = pose.far;
  if (cam instanceof OrthographicCamera) {
    cam.top = pose.halfHeight;
    cam.bottom = -pose.halfHeight;
    cam.left = -pose.halfHeight * aspect;
    cam.right = pose.halfHeight * aspect;
  }
  cam.updateProjectionMatrix();
  cam.lookAt(...pose.target);
  cam.updateMatrixWorld();
  return cam;
}

const project = (cam: OrthographicCamera | PerspectiveCamera, p: [number, number, number]) => new Vector3(...p).project(cam);
const corners = (): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (const x of [0, box.width]) for (const y of [0, box.depth]) for (const z of [0, box.height]) out.push([x, y, z]);
  return out;
};

describe('presetPose', () => {
  it.each<ViewOrientation>(['y-up', 'y-down'])('Top (%s) is orthographic and looks straight down', (o) => {
    const pose = presetPose('top', box, aspect, { orientation: o });
    expect(pose.ortho).toBe(true);
    expect(pose.position[0]).toBeCloseTo(pose.target[0]);
    expect(pose.position[1]).toBeCloseTo(pose.target[1]);
    expect(pose.position[2]).toBeGreaterThan(box.height);
    const dir = new Vector3();
    cameraFor(pose).getWorldDirection(dir);
    expect(dir.z).toBeCloseTo(-1);
  });

  it('y-up Top: x right, y up the screen (a proper, unmirrored view from above)', () => {
    const cam = cameraFor(presetPose('top', box, aspect, { orientation: 'y-up' }));
    const o = project(cam, [0, 0, 0]);
    const px = project(cam, [100, 0, 0]);
    const py = project(cam, [0, 100, 0]);
    expect(px.x).toBeGreaterThan(o.x);
    expect(px.y).toBeCloseTo(o.y);
    expect(py.y).toBeGreaterThan(o.y); // NDC y grows upward
    expect(py.x).toBeCloseTo(o.x);
  });

  it('y-down Top: y down the screen, which forces x to the left (no mirroring)', () => {
    const cam = cameraFor(presetPose('top', box, aspect, { orientation: 'y-down' }));
    const o = project(cam, [0, 0, 0]);
    expect(project(cam, [0, 100, 0]).y).toBeLessThan(o.y);
    expect(project(cam, [100, 0, 0]).x).toBeLessThan(o.x);
  });

  it('every preset camera keeps a right‑handed (non‑mirrored) screen: right × up = toward viewer', () => {
    for (const o of ['y-up', 'y-down'] as const)
      for (const p of CAMERA_PRESETS) {
        const cam = cameraFor(presetPose(p, box, aspect, { orientation: o }));
        expect(cam.matrixWorld.determinant()).toBeCloseTo(1);
      }
  });

  it.each<CameraPreset>(CAMERA_PRESETS)('%s frames every game box corner', (p) => {
    for (const o of ['y-up', 'y-down'] as const) {
      const cam = cameraFor(presetPose(p, box, aspect, { orientation: o }));
      for (const c of corners()) {
        const n = project(cam, c);
        expect(Math.abs(n.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(n.y)).toBeLessThanOrEqual(1);
        expect(n.z).toBeGreaterThan(-1);
        expect(n.z).toBeLessThan(1);
      }
    }
  });

  it('Front looks from the Top view bottom edge, Side from its right edge', () => {
    for (const o of ['y-up', 'y-down'] as const) {
      const { near, right } = viewAxes(o);
      const front = presetPose('front', box, aspect, { orientation: o });
      const side = presetPose('side', box, aspect, { orientation: o });
      const rel = (pose: CameraPose, i: number) => pose.position[i] - pose.target[i];
      expect(Math.sign(rel(front, 1))).toBe(near[1]);
      expect(Math.abs(rel(front, 0))).toBeLessThan(1e-9);
      expect(Math.sign(rel(side, 0))).toBe(right[0]);
      expect(Math.abs(rel(side, 1))).toBeLessThan(1e-9);
      // the box keeps z up on screen
      const cam = cameraFor(front);
      expect(project(cam, [100, 75, 50]).y).toBeGreaterThan(project(cam, [100, 75, 0]).y);
    }
  });
});

describe('fit helpers', () => {
  it('orthoHalfHeight fits the wider of the two spans', () => {
    expect(orthoHalfHeight(200, 100, 1, 1)).toBe(100);
    expect(orthoHalfHeight(200, 100, 4, 1)).toBe(50);
  });
  it('perspectiveFitDistance grows with radius and narrow aspect', () => {
    expect(perspectiveFitDistance(200, 35, 1)).toBeGreaterThan(perspectiveFitDistance(100, 35, 1));
    expect(perspectiveFitDistance(100, 35, 0.5)).toBeGreaterThan(perspectiveFitDistance(100, 35, 1));
  });
});

describe('frame conversions', () => {
  it('clientToNdc maps the canvas rect to [-1, 1] with y up', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(clientToNdc(10, 20, rect)).toEqual([-1, 1]);
    expect(clientToNdc(210, 120, rect)).toEqual([1, -1]);
    expect(clientToNdc(110, 70, rect)).toEqual([0, 0]);
  });

  it('rayPlaneZ intersects horizontal planes and rejects parallel / backward rays', () => {
    expect(rayPlaneZ([0, 0, 10], [1, 2, -1], 0)).toEqual([10, 20]);
    expect(rayPlaneZ([0, 0, 10], [1, 2, -1], 5)).toEqual([5, 10]);
    expect(rayPlaneZ([0, 0, 10], [1, 0, 0], 0)).toBeNull();
    expect(rayPlaneZ([0, 0, 10], [0, 0, 1], 0)).toBeNull();
  });

  it('a click projected through the Top camera lands on the game‑frame point under it', () => {
    for (const o of ['y-up', 'y-down'] as const) {
      const cam = cameraFor(presetPose('top', box, aspect, { orientation: o }));
      const target: [number, number, number] = [37, 120, 12];
      const n = project(cam, target);
      const rc = new Raycaster();
      rc.setFromCamera(new Vector2(n.x, n.y), cam);
      const { origin: a, direction: d } = rc.ray;
      const hit = rayPlaneZ([a.x, a.y, a.z], [d.x, d.y, d.z], target[2])!;
      expect(hit[0]).toBeCloseTo(37);
      expect(hit[1]).toBeCloseTo(120);
    }
  });

  it('same round trip through a perspective preset', () => {
    const cam = cameraFor(presetPose('iso', box, aspect));
    const n = project(cam, [150, 30, 0]);
    const rc = new Raycaster();
    rc.setFromCamera(new Vector2(n.x, n.y), cam);
    const { origin: a, direction: d } = rc.ray;
    const hit = rayPlaneZ([a.x, a.y, a.z], [d.x, d.y, d.z], 0)!;
    expect(hit[0]).toBeCloseTo(150);
    expect(hit[1]).toBeCloseTo(30);
  });

  it('recenter moves camera and target by the same horizontal offset', () => {
    const r = recenter([10, 20, 30], [1, 2, 3], 5, 7);
    expect(r.target).toEqual([5, 7, 3]);
    expect(r.position).toEqual([14, 25, 30]);
  });
});
