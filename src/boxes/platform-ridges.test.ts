/**
 * Platform locating ridges: the first box whose geometry depends on other
 * items (build context = items resting on it). Geometry, resting / support,
 * cache keys and persistence.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel } from '../geometry/types';
import type { ItemAbove, ItemParams, PlacedItem, Project, ProjectSettings, ResolvedItem } from '../model/types';
import { DEFAULT_SETTINGS } from '../model/types';
import { trayParams } from '../model/fakeBox.testutil';
import { placedFootprint, resolveItem } from '../model/resolve';
import { findOverlaps, itemRect, layoutSummary, restingElevation, unsupportedItems } from '../model/layout';
import { registerAllBoxTypes, platform } from './index';
import { defaultParams, seatDepthOf } from './types';
import { createExporter, geometryKey } from '../services/exporter';
import { createPersistence } from '../services/persistence';

let k: GeometryKernel;
beforeAll(async () => {
  registerAllBoxTypes();
  k = await createKernel();
});

const PLATE = 100 * 100 * 2 + 4 * 6 * 6 * 2; // plate + four corner stops
/** Area of a wall/2 ring along the edge of a w × d footprint. */
const ringArea = (w: number, d: number, t: number) => w * d - (w - 2 * t) * (d - 2 * t);

function above(over: Partial<ItemAbove> = {}): ItemAbove {
  return { id: 'a', x: 10, y: 10, width: 63.2, depth: 43.2, wall: 1.6, stackBottom: 'recess', lipHeight: 2, ...over };
}

function plat(params: ItemParams = {}, itemsAbove?: ItemAbove[]): ResolvedItem {
  return {
    id: 'p',
    type: 'platform',
    label: 'P',
    wall: 1.6,
    floor: 1.2,
    params: { ...defaultParams(platform), ...params },
    ...(itemsAbove ? { context: { itemsAbove } } : {}),
  };
}

function checkSolid(it: ResolvedItem) {
  const fp = platform.footprint(it);
  const s = platform.build(it, k);
  expect(k.isValid(s)).toBe(true);
  const b = k.bounds(s);
  expect(b.min.map((v) => Math.abs(v) < 1e-6)).toEqual([true, true, true]);
  expect(b.max[0]).toBeCloseTo(fp.width, 6);
  expect(b.max[1]).toBeCloseTo(fp.depth, 6);
  expect(b.max[2]).toBeCloseTo(fp.height, 6);
  return s;
}

describe('platform ridge geometry', () => {
  it('locateItems defaults to on and asks for a context only then', () => {
    expect(defaultParams(platform).locateItems).toBe(true);
    expect(platform.usesItemsAbove!(plat())).toBe(true);
    expect(platform.usesItemsAbove!(plat({ locateItems: false }))).toBe(false);
  });

  it('adds a wall/2 ring of lipHeight along a recessed item resting on the plate', () => {
    const it = plat({}, [above()]);
    expect(platform.footprint(it).height).toBe(6);
    expect(seatDepthOf(platform, it)).toBe(2);
    const s = checkSolid(it);
    expect(k.volume(s)).toBeCloseTo(PLATE + ringArea(63.2, 43.2, 0.8) * 2, 3);
    // The ridge sits exactly where the item's recess is: inside its outer edge.
    const ridgeTop = k.intersection([s, k.box(200, 200, 1.5, [-50, -50, 4.5])]);
    const b = k.bounds(ridgeTop);
    expect(b.min[0]).toBeCloseTo(10, 6);
    expect(b.max[0]).toBeCloseTo(73.2, 6);
    expect(b.min[1]).toBeCloseTo(10, 6);
    expect(b.max[1]).toBeCloseTo(53.2, 6);
    // Drawn in the top view as four bars.
    expect(platform.draw(it).filter((f) => f.kind === 'rect' && f.role === 'divider')).toHaveLength(4 + 4);
  });

  it('adds nothing without recessed items, with locateItems off, or without a context', () => {
    for (const it of [
      plat({}, []),
      plat({}, [above({ stackBottom: 'none' }), above({ id: 'b', stackBottom: 'plug', x: 40 })]),
      plat({ locateItems: false }, [above()]),
      plat(),
    ]) {
      expect(platform.footprint(it).height).toBe(4);
      expect(seatDepthOf(platform, it)).toBe(0);
      expect(k.volume(checkSolid(it))).toBeCloseTo(PLATE, 3);
    }
  });

  it('clips a ridge to the plate', () => {
    // Item overhangs the left edge by 20 mm: the left side of the ring is gone.
    const it = plat({}, [above({ x: -20 })]);
    const s = checkSolid(it);
    const t = 0.8;
    const ring = 2 * (43.2 * t) + t * (43.2 - 2 * t);
    expect(k.volume(s)).toBeCloseTo(PLATE + ring * 2, 3);
    // An item whose ring lies completely outside the plate locates nothing.
    const off = plat({}, [above({ x: -70, y: -50, width: 300, depth: 300 })]);
    expect(platform.footprint(off).height).toBe(4);
    expect(platform.describeContext!(off)!.itemIds).toEqual([]);
  });

  it('merges the ridges of edge-to-edge neighbours', () => {
    const it = plat({ width: 140 }, [above({ x: 5 }), above({ id: 'b', x: 68.2, lipHeight: 3 })]);
    expect(platform.footprint(it).height).toBe(7);
    expect(seatDepthOf(platform, it)).toBe(3);
    const s = checkSolid(it);
    const plate = 140 * 100 * 2 + 4 * 6 * 6 * 2;
    const ring = ringArea(63.2, 43.2, 0.8);
    expect(k.volume(s)).toBeCloseTo(plate + ring * 2 + ring * 3, 3);
    expect(platform.describeContext!(it)!.itemIds).toEqual(['a', 'b']);
  });

  it('uses the wall of the item above', () => {
    const it = plat({}, [above({ wall: 3 })]);
    expect(k.volume(checkSolid(it))).toBeCloseTo(PLATE + ringArea(63.2, 43.2, 1.5) * 2, 3);
  });
});

