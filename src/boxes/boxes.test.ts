import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel } from '../geometry/types';
import type { ItemParams, ResolvedItem } from '../model/types';
import { resolveItem, placedFootprint } from '../model/resolve';
import { getBoxType, listBoxTypes } from './registry';
import { defaultParams, engagementOf, type BoxTypeDefinition } from './types';
import { registerAllBoxTypes, standardBoxTypes, itemTray, cardTrayFlat, cardTrayUpright, cardTrayTilted, spacer, platform } from './index';
import { sampleProject } from './sample';
import { layoutSummary } from '../model/layout';

let k: GeometryKernel;
beforeAll(async () => {
  registerAllBoxTypes();
  registerAllBoxTypes(); // idempotent
  k = await createKernel();
});

const WALL = 1.6;
const FLOOR = 1.2;

function item(def: BoxTypeDefinition, params: ItemParams = {}, wall = WALL, floor = FLOOR): ResolvedItem {
  return { id: 'x', type: def.id, label: def.name, wall, floor, params: { ...defaultParams(def), ...params } };
}

function expectFootprintMatchesSolid(def: BoxTypeDefinition, it: ResolvedItem) {
  const fp = def.footprint(it);
  const s = def.build(it, k);
  expect(k.isValid(s)).toBe(true);
  const b = k.bounds(s);
  for (let i = 0; i < 3; i++) expect(Math.abs(b.min[i])).toBeLessThan(1e-6);
  expect(Math.abs(b.max[0] - fp.width)).toBeLessThan(1e-6);
  expect(Math.abs(b.max[1] - fp.depth)).toBeLessThan(1e-6);
  expect(Math.abs(b.max[2] - fp.height)).toBeLessThan(1e-6);
  return s;
}

describe('registry', () => {
  it('registers all standard types once', () => {
    expect(listBoxTypes().map((d) => d.id).sort()).toEqual([
      'card-tray-flat',
      'card-tray-tilted',
      'card-tray-upright',
      'item-tray',
      'platform',
      'spacer',
    ]);
    expect(standardBoxTypes.map((d) => d.id)).toEqual(['item-tray', 'card-tray-flat', 'card-tray-upright', 'card-tray-tilted', 'spacer', 'platform']);
    expect(getBoxType('item-tray')).toBe(itemTray);
  });
});

describe.each(standardBoxTypes.map((d) => [d.id, d] as const))('%s with default params', (_id, def) => {
  it('builds a valid solid whose bounds match the footprint', () => {
    expectFootprintMatchesSolid(def, item(def));
  });
  it('has no validation problems', () => {
    expect(def.validate?.(item(def)) ?? []).toEqual([]);
  });
  it('draws features inside the footprint', () => {
    const it = item(def);
    const fp = def.footprint(it);
    const feats = def.draw(it);
    expect(feats.length).toBeGreaterThan(0);
    for (const f of feats) {
      if (f.kind !== 'rect') continue;
      expect(f.x).toBeGreaterThanOrEqual(-1e-9);
      expect(f.y).toBeGreaterThanOrEqual(-1e-9);
      expect(f.x + f.w).toBeLessThanOrEqual(fp.width + 1e-9);
      expect(f.y + f.h).toBeLessThanOrEqual(fp.depth + 1e-9);
    }
  });
});

describe('spacer', () => {
  it('is a solid block ignoring wall/floor', () => {
    const it = item(spacer, { width: 10, depth: 20, height: 5 }, 5, 5);
    const s = expectFootprintMatchesSolid(spacer, it);
    expect(k.volume(s)).toBeCloseTo(1000, 6);
    expect(spacer.draw(it)).toEqual([{ kind: 'rect', role: 'solid', x: 0, y: 0, w: 10, h: 20 }]);
    expect(spacer.validate!(item(spacer, { height: 0 }))).not.toEqual([]);
  });
});

/** A 1 × 1 item tray with a 60 × 40 × 30 cavity: 63.2 × 43.2 × 31.2 outer. */
const TRAY = { innerWidth: 60, innerDepth: 40, innerHeight: 30 };
const tray = (params: ItemParams = {}, wall = WALL) => item(itemTray, { ...TRAY, ...params }, wall);

