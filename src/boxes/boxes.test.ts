import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel } from '../geometry/types';
import type { ItemParams, ResolvedItem } from '../model/types';
import { resolveItem, placedFootprint } from '../model/resolve';
import { getBoxType, listBoxTypes } from './registry';
import { defaultParams, engagementOf, type BoxTypeDefinition } from './types';
import { registerAllBoxTypes, standardBoxTypes, tray, dividedTray, cardTray, spacer, platform } from './index';
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
  it('registers all five types once', () => {
    expect(listBoxTypes().map((d) => d.id).sort()).toEqual(['card-tray', 'divided-tray', 'platform', 'spacer', 'tray']);
    expect(getBoxType('tray')).toBe(tray);
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

describe('tray', () => {
  it('volume = outer − cavity − notches', () => {
    const it = item(tray);
    const fp = tray.footprint(it);
    expect(fp).toEqual({ width: 63.2, depth: 43.2, height: 31.2 });
    const outer = fp.width * fp.depth * fp.height;
    const cavity = 60 * 40 * 30;
    const plain = k.volume(tray.build(item(tray, { fingerNotch: false }), k));
    expect(plain).toBeCloseTo(outer - cavity, 4);
    // Notch: 20 wide, 15 deep, radius 10 → rect 20×5 + half disc, through 1.6 mm, ×2 walls.
    const notchArea = 20 * 5 + (Math.PI * 10 * 10) / 2;
    const expected = outer - cavity - 2 * notchArea * WALL;
    const v = k.volume(tray.build(it, k));
    expect(Math.abs(v - expected) / expected).toBeLessThan(0.002);
    expect(v).toBeLessThan(plain);
  });

  it('notch sides', () => {
    const long = k.volume(tray.build(item(tray, { notchSides: 'long' }), k));
    const short = k.volume(tray.build(item(tray, { notchSides: 'short' }), k));
    const both = k.volume(tray.build(item(tray, { notchSides: 'both' }), k));
    expect(long).toBeCloseTo(short, 3); // same wall thickness, same notch
    expect(both).toBeLessThan(long);
    expect(tray.draw(item(tray, { notchSides: 'both' })).filter((f) => f.kind === 'rect' && f.role === 'notch')).toHaveLength(4);
    expect(tray.draw(item(tray, { fingerNotch: false })).filter((f) => f.kind === 'rect' && f.role === 'notch')).toHaveLength(0);
  });

  it('validates bad params', () => {
    expect(tray.validate!(item(tray, { innerWidth: 0 }))).not.toEqual([]);
    expect(tray.validate!(item(tray, { notchWidth: 70 })).join()).toMatch(/Notch width/);
    expect(tray.validate!(item(tray, { notchDepth: 40 })).join()).toMatch(/floor/);
    expect(tray.validate!(item(tray, {}, 0))).not.toEqual([]);
  });
});

describe('divided-tray', () => {
  it('volume increases with rows and columns', () => {
    const v1 = k.volume(dividedTray.build(item(dividedTray, { rows: 1, columns: 1 }), k));
    const v2 = k.volume(dividedTray.build(item(dividedTray, { rows: 2, columns: 1 }), k));
    const v3 = k.volume(dividedTray.build(item(dividedTray, { rows: 3, columns: 1 }), k));
    const v4 = k.volume(dividedTray.build(item(dividedTray, { rows: 3, columns: 2 }), k));
    expect(v2).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(v2);
    expect(v4).toBeGreaterThan(v3);
    // One full‑height row divider adds 90 × 1.2 × 25.
    expect(v2 - v1).toBeCloseTo(90 * 1.2 * 25, 3);
  });

  it('lower dividers and notches', () => {
    const full = k.volume(dividedTray.build(item(dividedTray), k));
    const low = k.volume(dividedTray.build(item(dividedTray, { dividerHeight: 10 }), k));
    expect(low).toBeLessThan(full);
    const notched = expectFootprintMatchesSolid(dividedTray, item(dividedTray, { fingerNotch: true }));
    expect(k.volume(notched)).toBeLessThan(full);
    // 2 rows × (2 outer walls + 2 column dividers)
    expect(dividedTray.draw(item(dividedTray, { fingerNotch: true })).filter((f) => f.kind === 'rect' && f.role === 'notch')).toHaveLength(8);
  });

  it('draws compartments and dividers', () => {
    const feats = dividedTray.draw(item(dividedTray));
    expect(feats.filter((f) => f.kind === 'rect' && f.role === 'cavity')).toHaveLength(6);
    expect(feats.filter((f) => f.kind === 'rect' && f.role === 'divider')).toHaveLength(3);
  });

  it('validates bad params', () => {
    expect(dividedTray.validate!(item(dividedTray, { dividerHeight: 40 })).join()).toMatch(/Divider height/);
    expect(dividedTray.validate!(item(dividedTray, { dividerThickness: 50 })).join()).toMatch(/too thick/);
    expect(dividedTray.validate!(item(dividedTray, { dividerThickness: 25 })).join()).toMatch(/thicker than the compartments/);
    expect(dividedTray.validate!(item(dividedTray, { rows: 0 })).join()).toMatch(/Rows/);
    expect(dividedTray.validate!(item(dividedTray, { fingerNotch: true, notchWidth: 40 })).join()).toMatch(/Notch width/);
  });
});

describe('card-tray', () => {
  it('flat vs upright footprints', () => {
    const flat = cardTray.footprint(item(cardTray));
    expect(flat.width).toBeCloseTo(63.5 + 2 + 2 * WALL, 9);
    expect(flat.depth).toBeCloseTo(88 + 2 + 2 * WALL, 9);
    expect(flat.height).toBeCloseTo(30 + FLOOR, 9);
    const up = item(cardTray, { orientation: 'upright' });
    const fp = cardTray.footprint(up);
    expect(fp.width).toBeCloseTo(30 + 1 + 2 * WALL, 9);
    expect(fp.depth).toBeCloseTo(63.5 + 2 + 2 * WALL, 9);
    expect(fp.height).toBeCloseTo(88 - 20 + FLOOR, 9);
    expectFootprintMatchesSolid(cardTray, up);
    expect(cardTray.validate!(up)).toEqual([]);
  });

  it('notch placement', () => {
    const flatNotches = cardTray.draw(item(cardTray)).filter((f) => f.kind === 'rect' && f.role === 'notch');
    expect(flatNotches).toHaveLength(2);
    // flat: notches in the short walls (parallel to X) → thin in Y
    for (const n of flatNotches) if (n.kind === 'rect') expect(n.h).toBeCloseTo(WALL, 9);
    const upNotches = cardTray.draw(item(cardTray, { orientation: 'upright' })).filter((f) => f.kind === 'rect' && f.role === 'notch');
    for (const n of upNotches) if (n.kind === 'rect') expect(n.w).toBeCloseTo(WALL, 9);
    const none = cardTray.draw(item(cardTray, { notchWidth: 0 })).filter((f) => f.kind === 'rect' && f.role === 'notch');
    expect(none).toHaveLength(0);
  });

  it('validates bad params', () => {
    expect(cardTray.validate!(item(cardTray, { orientation: 'upright', exposedHeight: 100 })).join()).toMatch(/Exposed height/);
    expect(cardTray.validate!(item(cardTray, { notchWidth: 80 })).join()).toMatch(/Notch width/);
    expect(cardTray.validate!(item(cardTray, { cardWidth: -1 }))).not.toEqual([]);
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

describe('stacking (lip / recess / plug)', () => {
  const W = 63.2;
  const D = 43.2;
  /** Area of the lip ring: outer rect minus the rect inset by wall/2. */
  const lipRing = W * D - (W - WALL) * (D - WALL);
  const plain = () => k.volume(tray.build(item(tray, { fingerNotch: false }), k));

  it('defaults are flat with no engagement', () => {
    const it = item(tray);
    expect(it.params).toMatchObject({ stackTop: 'none', stackBottom: 'none', lipHeight: 2, plugHeight: 2, stackClearance: 0.15 });
    expect(engagementOf(tray, it)).toBe(0);
    for (const def of [tray, dividedTray, cardTray]) {
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
    const it = item(tray, { fingerNotch: false, stackTop: 'lip' });
    expect(tray.footprint(it).height).toBeCloseTo(FLOOR + 30 + 2, 9);
    const s = expectFootprintMatchesSolid(tray, it);
    expect(k.volume(s) - plain()).toBeCloseTo(lipRing * 2, 3);
    expect(tray.validate!(it)).toEqual([]);
  });

  it('recess removes ring area × depth; engagement = lipHeight', () => {
    const it = item(tray, { fingerNotch: false, stackBottom: 'recess' });
    const r = WALL / 2 + 0.15;
    const ring = W * D - (W - 2 * r) * (D - 2 * r);
    const s = expectFootprintMatchesSolid(tray, it);
    expect(plain() - k.volume(s)).toBeCloseTo(ring * (2 + 0.15), 3);
    expect(engagementOf(tray, it)).toBeCloseTo(2, 9);
    expect(tray.validate!(it)).toEqual([]);
    expect(tray.validate!(item(tray, { stackBottom: 'recess' }, 1.0)).join()).toMatch(/Recess leaves only/);
  });

  it('plug adds the pad volume, floor at Z = plugHeight; engagement = plugHeight', () => {
    const it = item(tray, { fingerNotch: false, stackBottom: 'plug' });
    expect(tray.footprint(it).height).toBeCloseTo(2 + FLOOR + 30, 9);
    const s = expectFootprintMatchesSolid(tray, it);
    const pad = (60 - 0.3) * (40 - 0.3) * 2;
    expect(k.volume(s) - plain()).toBeCloseTo(pad, 3);
    expect(engagementOf(tray, it)).toBe(2);
  });

  it('a recessed tray sits on a lipped tray of the same footprint without intersecting', () => {
    const lower = item(tray, { stackTop: 'lip' });
    const upper = item(tray, { stackBottom: 'recess' });
    const lowerSolid = tray.build(lower, k);
    const z = tray.footprint(lower).height - engagementOf(tray, upper);
    const upperSolid = k.translate(tray.build(upper, k), [0, 0, z]);
    expect(k.volume(k.intersection([lowerSolid, upperSolid]))).toBeLessThan(1e-6);
    // and they really engage: lifting the upper less than the lip collides.
    const sunk = k.translate(tray.build(upper, k), [0, 0, z - 0.5]);
    expect(k.volume(k.intersection([lowerSolid, sunk]))).toBeGreaterThan(1);
  });

  it('a plugged tray drops into a same-footprint tray below without intersecting', () => {
    const lower = item(tray);
    const upper = item(tray, { stackBottom: 'plug' });
    const z = tray.footprint(lower).height - engagementOf(tray, upper);
    const upperSolid = k.translate(tray.build(upper, k), [0, 0, z]);
    expect(k.volume(k.intersection([tray.build(lower, k), upperSolid]))).toBeLessThan(1e-6);
  });

  it('finger notches cut through the lip', () => {
    const noNotch = k.volume(tray.build(item(tray, { fingerNotch: false, stackTop: 'lip' }), k));
    const notched = k.volume(tray.build(item(tray, { stackTop: 'lip' }), k));
    const notchedPlain = k.volume(tray.build(item(tray), k));
    // The notch removes the same wall material as without lip, plus the lip slot (20 wide, wall/2 thick, 2 high) ×2.
    expect(noNotch - notched - (plain() - notchedPlain)).toBeCloseTo(2 * 20 * (WALL / 2) * 2, 2);
  });

  it('divided and card trays support the same stacking features', () => {
    for (const [def, params] of [
      [dividedTray, { fingerNotch: true }],
      [cardTray, {}],
      [cardTray, { orientation: 'upright' }],
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
    const lower = item(tray, { fingerNotch: false, innerWidth: 96.8, innerDepth: 96.8 });
    expect(tray.footprint(lower).width).toBeCloseTo(100, 9);
    const p = item(platform);
    const z = tray.footprint(lower).height - engagementOf(platform, p);
    const plate = k.translate(platform.build(p, k), [0, 0, z]);
    expect(k.volume(k.intersection([tray.build(lower, k), plate]))).toBeLessThan(1e-6);
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