/* ------------------------------------------------------------- layout */

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 300, depth: 200, height: 100 },
};

function placed(id: string, type: string, x: number, y: number, params: ItemParams = {}, z?: number, rotation: 0 | 90 = 0): PlacedItem {
  return { id, type, label: id.toUpperCase(), x, y, rotation, params: trayParams(type, params), ...(z !== undefined ? { z } : {}) };
}

const recess = { stackBottom: 'recess' };

describe('build context', () => {
  it('lists items resting on the plate top in the platform frame, rotation included', () => {
    // Platform 100 × 60 (local), rotated: occupies 60 × 100 in the box.
    const p = placed('p', 'platform', 0, 0, { width: 100, depth: 60 }, undefined, 90);
    const t = placed('t', 'item-tray', 5, 20, { ...recess, innerWidth: 26.8, innerDepth: 36.8 }, 4); // 30 × 40 outer
    const tr = placed('r', 'item-tray', 40, 20, { ...recess, innerWidth: 26.8, innerDepth: 16.8 }, 4, 90); // 20 × 30 placed
    const far = placed('f', 'item-tray', 100, 0, recess, 4);
    const high = placed('h', 'item-tray', 5, 70, recess, 10);
    const r = resolveItem(p, settings, [p, t, tr, far, high]);
    expect(r.context!.itemsAbove).toEqual([
      { id: 'r', x: 20, y: 0, width: 30, depth: 20, wall: 1.6, stackBottom: 'recess', lipHeight: 2 },
      { id: 't', x: 20, y: 25, width: 40, depth: 30, wall: 1.6, stackBottom: 'recess', lipHeight: 2 },
    ]);
    expect(placedFootprint(p, settings, [p, t, tr]).height).toBe(6);
    expect(placedFootprint(p, settings).height).toBe(4);
    // The ridge for t lands under t in the box frame.
    const solid = k.translate(k.rotate(platform.build(r, k), [0, 0, 90]), [60, 0, 0]);
    const ridgeT = k.bounds(k.intersection([solid, k.box(38, 50, 1.5, [0, 15, 4.5])]));
    expect(ridgeT.min[0]).toBeCloseTo(5, 6);
    expect(ridgeT.max[0]).toBeCloseTo(35, 6);
    expect(ridgeT.min[1]).toBeCloseTo(20, 6);
    expect(ridgeT.max[1]).toBeCloseTo(60, 6);
  });

  it('is absent with locateItems off', () => {
    const p = placed('p', 'platform', 0, 0, { locateItems: false });
    expect(resolveItem(p, settings, [p, placed('t', 'item-tray', 5, 5, recess, 4)]).context).toBeUndefined();
  });
});

describe('resting on a ridged platform', () => {
  const p = placed('p', 'platform', 1, 1);

  it('a recessed tray rests on the plate (platform top − lipHeight) and is supported', () => {
    const t = placed('t', 'item-tray', 10, 10, recess, 50);
    // Not resting yet: no ridges, rests on the plate top.
    expect(restingElevation('t', [p, t], settings)).toBe(4);
    const items = [p, { ...t, z: 4 }];
    const rect = itemRect(p, settings, items);
    expect(rect.top).toBe(6);
    expect(restingElevation('t', items, settings)).toBe(rect.top - 2);
    expect(unsupportedItems(items, settings)).toEqual([]);
    expect(findOverlaps(items, settings)).toEqual([]);
    expect(layoutSummary(items, settings).issues).toEqual([]);
    // Sunk into the plate is still an intersection.
    expect(findOverlaps([p, { ...t, z: 3 }], settings)).toEqual([['p', 't']]);
  });

  it('with locateItems off it rests at the plate top, which is the platform top', () => {
    const off = { ...p, params: { locateItems: false } };
    const items = [off, placed('t', 'item-tray', 10, 10, recess, 4)];
    expect(itemRect(off, settings, items).top).toBe(4);
    expect(restingElevation('t', items, settings)).toBe(4);
    expect(unsupportedItems(items, settings)).toEqual([]);
  });

  it('items of different lip heights and flat items all sit on the plate', () => {
    const wide = placed('p', 'platform', 1, 1, { width: 200 });
    const a = placed('a', 'item-tray', 1, 1, recess, 4);
    const b = placed('b', 'item-tray', 64.2, 1, { ...recess, lipHeight: 3 }, 4);
    const c = placed('c', 'item-tray', 127.4, 1, {}, 4);
    const items = [wide, a, b, c];
    expect(itemRect(wide, settings, items).top).toBe(7);
    for (const id of ['a', 'b', 'c']) expect(restingElevation(id, items, settings)).toBe(4);
    expect(layoutSummary(items, settings).issues).toEqual([]);
  });
});