describe('stacking (lip / recess / plug)', () => {
  const W = 63.2;
  const D = 43.2;
  /** Area of the lip ring: outer rect minus the rect inset by wall/2. */
  const lipRing = W * D - (W - WALL) * (D - WALL);
  const plain = () => k.volume(itemTray.build(tray(), k));

  it('defaults are flat with no engagement', () => {
    const it = tray();
    expect(k.volume(itemTray.build(it, k))).toBeCloseTo(W * D * 31.2 - 60 * 40 * 30, 4);
    expect(it.params).toMatchObject({ stackTop: 'none', stackBottom: 'none', lipHeight: 2, plugHeight: 2, stackClearance: 0.15 });
    expect(engagementOf(itemTray, it)).toBe(0);
    for (const def of [itemTray, cardTrayFlat, cardTrayUpright, cardTrayTilted]) {
      expect(def.params.filter((p) => p.group === 'Stacking').map((p) => p.key)).toEqual([
        'stackTop',
        'stackBottom',
        'lipHeight',
        'plugHeight',
        'stackClearance',
      ]);
    }
  });

  it('lip adds ring area × lipHeight and raises the footprint', () => {
    const it = tray({ stackTop: 'lip' });
    expect(itemTray.footprint(it).height).toBeCloseTo(FLOOR + 30 + 2, 9);
    const s = expectFootprintMatchesSolid(itemTray, it);
    expect(k.volume(s) - plain()).toBeCloseTo(lipRing * 2, 3);
    expect(itemTray.validate!(it)).toEqual([]);
  });

  it('recess removes ring area × depth; engagement = lipHeight', () => {
    const it = tray({ stackBottom: 'recess' });
    const r = WALL / 2 + 0.15;
    const ring = W * D - (W - 2 * r) * (D - 2 * r);
    const s = expectFootprintMatchesSolid(itemTray, it);
    expect(plain() - k.volume(s)).toBeCloseTo(ring * (2 + 0.15), 3);
    expect(engagementOf(itemTray, it)).toBeCloseTo(2, 9);
    expect(itemTray.validate!(it)).toEqual([]);
    expect(itemTray.validate!(tray({ stackBottom: 'recess' }, 1.0)).join()).toMatch(/Recess leaves only/);
  });

  it('plug adds the pad volume, floor at Z = plugHeight; engagement = plugHeight', () => {
    const it = tray({ stackBottom: 'plug' });
    expect(itemTray.footprint(it).height).toBeCloseTo(2 + FLOOR + 30, 9);
    const s = expectFootprintMatchesSolid(itemTray, it);
    const pad = (60 - 0.3) * (40 - 0.3) * 2;
    expect(k.volume(s) - plain()).toBeCloseTo(pad, 3);
    expect(engagementOf(itemTray, it)).toBe(2);
  });

  it('a recessed tray sits on a lipped tray of the same footprint without intersecting', () => {
    const lower = tray({ stackTop: 'lip' });
    const upper = tray({ stackBottom: 'recess' });
    const lowerSolid = itemTray.build(lower, k);
    const z = itemTray.footprint(lower).height - engagementOf(itemTray, upper);
    const upperSolid = k.translate(itemTray.build(upper, k), [0, 0, z]);
    expect(k.volume(k.intersection([lowerSolid, upperSolid]))).toBeLessThan(1e-6);
    // and they really engage: lifting the upper less than the lip collides.
    const sunk = k.translate(itemTray.build(upper, k), [0, 0, z - 0.5]);
    expect(k.volume(k.intersection([lowerSolid, sunk]))).toBeGreaterThan(1);
  });

  it('a plugged tray drops into a same-footprint tray below without intersecting', () => {
    const lower = tray();
    const upper = tray({ stackBottom: 'plug' });
    const z = itemTray.footprint(lower).height - engagementOf(itemTray, upper);
    const upperSolid = k.translate(itemTray.build(upper, k), [0, 0, z]);
    expect(k.volume(k.intersection([itemTray.build(lower, k), upperSolid]))).toBeLessThan(1e-6);
  });

  it('divided and card trays support the same stacking features', () => {
    for (const [def, params] of [
      [itemTray, { columns: 3, rows: 2 }],
      [cardTrayFlat, {}],
      [cardTrayUpright, {}],
      [cardTrayTilted, {}],
    ] as const) {
      const variants: ItemParams[] = [{ stackTop: 'lip' }, { stackBottom: 'recess' }, { stackBottom: 'plug' }, { stackTop: 'lip', stackBottom: 'plug' }];
      for (const st of variants) {
        const it = item(def, { ...params, ...st });
        expectFootprintMatchesSolid(def, it);
        expect(def.validate!(it)).toEqual([]);
      }
    }
  });
});

