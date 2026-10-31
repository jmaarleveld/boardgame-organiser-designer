import { beforeEach, describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { fakeBox } from '../model/fakeBox.testutil';
import type { PlacedItem, Project, ProjectSettings } from '../model/types';
import { DEFAULT_SETTINGS, createEmptyProject } from '../model/types';
import { itemRect, layoutSummary } from '../model/layout';
import { placedFootprint } from '../model/resolve';
import { geometryKey } from '../services/exporter';
import { LruCache, applyMatrix, classifyItems, localSize, missingKeys, placementMatrix } from './assemblyScene';
import { safeGeometryKey } from './assemblyMeshes';

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 200, depth: 150, height: 50 },
  tolerance: { x: 2, y: 2 },
};

function item(id: string, x: number, y: number, p: Partial<{ w: number; d: number; h: number }> = {}, rotation: 0 | 90 = 0): PlacedItem {
  return { id, type: 'fake', label: id, x, y, rotation, params: { ...p } };
}

beforeEach(() => {
  clearRegistry();
  registerBoxType(fakeBox);
});

/** XY bounding box of the transformed local box [0,w]×[0,d]×[0,h]. */
function transformedBounds(m: number[], w: number, d: number, h: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const x of [0, w]) for (const y of [0, d]) for (const z of [0, h]) {
    const p = applyMatrix(m, [x, y, z]);
    xs.push(p[0]);
    ys.push(p[1]);
    zs.push(p[2]);
  }
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
  };
}

describe('placementMatrix', () => {
  const cases: PlacedItem[] = [
    item('a', 10, 20, { w: 40, d: 20, h: 10 }, 0),
    item('b', 10, 20, { w: 40, d: 20, h: 10 }, 90),
    item('c', 33.5, 7.25, { w: 17, d: 61, h: 30 }, 90),
    item('d', 0, 0, { w: 25, d: 25, h: 5 }, 90),
  ];

  for (const c of cases) {
    it(`lands the mesh exactly on itemRect (rotation ${c.rotation}, ${String(c.params.w)}×${String(c.params.d)})`, () => {
      const size = localSize(c, settings);
      const m = placementMatrix(c, size.depth);
      const b = transformedBounds(m, size.width, size.depth, size.height);
      const r = itemRect(c, settings);
      const fp = placedFootprint(c, settings);
      expect(b.x).toBeCloseTo(r.x, 9);
      expect(b.y).toBeCloseTo(r.y, 9);
      expect(b.width).toBeCloseTo(fp.width, 9);
      expect(b.depth).toBeCloseTo(fp.depth, 9);
      expect(b.z0).toBeCloseTo(0, 9);
      expect(b.z1).toBeCloseTo(fp.height, 9);
    });
  }

  it('rotation 90 maps the local origin to the top-right corner and local +x to +y', () => {
    const it90 = item('r', 10, 20, { w: 40, d: 20 }, 90);
    const m = placementMatrix(it90, 20);
    expect(applyMatrix(m, [0, 0, 0])).toEqual([30, 20, 0]);
    expect(applyMatrix(m, [40, 0, 0])).toEqual([30, 60, 0]);
    expect(applyMatrix(m, [0, 20, 0])).toEqual([10, 20, 0]);
  });

  it('matches three.js Matrix4 = T(x + d, y, 0) · Rz(90°) and keeps a proper (non-mirroring) rotation', () => {
    const it90 = item('r', 12, 34, { w: 40, d: 20 }, 90);
    const ours = new Matrix4().fromArray(placementMatrix(it90, 20));
    const ref = new Matrix4().makeTranslation(12 + 20, 34, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2));
    ours.elements.forEach((v, i) => expect(v).toBeCloseTo(ref.elements[i], 12));
    expect(ours.determinant()).toBeCloseTo(1, 12);
    const p = new Vector3(40, 20, 7).applyMatrix4(ours);
    expect([p.x, p.y, p.z].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([12, 74, 7]);
  });

  it('localSize undoes the rotation swap', () => {
    expect(localSize(item('r', 0, 0, { w: 40, d: 20, h: 9 }, 90), settings)).toMatchObject({ width: 40, depth: 20, height: 9 });
    expect(localSize(item('r', 0, 0, { w: 40, d: 20, h: 9 }, 0), settings)).toMatchObject({ width: 40, depth: 20, height: 9 });
  });
});