/* ------------------------------------------------------- keys and export */

function project(items: PlacedItem[]): Project {
  return { version: 1, settings, items };
}

describe('geometry keys follow the items on the platform', () => {
  const p = placed('p', 'platform', 1, 1);
  const t = placed('t', 'item-tray', 10, 10, recess, 4);
  const other = placed('o', 'item-tray', 150, 10, recess);

  it('moving or changing an item on the platform changes its key; unrelated moves do not', () => {
    const k0 = geometryKey(project([p, t, other]), p);
    expect(geometryKey(project([p, { ...t, x: 11 }, other]), p)).not.toBe(k0);
    expect(geometryKey(project([p, { ...t, params: { ...recess, lipHeight: 3 } }, other]), p)).not.toBe(k0);
    expect(geometryKey(project([p, { ...t, z: 40 }, other]), p)).not.toBe(k0);
    expect(geometryKey(project([p, t, { ...other, x: 160 }]), p)).toBe(k0);
    // The item's own key ignores its position, and ids/labels do not matter.
    expect(geometryKey(project([p, { ...t, x: 11 }]), t)).toBe(geometryKey(project([p, t]), t));
    expect(geometryKey(project([p, { ...t, id: 'u', label: 'Other' }, other]), p)).toBe(k0);
  });

  it('with locateItems off the key ignores the items on top', () => {
    const off = { ...p, params: { locateItems: false } };
    const k0 = geometryKey(project([off, t]), off);
    expect(geometryKey(project([off, { ...t, x: 11 }]), off)).toBe(k0);
    expect(geometryKey(project([off]), off)).toBe(k0);
  });

  it('the exporter builds the ridges into the STL and the OpenSCAD source', async () => {
    const exporter = createExporter(createKernel);
    const withRidge = await exporter.exportItem(project([p, t]), 'p');
    const bare = await exporter.exportItem(project([p]), 'p');
    expect(withRidge.stl.byteLength).toBeGreaterThan(bare.stl.byteLength);
    expect(withRidge.scad).toMatch(/Based on: T/);
    expect(withRidge.scad).toMatch(/x 6 mm/);
    expect(bare.scad).toMatch(/x 4 mm/);
    const cubes = (s: string) => (s.match(/cube\(/g) ?? []).length;
    expect(cubes(withRidge.scad)).toBe(cubes(bare.scad) + 4);
    const mesh = await exporter.previewMesh(project([p, t]), 'p');
    const maxZ = Math.max(...Array.from(mesh.positions).filter((_, i) => i % 3 === 2));
    expect(maxZ).toBeCloseTo(6, 4);
    // Two identical ridged platforms dedupe into one file.
    const p2 = { ...p, id: 'p2', label: 'P2', x: 1, y: 110 };
    const t2 = { ...t, id: 't2', label: 'T2', y: 119 };
    const zip = await JSZip.loadAsync(await (await exporter.exportAll(project([p, t, p2, t2]))).arrayBuffer());
    expect(Object.keys(zip.files).filter((n) => n.endsWith('.stl'))).toHaveLength(2);
  });
});

describe('persistence', () => {
  it('round-trips locateItems and keeps the geometry key', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, v: string) => void store.set(key, v),
      removeItem: (key: string) => void store.delete(key),
    } as unknown as Storage;
    const persistence = createPersistence(storage);
    const proj = project([
      placed('p', 'platform', 1, 1, { locateItems: false }),
      placed('q', 'platform', 1, 110),
      placed('t', 'item-tray', 10, 119, recess, 4),
    ]);
    const back = persistence.fromJson(persistence.toJson(proj));
    expect(back).toEqual(proj);
    expect(back.items[0].params.locateItems).toBe(false);
    for (const i of proj.items) expect(geometryKey(back, i)).toBe(geometryKey(proj, i));
    persistence.save(proj);
    expect(persistence.load()).toEqual(proj);
  });
});