describe('platform', () => {
  it('plate on four corner stops', () => {
    const it = item(platform);
    expect(platform.footprint(it)).toEqual({ width: 100, depth: 100, height: 4 });
    const s = expectFootprintMatchesSolid(platform, it);
    expect(k.volume(s)).toBeCloseTo(100 * 100 * 2 + 4 * 6 * 6 * 2, 3);
    expect(engagementOf(platform, it)).toBe(2);
    const feats = platform.draw(it);
    expect(feats.filter((f) => f.kind === 'rect' && f.role === 'solid')).toHaveLength(1);
    const stops = feats.filter((f) => f.kind === 'rect' && f.role === 'divider');
    expect(stops).toHaveLength(4);
    expect(stops[0]).toMatchObject({ x: 1.75, y: 1.75, w: 6, h: 6 });
  });

  it('without stops it is a flat plate with no engagement', () => {
    const it = item(platform, { cornerStops: false });
    expect(platform.footprint(it).height).toBe(2);
    expect(k.volume(expectFootprintMatchesSolid(platform, it))).toBeCloseTo(20000, 6);
    expect(engagementOf(platform, it)).toBe(0);
    expect(platform.draw(it)).toHaveLength(1);
  });

  it('corner stops drop inside the cavity of a same-footprint tray', () => {
    const lower = tray({ innerWidth: 96.8, innerDepth: 96.8 });
    expect(itemTray.footprint(lower).width).toBeCloseTo(100, 9);
    const p = item(platform);
    const z = itemTray.footprint(lower).height - engagementOf(platform, p);
    const plate = k.translate(platform.build(p, k), [0, 0, z]);
    expect(k.volume(k.intersection([itemTray.build(lower, k), plate]))).toBeLessThan(1e-6);
  });

  it('validates', () => {
    expect(platform.validate!(item(platform))).toEqual([]);
    expect(platform.validate!(item(platform, { width: 10 })).join()).toMatch(/do not fit/);
    expect(platform.validate!(item(platform, { thickness: 0 }))).not.toEqual([]);
  });
});

describe('sample project', () => {
  it('fits in the usable area without overlaps or issues and builds', () => {
    const p = sampleProject();
    const { box, tolerance } = p.settings;
    for (const i of p.items) {
      const fp = placedFootprint(i, p.settings);
      expect((i.z ?? 0) + fp.height).toBeLessThanOrEqual(box.height);
      expect(i.x).toBeGreaterThanOrEqual(tolerance.x / 2);
      expect(i.y).toBeGreaterThanOrEqual(tolerance.y / 2);
      expect(i.x + fp.width).toBeLessThanOrEqual(box.width - tolerance.x / 2);
      expect(i.y + fp.depth).toBeLessThanOrEqual(box.depth - tolerance.y / 2);
      const r = resolveItem(i, p.settings);
      const def = getBoxType(i.type);
      expect(def.validate?.(r) ?? []).toEqual([]);
      expect(k.isValid(def.build(r, k))).toBe(true);
    }
    expect(new Set(p.items.map((i) => i.type)).size).toBe(5);
    const summary = layoutSummary(p.items, p.settings);
    expect(summary.issues).toEqual([]);
    // It demonstrates stacking.
    expect(p.items.filter((i) => (i.z ?? 0) > 0).length).toBeGreaterThanOrEqual(3);
  });

  it('stacked sample items do not intersect in 3D', () => {
    const p = sampleProject();
    const placed = p.items.map((i) => {
      const s = getBoxType(i.type).build(resolveItem(i, p.settings), k);
      return { id: i.id, solid: k.translate(s, [i.x, i.y, i.z ?? 0]) };
    });
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        const v = k.volume(k.intersection([placed[a].solid, placed[b].solid]));
        expect(v, `${placed[a].id} ∩ ${placed[b].id}`).toBeLessThan(1e-6);
      }
    }
  });
});
