import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../geometry/types';
import type { BoxDimensions } from '../model/types';
import type { Rect } from '../model/layout';
import { layoutSummary } from '../model/layout';
import type { AssemblyViewProps } from '../services/contracts';
import { useServices } from '../integration';
import { useStore } from '../state/store';
import { classifyItems, localSize, placementMatrix, type ItemTint } from './assemblyScene';
import { useAssemblyMeshes } from './assemblyMeshes';
import './preview.css';

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

const COLORS: Record<ItemTint, number> = {
  normal: 0xe4d9c2, // print‑plastic off‑white (matches the top view's item fill family)
  problem: 0xf0a040, // overlap / outside usable area
  tall: 0xe5534b, // sticks out of the box
  floating: 0x9cc8f0, // stacked but not fully supported
};
const SELECT_COLOR = 0x2563eb;

interface AssemblyScene {
  setEntries(entries: AssemblyEntry[]): void;
  setBox(box: BoxDimensions, usable: Rect): void;
  fit(): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

function createAssemblyScene(host: HTMLDivElement, onPick: (id: string) => void): AssemblyScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-0.4, -1, 1.6).multiplyScalar(500);
  scene.add(sun);

  /*
   * The game box frame has y growing "down" in the top view with z up, i.e. it
   * is a mirror image of a right‑handed world seen from above. Mirroring y at
   * the root makes the camera‑from‑above view match the top view (x right,
   * y down the screen) — the items are placed with the exact frame matrices
   * below this root.
   */
  const root = new THREE.Group();
  root.scale.set(1, -1, 1);
  scene.add(root);
  const boxGroup = new THREE.Group();
  const itemGroup = new THREE.Group();
  root.add(boxGroup, itemGroup);

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

  /* ---- camera ---- */
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  let userMoved = false;
  const render = () => renderer.render(scene, camera);
  const onStart = () => {
    userMoved = true;
  };
  controls.addEventListener('change', render);
  controls.addEventListener('start', onStart);

  function fit() {
    const { width: W, depth: D, height: H } = boxDims;
    // Display coords: y is mirrored by the root group.
    const center = new THREE.Vector3(W / 2, -D / 2, H / 2);
    const radius = Math.max(0.5 * Math.hypot(W, D, H), 1);
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.02;
    // From the front (top‑view bottom edge), high up: screen top = −y side of the box.
    const dir = new THREE.Vector3(0.1, -0.8, 1.3).normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = Math.max(dist / 200, 0.5);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    userMoved = false;
    render();
  }

  /* ---- picking ---- */
  const raycaster = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    if (!down || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    scene.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects([...objects.values()], false)[0];
    const id = hit?.object.userData.itemId as string | undefined;
    if (id) onPick(id);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

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
        const rect = renderer.domElement.getBoundingClientRect();
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
    setEntries,
    setBox,
    fit,
    resize(w, h) {
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!userMoved) fit();
      else render();
    },
    dispose() {
      if (debugBounds && window.__bgid?.assemblyBounds === debugBounds) delete window.__bgid.assemblyBounds;
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.removeEventListener('change', render);
      controls.removeEventListener('start', onStart);
      controls.dispose();
      clearBox();
      for (const g of geometries.values()) g.dispose();
      geometries.clear();
      for (const m of materials.values()) m.dispose();
      for (const m of Object.values(boxMaterials)) m.dispose();
      (outline.material as THREE.Material).dispose();
      unitEdges.dispose();
      unitBox.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

interface AssemblyCanvasProps {
  entries: AssemblyEntry[];
  box: BoxDimensions;
  usable: Rect;
  /** Increment to re‑fit the camera to the box. */
  fitToken: number;
  onPick(id: string): void;
}

/** three.js viewer for a whole assembly (on‑demand rendering). */
export function AssemblyCanvas({ entries, box, usable, fitToken, onPick }: AssemblyCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AssemblyScene | null>(null);
  const latest = useRef({ entries, box, usable, onPick });
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    latest.current = { entries, box, usable, onPick };
  });

  useEffect(() => {
    sceneRef.current?.setEntries(entries);
  }, [entries]);

  const { width, depth, height } = box;
  useEffect(() => {
    sceneRef.current?.setBox({ width, depth, height }, usable);
  }, [width, depth, height, usable]);

  useEffect(() => {
    if (fitToken) sceneRef.current?.fit();
  }, [fitToken]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let s: AssemblyScene;
    try {
      s = createAssemblyScene(host, (id) => latest.current.onPick(id));
    } catch (e) {
      // WebGL unavailable: this runs once per mount, so no render loop.
      setWebglError(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    sceneRef.current = s;
    const resize = () => s.resize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const { box: b, usable: u, entries: en } = latest.current;
    resize();
    s.setBox(b, u);
    s.setEntries(en);
    return () => {
      ro.disconnect();
      s.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div className="preview3d assembly-canvas">
      <div ref={hostRef} className="preview3d-canvas" />
      {webglError && <div className="preview3d-msg">3D view unavailable: WebGL could not be started.</div>}
    </div>
  );
}

/** Whole game box with every placed item (data from the store; meshes cached per geometry). */
export default function AssemblyView({ className, onPopOut, onClose }: AssemblyViewProps) {
  const { exporter } = useServices();
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const kernelReady = useStore((s) => s.kernelReady);
  const kernelError = useStore((s) => s.kernelError);
  const select = useStore((s) => s.select);
  const [fitToken, setFitToken] = useState(0);
  const { items, settings } = project;

  const meshes = useAssemblyMeshes(project, exporter, kernelReady);
  const summary = useMemo(() => layoutSummary(items, settings), [items, settings]);
  const tints = useMemo(() => classifyItems(items, settings, summary), [items, settings, summary]);
  const { itemKeys, meshes: cached } = meshes;
  const entries = useMemo<AssemblyEntry[]>(
    () =>
      items.map((item) => {
        const size = localSize(item, settings);
        const key = itemKeys.get(item.id) ?? null;
        return {
          id: item.id,
          mesh: (key !== null && cached.byKey.get(key)) || null,
          matrix: placementMatrix(item, size.depth),
          size,
          tint: tints.get(item.id) ?? 'normal',
          selected: item.id === selectedId,
        };
      }),
    [items, settings, tints, selectedId, itemKeys, cached],
  );

  const failed = items.filter((i) => meshes.errorFor(itemKeys.get(i.id) ?? null)).length;
  let status: string | null = null;
  if (items.length) {
    if (!exporter) status = 'Geometry unavailable — showing footprints';
    else if (kernelError) status = 'Geometry engine failed — showing footprints';
    else if (!kernelReady) status = 'Loading geometry engine…';
    else if (meshes.done < meshes.total) status = `Generating ${meshes.done + 1}/${meshes.total}…`;
  }

  return (
    <div className={`assembly ${className ?? ''}`.trim()}>
      <AssemblyCanvas entries={entries} box={settings.box} usable={summary.usable} fitToken={fitToken} onPick={select} />
      <div className="assembly-controls">
        <button type="button" onClick={() => setFitToken((t) => t + 1)} title="Fit the camera to the game box">
          Fit
        </button>
        {onPopOut && (
          <button type="button" onClick={onPopOut} title="Open the assembly in a larger view">
            Pop out
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close assembly view">
            ×
          </button>
        )}
      </div>
      {status && (
        <div className="preview3d-loading assembly-status" role="status">
          {status}
        </div>
      )}
      {failed > 0 && <div className="assembly-failed error-text">{failed} item{failed > 1 ? 's' : ''} could not be generated</div>}
      {!items.length && <div className="preview3d-msg">The game box is empty. Add boxes from the palette.</div>}
    </div>
  );
}
