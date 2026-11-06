/**
 * Imperative three.js scene for the Assembly view (later: the 3D editor).
 *
 * The three.js world is the game box frame itself — no root mirroring — so
 * hit points, positions and matrices are all game‑frame values. How the frame
 * appears on screen is decided by the camera (see assemblyCamera.ts:
 * `ViewOrientation`, `presetPose`).
 *
 * Mouse: left button is NOT used by the camera (free for item editing; a
 * left click without drag picks an item), right‑drag orbits (pans in the Top
 * preset, whose rotation is locked), middle‑drag pans, wheel zooms.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../geometry/types';
import type { BoxDimensions } from '../model/types';
import type { Rect } from '../model/layout';
import type { ItemTint } from './assemblyScene';
import {
  DEFAULT_VIEW_ORIENTATION,
  clientToNdc,
  presetPose,
  rayPlaneZ,
  recenter,
  viewAxes,
  type CameraPreset,
  type Vec3,
  type ViewOrientation,
} from './assemblyCamera';

/** One item in the assembly scene. */
export interface AssemblyEntry {
  id: string;
  /** Mesh in the item local frame; null → draw a footprint placeholder box. */
  mesh: MeshData | null;
  /** Column‑major local → game box frame matrix (see placementMatrix). */
  matrix: number[];
  /** Unrotated outer size (placeholder / selection outline). */
  size: { width: number; depth: number; height: number };
  tint: ItemTint;
  selected: boolean;
}

/** Result of `pickItemAt`: the item hit and the hit point in the game box frame. */
export interface ItemPick {
  id: string;
  /** Game box frame hit point (mm). */
  point: { x: number; y: number; z: number };
  /** Game box frame unit normal of the hit face (null if unknown). */
  normal: { x: number; y: number; z: number } | null;
}

/** Imperative API of the assembly scene (for the editor phases). */
export interface AssemblySceneApi {
  setEntries(entries: AssemblyEntry[]): void;
  setBox(box: BoxDimensions, usable: Rect): void;
  /** Re‑apply the current preset, framing the whole game box. */
  fit(): void;
  setPreset(preset: CameraPreset): void;
  getPreset(): CameraPreset;
  resize(w: number, h: number): void;
  /** Topmost item under the cursor (client/CSS pixel coords), or null. */
  pickItemAt(clientX: number, clientY: number): ItemPick | null;
  /** Game‑frame x/y where the cursor ray meets the horizontal plane at height z; null if it misses. */
  screenToPlane(clientX: number, clientY: number, z: number): { x: number; y: number } | null;
  /** Game‑frame pick ray under the cursor (origin and unit direction). */
  screenRay(clientX: number, clientY: number): { origin: Vec3; dir: Vec3 };
  /**
   * Canvas‑relative CSS pixel position of game‑frame point (x, y, z) (for HTML
   * overlays); null when the point is behind the camera.
   */
  projectToCanvas(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Recentre the camera target on game‑frame (x, y), keeping the view direction and zoom. */
  focusOn(x: number, y: number): void;
  /** The canvas element (for attaching editor pointer handlers). */
  readonly domElement: HTMLCanvasElement;
  dispose(): void;
}

const COLORS: Record<ItemTint, number> = {
  normal: 0xe4d9c2, // print‑plastic off‑white (matches the top view's item fill family)
  problem: 0xf0a040, // overlap / outside usable area / stack fit error
  tall: 0xe5534b, // sticks out of the box (incl. standing cards)
  floating: 0x9cc8f0, // stacked but not fully supported, or may tip
};
const SELECT_COLOR = 0x2563eb;
const FOV = 35;

export interface AssemblySceneOptions {
  /** Left click (no drag) on an item. Omit when the caller handles picking itself (the editor). */
  onPick?(id: string): void;
  preset?: CameraPreset;
  orientation?: ViewOrientation;
}

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);

