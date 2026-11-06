/**
 * Edge overlay geometry for the 3D editor and the item preview: shallow steps
 * between parallel faces (floor grooves, platform ridges) must produce edge
 * lines, coplanar triangulation diagonals must not, and the cache must reuse
 * and dispose geometry per MeshData.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel, MeshData } from '../geometry/types';
import type { PlacedItem, Project } from '../model/types';
import { createEmptyProject } from '../model/types';
import { registerAllBoxTypes } from '../boxes/index';
import { createExporter } from '../services/exporter';
import { EDGE_THRESHOLD_DEG, MeshGeometryCache, meshEdges, meshGeometry } from './meshGeometry';

let k: GeometryKernel;
beforeAll(async () => {
  registerAllBoxTypes();
  k = await createKernel();
});

type Seg = [[number, number, number], [number, number, number]];

function segments(data: MeshData): Seg[] {
  const pos = meshEdges(meshGeometry(data)).getAttribute('position');
  const out: Seg[] = [];
  for (let i = 0; i < pos.count; i += 2) {
    out.push([
      [pos.getX(i), pos.getY(i), pos.getZ(i)],
      [pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)],
    ]);
  }
  return out;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
/** Segments lying entirely in the horizontal plane z. */
const atZ = (segs: Seg[], z: number) => segs.filter(([a, b]) => near(a[2], z) && near(b[2], z));

describe('meshEdges', () => {
  it('uses a 20° crease threshold', () => {
    expect(EDGE_THRESHOLD_DEG).toBe(20);
  });

  it('outlines a plain box with its 12 edges only (no face diagonals)', () => {
    const segs = segments(k.toMesh(k.box(30, 20, 10)));
    expect(segs).toHaveLength(12);
    for (const [a, b] of segs) {
      const axesChanged = [0, 1, 2].filter((i) => !near(a[i], b[i])).length;
      expect(axesChanged).toBe(1);
    }
  });

  it('outlines a 2 mm deep pocket in a flat top face', () => {
    const solid = k.difference(k.box(30, 20, 10), [k.box(10, 6, 5, [5, 5, 8])]);
    const segs = segments(k.toMesh(solid));
    // Pocket bottom rim at z = 8 and pocket mouth at z = 10 (plus the box's own top rim).
    expect(atZ(segs, 8).length).toBeGreaterThanOrEqual(4);
    expect(atZ(segs, 10).length).toBeGreaterThanOrEqual(8);
  });
});

describe('edges of real box types', () => {
  const exporter = createExporter(async () => k);

  function project(item: PlacedItem): Project {
    const p = createEmptyProject();
    p.items = [item];
    return p;
  }

  it('card-tray-flat: the floor grooves show as edges at the groove bottom', async () => {
    const tray = (depth: number): PlacedItem => ({
      id: 't',
      type: 'card-tray-flat',
      label: 't',
      x: 0,
      y: 0,
      rotation: 0,
      params: { columns: 2, gapSides: 'sides', gapWidth: 25, gapFloorDepth: depth, gapReach: 10 },
    });
    const floor = project(tray(0)).settings.defaults.floor;
    const grooved = segments(await exporter.previewMesh(project(tray(2)), 't'));
    const plain = segments(await exporter.previewMesh(project(tray(0)), 't'));
    // The groove bottom sits at the base floor thickness, 2 mm under the raised cavity floor.
    expect(atZ(grooved, floor).length).toBeGreaterThan(0);
    expect(atZ(grooved, floor + 2).length).toBeGreaterThan(0);
    expect(grooved.length).toBeGreaterThan(plain.length);
  });

  it('platform with locating ridges: ridge tops show as edges above the plate', async () => {
    const p = createEmptyProject();
    p.items = [
      { id: 'p', type: 'platform', label: 'p', x: 0, y: 0, rotation: 0, params: { width: 100, depth: 60, cornerStops: false, locateItems: true } },
      {
        id: 'a',
        type: 'item-tray',
        label: 'a',
        x: 10,
        y: 10,
        z: 2,
        rotation: 0,
        params: { stackBottom: 'recess', innerWidth: 40, innerDepth: 30, innerHeight: 20, floorShape: 'flat' },
      },
    ];
    const segs = segments(await exporter.previewMesh(p, 'p'));
    const maxZ = Math.max(...segs.flatMap(([a, b]) => [a[2], b[2]]));
    expect(maxZ).toBeGreaterThan(2);
    expect(atZ(segs, maxZ).length).toBeGreaterThanOrEqual(4);
  });
});

describe('MeshGeometryCache', () => {
  it('reuses geometry per MeshData and disposes what is no longer used', () => {
    const a = k.toMesh(k.box(10, 10, 10));
    const b = k.toMesh(k.box(5, 5, 5));
    const cache = new MeshGeometryCache();
    const ga = cache.get(a);
    expect(cache.get(a)).toBe(ga);
    const gb = cache.get(b);
    expect(cache.size).toBe(2);
    const disposed: string[] = [];
    gb.mesh.addEventListener('dispose', () => disposed.push('mesh'));
    gb.edges.addEventListener('dispose', () => disposed.push('edges'));
    cache.retain(new Set([a]));
    expect(cache.size).toBe(1);
    expect(disposed.sort()).toEqual(['edges', 'mesh']);
    expect(cache.get(a)).toBe(ga);
    cache.dispose();
    expect(cache.size).toBe(0);
  });
});
