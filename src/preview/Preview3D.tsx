import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Preview3DProps } from '../services/contracts';
import { meshEdges, meshGeometry } from './meshGeometry';
import './preview.css';

interface Scene3D {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  material: THREE.MeshStandardMaterial;
  render(): void;
  setMesh(mesh: Preview3DProps['mesh']): void;
  dispose(): void;
}

function createScene(host: HTMLDivElement): Scene3D {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Z-up to match the STL frame.
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(150, -200, 150);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(120, -160, 240);
  scene.add(dir);

  const grid = new THREE.GridHelper(400, 40, 0x888888, 0xcccccc);
  grid.rotation.x = Math.PI / 2; // lie in the XY plane
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);

  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8fd6,
    flatShading: true,
    roughness: 0.65,
    metalness: 0.05,
    // Keep the faces behind the edge overlay (no z‑fighting).
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  // Crease edges: make steps between parallel faces (floor grooves, ridges) visible.
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0d1f35, transparent: true, opacity: 0.85 });
  let mesh: THREE.Mesh | null = null;
  let edges: THREE.LineSegments | null = null;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  function setMesh(data: Preview3DProps['mesh']) {
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }
    if (edges) {
      scene.remove(edges);
      edges.geometry.dispose();
      edges = null;
    }
    if (!data) { render(); return; }
    const geo = meshGeometry(data);
    mesh = new THREE.Mesh(geo, material);
    scene.add(mesh);
    edges = new THREE.LineSegments(meshEdges(geo), edgeMaterial);
    scene.add(edges);

    const box = geo.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.05;
    const dirV = new THREE.Vector3(0.6, -0.8, 0.7).normalize();
    camera.position.copy(center).addScaledVector(dirV, dist);
    camera.near = Math.max(dist / 100, 0.1);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    grid.position.set(center.x, center.y, box.min.z - 0.01);
    const gs = Math.max(size.x, size.y) * 2.5;
    grid.scale.setScalar(gs / 400);
    render();
  }

  return {
    renderer, scene, camera, controls, material, render, setMesh,
    dispose() {
      controls.removeEventListener('change', render);
      controls.dispose();
      if (mesh) mesh.geometry.dispose();
      if (edges) edges.geometry.dispose();
      edgeMaterial.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export default function Preview3D({ mesh, loading, className }: Preview3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const meshRef = useRef(mesh);
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    meshRef.current = mesh;
    sceneRef.current?.setMesh(mesh);
  }, [mesh]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let s: Scene3D;
    try {
      s = createScene(host);
    } catch (e) {
      setWebglError(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    sceneRef.current = s;
    const resize = () => {
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      s.renderer.setSize(w, h);
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      s.render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    s.setMesh(meshRef.current);
    return () => {
      ro.disconnect();
      s.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div className={`preview3d ${className ?? ''}`.trim()}>
      <div ref={hostRef} className="preview3d-canvas" />
      {webglError && <div className="preview3d-msg">3D preview unavailable: WebGL could not be started.</div>}
      {!webglError && !mesh && !loading && <div className="preview3d-msg">Select an item to see its 3D preview.</div>}
      {loading && <div className="preview3d-loading">Generating…</div>}
    </div>
  );
}