export function createAssemblyScene(host: HTMLDivElement, opts: AssemblySceneOptions): AssemblySceneApi {
  const orientation = opts.orientation ?? DEFAULT_VIEW_ORIENTATION;
  const axes = viewAxes(orientation);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  const dom = renderer.domElement;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  // From the front‑left, high up (relative to the Top view's screen axes).
  sun.position.copy(v3(axes.right).multiplyScalar(-0.4).add(v3(axes.near)).addScaledVector(v3(axes.up), 1.6)).multiplyScalar(500);
  scene.add(sun);

  // World = game box frame; nothing is mirrored.
  const boxGroup = new THREE.Group();
  const itemGroup = new THREE.Group();
  scene.add(boxGroup, itemGroup);

  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const unitEdges = new THREE.EdgesGeometry(unitBox);
  const outline = new THREE.LineSegments(
    unitEdges,
    new THREE.LineBasicMaterial({ color: SELECT_COLOR, depthTest: false, transparent: true, opacity: 0.9 }),
  );
  outline.matrixAutoUpdate = false;
  outline.renderOrder = 10;
  outline.visible = false;
  itemGroup.add(outline);

  const materials = new Map<string, THREE.Material>();
  function material(tint: ItemTint, selected: boolean, placeholder: boolean): THREE.Material {
    const k = `${tint}|${selected}|${placeholder}`;
    let m = materials.get(k);
    if (!m) {
      const color = new THREE.Color(COLORS[tint]);
      if (selected) color.lerp(new THREE.Color(0xffffff), 0.25);
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        metalness: 0.02,
        flatShading: true,
        emissive: selected ? new THREE.Color(SELECT_COLOR) : new THREE.Color(0x000000),
        emissiveIntensity: selected ? 0.28 : 0,
        transparent: placeholder,
        opacity: placeholder ? 0.4 : 1,
        depthWrite: !placeholder,
        side: placeholder ? THREE.DoubleSide : THREE.FrontSide,
      });
      materials.set(k, m);
    }
    return m;
  }

  const geometries = new Map<MeshData, THREE.BufferGeometry>();
  function geometryFor(data: MeshData): THREE.BufferGeometry {
    let g = geometries.get(data);
    if (!g) {
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      g.setIndex(new THREE.BufferAttribute(data.indices, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      geometries.set(data, g);
    }
    return g;
  }

  const objects = new Map<string, THREE.Mesh>();
  const tmp = new THREE.Matrix4();
  const scaleM = new THREE.Matrix4();

  function setEntries(entries: AssemblyEntry[]) {
    const seen = new Set<string>();
    const usedMeshes = new Set<MeshData>();
    outline.visible = false;
    for (const e of entries) {
      seen.add(e.id);
      let obj = objects.get(e.id);
      if (!obj) {
        obj = new THREE.Mesh(unitBox);
        obj.matrixAutoUpdate = false;
        obj.userData.itemId = e.id;
        itemGroup.add(obj);
        objects.set(e.id, obj);
      }
      const h = Math.max(e.size.height, 0.5);
      tmp.fromArray(e.matrix);
      if (e.mesh) {
        usedMeshes.add(e.mesh);
        obj.geometry = geometryFor(e.mesh);
        obj.matrix.copy(tmp);
      } else {
        obj.geometry = unitBox;
        obj.matrix.copy(tmp).multiply(scaleM.makeScale(e.size.width, e.size.depth, h));
      }
      obj.material = material(e.tint, e.selected, !e.mesh);
      obj.matrixWorldNeedsUpdate = true;
      if (e.selected) {
        outline.matrix.copy(tmp).multiply(scaleM.makeScale(e.size.width, e.size.depth, h));
        outline.matrixWorldNeedsUpdate = true;
        outline.visible = true;
      }
    }
    for (const [id, obj] of objects) {
      if (seen.has(id)) continue;
      itemGroup.remove(obj);
      objects.delete(id);
    }
    for (const [data, g] of geometries) {
      if (usedMeshes.has(data)) continue;
      g.dispose();
      geometries.delete(data);
    }
    render();
  }

  /* ---- game box shell ---- */
  const boxMaterials = {
    wall: new THREE.MeshStandardMaterial({ color: 0x7b8794, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    floor: new THREE.MeshBasicMaterial({ color: 0xe8ebef, side: THREE.DoubleSide }),
    rim: new THREE.LineBasicMaterial({ color: 0x4b5563, transparent: true, opacity: 0.55 }),
    usable: new THREE.LineDashedMaterial({ color: 0x8b95a5, dashSize: 4, gapSize: 3 }),
  };
  let boxDims: BoxDimensions = { width: 1, depth: 1, height: 1 };
  let wallT = 1;
  let fittedKey = '';

  function clearBox() {
    for (const child of [...boxGroup.children]) {
      boxGroup.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
  }

  function setBox(box: BoxDimensions, usable: Rect) {
    clearBox();
    const W = Math.max(box.width, 1);
    const D = Math.max(box.depth, 1);
    const H = Math.max(box.height, 0.5);
    boxDims = { width: W, depth: D, height: H };
    const t = Math.min(Math.max(Math.min(W, D) * 0.008, 1), 3);
    wallT = t;
    const wall = (w: number, d: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, H).translate(x + w / 2, y + d / 2, H / 2), boxMaterials.wall);
      m.renderOrder = 5;
      boxGroup.add(m);
    };
    wall(t, D + 2 * t, -t, -t);
    wall(t, D + 2 * t, W, -t);
    wall(W, t, 0, -t);
    wall(W, t, 0, D);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * t, D + 2 * t).translate(W / 2, D / 2, -0.05), boxMaterials.floor);
    boxGroup.add(floor);
    const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, D, H).translate(W / 2, D / 2, H / 2)), boxMaterials.rim);
    boxGroup.add(rim);
    if (usable.width > 0 && usable.depth > 0) {
      const z = 0.05;
      const pts = [
        new THREE.Vector3(usable.x, usable.y, z),
        new THREE.Vector3(usable.x + usable.width, usable.y, z),
        new THREE.Vector3(usable.x + usable.width, usable.y + usable.depth, z),
        new THREE.Vector3(usable.x, usable.y + usable.depth, z),
      ];
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), boxMaterials.usable);
      line.computeLineDistances();
      boxGroup.add(line);
    }
    const key = `${W}|${D}|${H}`;
    if (key !== fittedKey) {
      fittedKey = key;
      fit();
    } else render();
  }

  /* ---- cameras & controls ---- */
  const persp = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  let aspect = 1;
  let orthoHalfHeight = 1;
  let preset: CameraPreset = opts.preset ?? 'iso';
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = preset === 'top' ? ortho : persp;
  let userMoved = false;
  const render = () => renderer.render(scene, camera);
  const onStart = () => {
    userMoved = true;
  };

  function updateOrthoFrustum() {
    ortho.top = orthoHalfHeight;
    ortho.bottom = -orthoHalfHeight;
    ortho.left = -orthoHalfHeight * aspect;
    ortho.right = orthoHalfHeight * aspect;
    ortho.updateProjectionMatrix();
  }

  /** OrbitControls cache camera.up at construction, so they are rebuilt per camera/preset. */
  function makeControls(): OrbitControls {
    const top = preset === 'top';
    const c = new OrbitControls(camera, dom);
    c.enableDamping = false;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.enableRotate = !top;
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: top ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE };
    c.touches = { ONE: top ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.addEventListener('change', render);
    c.addEventListener('start', onStart);
    return c;
  }
  function disposeControls(c: OrbitControls) {
    c.removeEventListener('change', render);
    c.removeEventListener('start', onStart);
    c.dispose();
  }
  let controls = makeControls();

  /** Apply the current preset's pose (framing the game box) and rebuild the controls. */
  function fit() {
    const pose = presetPose(preset, boxDims, aspect, { fovDeg: FOV, orientation, wallMargin: wallT });
    camera = pose.ortho ? ortho : persp;
    camera.up.set(...pose.up);
    camera.position.set(...pose.position);
    camera.near = pose.near;
    camera.far = pose.far;
    camera.zoom = 1;
    if (pose.ortho) {
      orthoHalfHeight = pose.halfHeight;
      updateOrthoFrustum();
    } else {
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
    }
    camera.lookAt(...pose.target);
    disposeControls(controls);
    controls = makeControls();
    controls.target.set(...pose.target);
    controls.update();
    userMoved = false;
    render();
  }

  /* ---- picking & frame conversions ---- */
  const raycaster = new THREE.Raycaster();
  function setRay(clientX: number, clientY: number) {
    const [nx, ny] = clientToNdc(clientX, clientY, dom.getBoundingClientRect());
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  }

  function pickItemAt(clientX: number, clientY: number): ItemPick | null {
    setRay(clientX, clientY);
    const hit = raycaster.intersectObjects([...objects.values()], false)[0];
    const id = hit?.object.userData.itemId as string | undefined;
    if (!hit || !id) return null;
    let normal: ItemPick['normal'] = null;
    if (hit.face) {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      normal = { x: n.x, y: n.y, z: n.z };
    }
    // World = game box frame, so the hit point needs no conversion.
    return { id, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z }, normal };
  }

  function screenToPlane(clientX: number, clientY: number, z: number): { x: number; y: number } | null {
    setRay(clientX, clientY);
    const { origin: o, direction: d } = raycaster.ray;
    const p = rayPlaneZ([o.x, o.y, o.z], [d.x, d.y, d.z], z);
    return p ? { x: p[0], y: p[1] } : null;
  }

  function screenRay(clientX: number, clientY: number): { origin: Vec3; dir: Vec3 } {
    setRay(clientX, clientY);
    const { origin: o, direction: d } = raycaster.ray;
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  const projV = new THREE.Vector3();
  function projectToCanvas(x: number, y: number, z: number): { x: number; y: number } | null {
    camera.updateMatrixWorld();
    projV.set(x, y, z).project(camera);
    if (projV.z > 1 || projV.z < -1) return null;
    const w = dom.clientWidth;
    const h = dom.clientHeight;
    return { x: ((projV.x + 1) / 2) * w, y: ((1 - projV.y) / 2) * h };
  }

  function focusOn(x: number, y: number) {
    const t = controls.target;
    const next = recenter([camera.position.x, camera.position.y, camera.position.z], [t.x, t.y, t.z], x, y);
    camera.position.set(...next.position);
    controls.target.set(...next.target);
    controls.update();
    userMoved = true;
    render();
  }

  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };
  const onUp = (e: PointerEvent) => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return;
    const hit = pickItemAt(e.clientX, e.clientY);
    if (hit) opts.onPick?.(hit.id);
  };
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointerup', onUp);

  // Dev-only: game-box-frame bounds of every item object (for browser checks).
  let debugBounds: (() => unknown) | null = null;
  if (import.meta.env.DEV) {
    debugBounds = () =>
      [...objects].map(([id, obj]) => {
        obj.geometry.computeBoundingBox();
        const b = obj.geometry.boundingBox!.clone().applyMatrix4(obj.matrix);
        const r = (v: number) => Math.round(v * 1000) / 1000;
        // Client coordinates of the footprint centre at the item's top (for click tests).
        scene.updateMatrixWorld();
        const top = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z).applyMatrix4(itemGroup.matrixWorld).project(camera);
        const rect = dom.getBoundingClientRect();
        return {
          id,
          placeholder: obj.geometry === unitBox,
          color: `#${(obj.material as THREE.MeshStandardMaterial).color.getHexString()}`,
          x: r(b.min.x), y: r(b.min.y), z: r(b.min.z), width: r(b.max.x - b.min.x), depth: r(b.max.y - b.min.y), height: r(b.max.z - b.min.z),
          screen: { x: rect.left + ((top.x + 1) / 2) * rect.width, y: rect.top + ((1 - top.y) / 2) * rect.height },
        };
      });
    (window.__bgid ??= {}).assemblyBounds = debugBounds;
  }

  return {
    domElement: dom,
    setEntries,
    setBox,
    fit,
    setPreset(p) {
      preset = p;
      fit();
    },
    getPreset: () => preset,
    pickItemAt,
    screenToPlane,
    screenRay,
    projectToCanvas,
    focusOn,
    resize(w, h) {
      renderer.setSize(w, h);
      aspect = w / h;
      persp.aspect = aspect;
      persp.updateProjectionMatrix();
      updateOrthoFrustum();
      if (!userMoved) fit();
      else render();
    },
    dispose() {
      if (debugBounds && window.__bgid?.assemblyBounds === debugBounds) delete window.__bgid.assemblyBounds;
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      disposeControls(controls);
      clearBox();
      for (const g of geometries.values()) g.dispose();
      geometries.clear();
      for (const m of materials.values()) m.dispose();
      for (const m of Object.values(boxMaterials)) m.dispose();
      (outline.material as THREE.Material).dispose();
      unitEdges.dispose();
      unitBox.dispose();
      renderer.dispose();
      dom.remove();
    },
  };
}