describe('classifyItems', () => {
  it('tints tall items red, overlapping / outside items orange, others neutral', () => {
    const items = [
      item('ok', 1, 1, { w: 40, d: 20, h: 10 }),
      item('tall', 60, 1, { w: 20, d: 20, h: 80 }),
      item('o1', 1, 50, { w: 40, d: 20, h: 10 }),
      item('o2', 20, 60, { w: 40, d: 20, h: 10 }),
      item('out', 190, 100, { w: 40, d: 20, h: 10 }),
      item('tallout', 190, 130, { w: 40, d: 20, h: 90 }),
    ];
    const t = classifyItems(items, settings, layoutSummary(items, settings));
    expect(Object.fromEntries(t)).toEqual({
      ok: 'normal',
      tall: 'tall',
      o1: 'problem',
      o2: 'problem',
      out: 'problem',
      tallout: 'tall',
    });
  });

  it('a too-tall item becomes neutral once the box is high enough', () => {
    const items = [item('tall', 1, 1, { w: 20, d: 20, h: 80 })];
    const s = { ...settings, box: { ...settings.box, height: 80 } };
    expect(classifyItems(items, s, layoutSummary(items, s)).get('tall')).toBe('normal');
  });

  it('parameter warnings alone do not tint', () => {
    const items = [item('narrow', 1, 1, { w: 3, d: 20, h: 10 })];
    const summary = layoutSummary(items, settings);
    expect(summary.warningCount).toBe(1);
    expect(classifyItems(items, settings, summary).get('narrow')).toBe('normal');
  });
});

describe('geometry keys for the mesh cache', () => {
  function project(items: PlacedItem[]): Project {
    return { ...createEmptyProject(), settings, items };
  }

  it('position, rotation and label do not change the key; params/wall/defaults do', () => {
    const base = item('a', 1, 1, { w: 40 });
    const p = project([base]);
    const k = geometryKey(p, base);
    expect(geometryKey(p, { ...base, id: 'b', x: 99, y: 12, rotation: 90, label: 'Other' })).toBe(k);
    // Explicit default value == implicit default.
    expect(geometryKey(p, { ...base, params: { w: 40, d: 20 } })).toBe(k);
    expect(geometryKey(p, { ...base, params: { w: 41 } })).not.toBe(k);
    expect(geometryKey(p, { ...base, wall: 3 })).not.toBe(k);
    const p2 = { ...p, settings: { ...settings, defaults: { wall: 2.4, floor: 1.2 } } };
    expect(geometryKey(p2, base)).not.toBe(k);
  });

  it('safeGeometryKey returns null for unknown types', () => {
    expect(safeGeometryKey(project([]), { ...item('x', 0, 0), type: 'nope' })).toBeNull();
  });

  it('missingKeys dedups identical geometry and skips cached / failed keys', () => {
    const cache = new LruCache<number>(8);
    cache.set('A', 1);
    expect(missingKeys(['A', 'B', null, 'B', 'C', 'D'], cache, new Set(['D']))).toEqual(['B', 'C']);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry beyond capacity', () => {
    const c = new LruCache<number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    expect(c.get('a')).toBe(1); // a is now most recent
    c.set('d', 4);
    expect(c.keys()).toEqual(['c', 'a', 'd']);
    expect(c.has('b')).toBe(false);
  });

  it('peek does not change recency, touch does', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.peek('a');
    c.set('c', 3);
    expect(c.keys()).toEqual(['b', 'c']);
    c.touch(['b']);
    c.set('d', 4);
    expect(c.keys()).toEqual(['b', 'd']);
  });

  it('never evicts protected keys (may temporarily exceed capacity)', () => {
    const c = new LruCache<number>(2);
    const protect = new Set(['a', 'b', 'c']);
    c.set('a', 1, protect);
    c.set('b', 2, protect);
    c.set('c', 3, protect);
    expect(c.size).toBe(3);
    c.set('d', 4, new Set(['d', 'c']));
    expect(c.keys()).toEqual(['c', 'd']);
  });

  it('re-setting an existing key does not grow the cache', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('a', 2);
    expect(c.size).toBe(1);
    expect(c.peek('a')).toBe(2);
  });
});
