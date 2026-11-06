/**
 * three.js geometry for kernel meshes, shared by the 3D editor
 * (assemblyRenderer) and the item preview (Preview3D): the face geometry
 * plus a feature‑edge overlay.
 *
 * Why edges: both views draw flat‑shaded, single‑colour meshes without
 * shadows, so two parallel faces at different heights (a 2 mm floor groove,
 * a 2 mm locating ridge on a platform) get exactly the same shade and the
 * step only shows as a thin vertical sliver. Drawing the crease edges (faces
 * meeting at more than EDGE_THRESHOLD_DEG) outlines such steps at any angle.
 * The edges come from the same MeshData, so they never cost a kernel build.
 */
import * as THREE from 'three';
import type { MeshData } from '../geometry/types';

/** Faces meeting at a larger angle than this get an edge line (coplanar triangulation diagonals never do). */
export const EDGE_THRESHOLD_DEG = 20;

/** Error message for a kernel build that produced no triangles. */
export const EMPTY_MESH_ERROR = 'The geometry came out empty (check the parameters for errors)';

/**
 * A kernel mesh as the 3D views may show it: throws when it has no triangles.
 * An invalid CSG input (e.g. a box with a negative size) makes manifold return
 * an empty solid instead of throwing; drawn as is, the item would simply
 * vanish. Treated as a build failure, the views show the placeholder and the
 * error instead.
 */
export function requireNonEmptyMesh(mesh: MeshData): MeshData {
  if (mesh.indices.length < 3 || mesh.positions.length < 9) throw new Error(EMPTY_MESH_ERROR);
  return mesh;
}

/** Indexed BufferGeometry of a kernel mesh, with normals and a bounding sphere/box. */
export function meshGeometry(data: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Feature edges (crease angle > EDGE_THRESHOLD_DEG, plus open boundaries) of a mesh geometry. */
export function meshEdges(geometry: THREE.BufferGeometry): THREE.EdgesGeometry {
  return new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD_DEG);
}

export interface MeshGeometries {
  mesh: THREE.BufferGeometry;
  edges: THREE.EdgesGeometry;
}

/**
 * Face + edge geometry per MeshData object (the editor's mesh cache hands
 * out one MeshData per geometry key, so this is effectively per key).
 * `retain` disposes the entries the scene no longer uses.
 */
export class MeshGeometryCache {
  private readonly map = new Map<MeshData, MeshGeometries>();

  get size(): number {
    return this.map.size;
  }

  get(data: MeshData): MeshGeometries {
    let e = this.map.get(data);
    if (!e) {
      const mesh = meshGeometry(data);
      e = { mesh, edges: meshEdges(mesh) };
      this.map.set(data, e);
    }
    return e;
  }

  /** Dispose and drop every entry whose MeshData is not in `used`. */
  retain(used: ReadonlySet<MeshData>): void {
    for (const [data, e] of this.map) {
      if (used.has(data)) continue;
      e.mesh.dispose();
      e.edges.dispose();
      this.map.delete(data);
    }
  }

  dispose(): void {
    this.retain(new Set());
  }
}
