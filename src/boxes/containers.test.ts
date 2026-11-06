import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel } from '../geometry/types';
import type { ItemParams, ResolvedItem } from '../model/types';
import { defaultParams, engagementOf, newItemParams, type BoxTypeDefinition } from './types';
import { cardTrayFlat, itemTray } from './index';

let k: GeometryKernel;
beforeAll(async () => {
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

const rects = (def: BoxTypeDefinition, it: ResolvedItem, role: string) =>
  def.draw(it).filter((f) => f.kind === 'rect' && f.role === role);

const stackVariants: ItemParams[] = [
  { stackTop: 'lip' },
  { stackBottom: 'recess' },
  { stackBottom: 'plug' },
  { stackTop: 'lip', stackBottom: 'recess' },
  { stackTop: 'lip', stackBottom: 'plug' },
];

describe('item-tray', () => {
  it('footprint and volume for several grids', () => {
    for (const [columns, rows] of [[1, 1], [2, 1], [1, 3], [3, 2]]) {
      const it = item(itemTray, { columns, rows });
      const fp = itemTray.footprint(it);
      expect(fp.width).toBeCloseTo(2 * WALL + (columns - 1) * 41.2 + 40, 9);
      expect(fp.depth).toBeCloseTo(2 * WALL + (rows - 1) * 31.2 + 30, 9);
      expect(fp.height).toBeCloseTo(FLOOR + 20, 9);
      const s = expectFootprintMatchesSolid(itemTray, it);
      expect(k.volume(s)).toBeCloseTo(fp.width * fp.depth * fp.height - columns * rows * 40 * 30 * 20, 2);
      expect(rects(itemTray, it, 'cavity')).toHaveLength(columns * rows);
      expect(rects(itemTray, it, 'divider')).toHaveLength(columns - 1 + rows - 1);
      expect(itemTray.validate!(it)).toEqual([]);
    }
  });

  it('scoop floor adds the fillet material (cavity shrinks)', () => {
    const flat = k.volume(itemTray.build(item(itemTray, { columns: 2, rows: 2 }), k));
    for (const scoopSides of ['long', 'short']) {
      const it = item(itemTray, { columns: 2, rows: 2, floorShape: 'scoop', scoopSides });
      const s = expectFootprintMatchesSolid(itemTray, it);
      const along = scoopSides === 'long' ? 40 : 30; // the scooped walls run along the long (X, 40) or short (Y, 30) side
      const fillet = (10 * 10 - (Math.PI * 10 * 10) / 4) * along;
      const added = k.volume(s) - flat;
      expect(added).toBeGreaterThan(0);
      expect(Math.abs(added - 4 * 2 * fillet) / (8 * fillet)).toBeLessThan(0.02);
      expect(itemTray.validate!(it)).toEqual([]);
    }
  });

  it('scoop radius is clamped to the height and half the span', () => {
    const big = item(itemTray, { floorShape: 'scoop', scoopRadius: 100 });
    expectFootprintMatchesSolid(itemTray, big);
    const r = 15; // half of the 30 mm span across the long walls
    const flat = k.volume(itemTray.build(item(itemTray), k));
    const fillet = (r * r - (Math.PI * r * r) / 4) * 40;
    expect(Math.abs(k.volume(itemTray.build(big, k)) - flat - 2 * fillet) / (2 * fillet)).toBeLessThan(0.02);
  });

  it('lowered dividers', () => {
    const full = k.volume(itemTray.build(item(itemTray, { columns: 3 }), k));
    const low = expectFootprintMatchesSolid(itemTray, item(itemTray, { columns: 3, dividerHeight: 8 }));
    expect(full - k.volume(low)).toBeCloseTo(2 * 1.2 * 30 * 12, 2);
    const areas = itemTray.bearingAreas!(item(itemTray, { columns: 3, dividerHeight: 8 })).filter((a) => a.name === 'divider');
    expect(areas.map((a) => a.role)).toEqual(['low', 'low']);
  });

  it('stacking variants build and validate', () => {
    for (const st of stackVariants) {
      for (const floorShape of ['flat', 'scoop']) {
        const it = item(itemTray, { columns: 2, rows: 2, floorShape, ...st });
        expectFootprintMatchesSolid(itemTray, it);
        expect(itemTray.validate!(it)).toEqual([]);
      }
    }
    expect(newItemParams(itemTray)).toMatchObject({ stackTop: 'lip', stackBottom: 'recess' });
    expect(engagementOf(itemTray, item(itemTray, { stackBottom: 'recess' }))).toBe(2);
  });

  it('validates bad params', () => {
    expect(itemTray.validate!(item(itemTray, { columns: 0 })).join()).toMatch(/Columns must be a whole number ≥ 1 \(is 0\)/);
    expect(itemTray.validate!(item(itemTray, { rows: 2.5 })).join()).toMatch(/Rows must be a whole number/);
    expect(itemTray.validate!(item(itemTray, { columns: 2, dividerThickness: 0 })).join()).toMatch(/Divider thickness/);
    expect(itemTray.validate!(item(itemTray, { innerWidth: 0 })).join()).toMatch(/Cell width/);
    expect(itemTray.validate!(item(itemTray, { dividerHeight: 30 })).join()).toMatch(/Divider height/);
    expect(itemTray.validate!(item(itemTray, { floorShape: 'scoop', scoopRadius: 0 })).join()).toMatch(/Scoop radius/);
  });
});

describe('card-tray-flat', () => {
  const cw = 63.5 + 2;
  const cd = 88 + 2;

  it('footprint for several columns, gaps on every side setting', () => {
    for (const columns of [1, 2, 4]) {
      for (const gapSides of ['sides', 'ends', 'both']) {
        const it = item(cardTrayFlat, { columns, gapSides });
        const fp = cardTrayFlat.footprint(it);
        expect(fp.width).toBeCloseTo(2 * WALL + (columns - 1) * (cw + 1.2) + cw, 9);
        expect(fp.depth).toBeCloseTo(2 * WALL + cd, 9);
        expect(fp.height).toBeCloseTo(FLOOR + 2 + 30, 9); // floor raised by the 2 mm groove depth
        expectFootprintMatchesSolid(cardTrayFlat, it);
        expect(rects(cardTrayFlat, it, 'cavity')).toHaveLength(columns);
        // One gap per wall / divider parallel to Y (columns + 1), two per cell in the ends.
        const expected = (gapSides !== 'ends' ? columns + 1 : 0) + (gapSides !== 'sides' ? 2 * columns : 0);
        // Wall rects only (reach 0); the groove rects in the cavities come on top.
        const noReach = item(cardTrayFlat, { columns, gapSides, gapReach: 0 });
        expect(rects(cardTrayFlat, noReach, 'notch')).toHaveLength(expected);
        // Each gap has a groove rect per adjacent cavity: one for outer walls, two for shared dividers.
        const grooves = (gapSides !== 'ends' ? 2 + 2 * (columns - 1) : 0) + (gapSides !== 'sides' ? 2 * columns : 0);
        expect(rects(cardTrayFlat, it, 'notch')).toHaveLength(expected + grooves);
        expect(cardTrayFlat.validate!(it)).toEqual([]);
      }
    }
  });

  // Volume of a gapless solid block with `columns` card cavities, floor slab `slab` thick.
  const blockVolume = (columns: number, slab: number) => {
    const W = 2 * WALL + columns * cw + (columns - 1) * 1.2;
    const D = 2 * WALL + cd;
    return W * D * (slab + 30) - columns * cw * cd * 30;
  };

  it('gap volume: full wall height plus the floor groove', () => {
    const G = 2; // default groove depth = how far the floor is raised
    // Two outer side walls, each 25 wide × wall thick × (30 + groove depth).
    const noReach = k.volume(cardTrayFlat.build(item(cardTrayFlat, { gapReach: 0 }), k));
    expect(noReach).toBeCloseTo(blockVolume(1, FLOOR + G) - 2 * 25 * WALL * (30 + G), 2);
    // Default reach 10: the groove also continues 10 mm into the cavity, groove depth deep.
    const gapped = k.volume(cardTrayFlat.build(item(cardTrayFlat), k));
    expect(gapped).toBeCloseTo(blockVolume(1, FLOOR + G) - 2 * 25 * WALL * (30 + G) - 2 * 25 * 10 * G, 2);
    // Without gaps the floor is not raised.
    expect(k.volume(cardTrayFlat.build(item(cardTrayFlat, { gapWidth: 0 }), k))).toBeCloseTo(blockVolume(1, FLOOR), 2);
    expect(cardTrayFlat.footprint(item(cardTrayFlat, { gapWidth: 0 })).height).toBeCloseTo(FLOOR + 30, 9);
  });

  it('the floor groove reaches gapReach into the cavity, no further', () => {
    const fp = 5;
    const reach = 6;
    const G = 0.5;
    const s = cardTrayFlat.build(item(cardTrayFlat, { gapFloorDepth: G, gapReach: reach }), k);
    const y0 = WALL + cd / 2 - 12;
    const top = (x: number) => {
      const b = k.bounds(k.intersection([s, k.box(1, 24, FLOOR + G + 1, [x, y0, 0])]));
      return b.max[2];
    };
    // Just inside the cavity next to the left wall gap: down to the structural floor.
    expect(top(WALL + 0.5)).toBeCloseTo(FLOOR, 6);
    expect(top(WALL + reach - 1.5)).toBeCloseTo(FLOOR, 6);
    // Beyond the reach: the raised cavity floor.
    expect(top(WALL + reach + 0.5)).toBeCloseTo(FLOOR + G, 6);
    expect(top(WALL + fp + 20)).toBeCloseTo(FLOOR + G, 6);
    // Reach is clamped to the cell: huge reach never cuts past the far wall.
    const big = cardTrayFlat.build(item(cardTrayFlat, { gapFloorDepth: G, gapReach: 500 }), k);
    expect(k.isValid(big)).toBe(true);
    const farWall = k.intersection([big, k.box(WALL, 24, 30, [WALL + cw + 0.01, y0, FLOOR + 1])]);
    expect(k.volume(farWall)).toBeLessThan(1e-6); // gap there is the wall's own, wall remains below
  });

  it('the groove never breaks through: exactly `floor` of material under it', () => {
    for (const G of [0.5, 2, 5]) {
      const it = item(cardTrayFlat, { gapFloorDepth: G });
      const s = cardTrayFlat.build(it, k);
      // Probe the left wall at the gap, up to the cavity floor: only the structural floor remains.
      const probe = k.box(WALL - 0.2, 24, FLOOR + G, [0.1, WALL + cd / 2 - 12, 0]);
      const under = k.intersection([s, probe]);
      expect(k.bounds(under).max[2]).toBeCloseTo(FLOOR, 6);
      expect(k.volume(under)).toBeCloseTo((WALL - 0.2) * 24 * FLOOR, 4);
      // Same inside the cavity, in the groove.
      const inCavity = k.intersection([s, k.box(5, 24, FLOOR + G, [WALL + 1, WALL + cd / 2 - 12, 0])]);
      expect(k.volume(inCavity)).toBeCloseTo(5 * 24 * FLOOR, 4);
      expect(cardTrayFlat.footprint(it).height).toBeCloseTo(FLOOR + G + 30, 9);
    }
  });

  it('gaps cut the shared dividers once', () => {
    const it = item(cardTrayFlat, { columns: 2 });
    const notches = rects(cardTrayFlat, it, 'notch');
    expect(notches).toHaveLength(3 + 4); // 3 wall rects + 4 groove rects (one per adjacent cavity)
    const div = notches.find((n) => n.kind === 'rect' && Math.abs(n.x - (WALL + cw)) < 1e-9);
    expect(div).toMatchObject({ w: expect.closeTo(1.2, 9), h: 25 });
    const gapped = k.volume(cardTrayFlat.build(it, k));
    // Walls and divider through the full height plus the 2 mm groove, plus 10 mm of 2 mm deep
    // groove into each cavity per gap: outer left (1 cavity), divider (2 cavities), outer right (1 cavity).
    expect(gapped).toBeCloseTo(blockVolume(2, FLOOR + 2) - 25 * (2 * WALL + 1.2) * (30 + 2) - 25 * 10 * 2 * 4, 2);
  });

  it('stacking variants build and validate', () => {
    for (const st of stackVariants) {
      for (const gapSides of ['sides', 'both']) {
        const it = item(cardTrayFlat, { columns: 2, gapSides, ...st });
        expectFootprintMatchesSolid(cardTrayFlat, it);
        expect(cardTrayFlat.validate!(it)).toEqual([]);
      }
    }
    expect(newItemParams(cardTrayFlat)).toMatchObject({ stackTop: 'lip', stackBottom: 'recess' });
  });

  it('validates bad params', () => {
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { gapWidth: 95 })).join()).toMatch(/Gap width \(95 mm\) must be smaller than the side wall/);
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { gapSides: 'ends', gapWidth: 70 })).join()).toMatch(/end wall/);
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { gapReach: -1 })).join()).toMatch(/Gap reach/);
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { columns: 0 })).join()).toMatch(/Columns/);
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { cardWidth: -1 })).join()).toMatch(/Card width/);
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { clearance: -1 })).join()).toMatch(/Clearance/);
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { gapFloorDepth: -1 })).join()).toMatch(/Groove depth must not be negative/);
    // The groove depth raises the floor, so a deep groove is fine; the structural floor must still exist.
    expect(cardTrayFlat.validate!(item(cardTrayFlat, { gapFloorDepth: 5 }))).toEqual([]);
    expect(k.isValid(cardTrayFlat.build(item(cardTrayFlat, { gapFloorDepth: 5 }), k))).toBe(true);
    expect(cardTrayFlat.validate!(item(cardTrayFlat, {}, WALL, 0)).join()).toMatch(/Floor thickness must be greater than 0 \(is 0\)/);
  });
});
