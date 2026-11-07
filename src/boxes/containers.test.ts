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

  // Raised material per cell (the floor below the curve), analytic.
  // Ramp of length L, height h at one wall: area under R − √(R² − (L − d)²) over d ∈ [0, L], R = (L² + h²)/(2h).
  const rampArea = (L: number, h: number) => {
    const R = (L * L + h * h) / (2 * h);
    return R * L - (L * Math.sqrt(R * R - L * L) + R * R * Math.asin(L / R)) / 2;
  };
  const rampAt = (L: number, h: number, d: number) => {
    const R = (L * L + h * h) / (2 * h);
    return d >= L ? 0 : R - Math.sqrt(R * R - (L - d) ** 2);
  };
  const coveEdge = (r: number) => (1 - Math.PI / 4) * r * r; // cross-section of one coved edge
  // All four walls: a coved edge along every wall, minus the four corners where two edges overlap
  // (∫∫ min(arc(dx), arc(dy)) over the r × r corner = r³·(5/3 − π/2)).
  const coveAll = (w: number, d: number, r: number) => coveEdge(r) * 2 * (w + d) - 4 * r ** 3 * (5 / 3 - Math.PI / 2);
  const top = FLOOR + 20;
  // Highest material in a 0.2 × 0.2 column around (x, y): on a slope that is the floor 0.1 mm nearer the wall.
  const floorAt = (s: ReturnType<typeof itemTray.build>, x: number, y: number) =>
    k.bounds(k.intersection([s, k.box(0.2, 0.2, top - 1, [x - 0.1, y - 0.1, 0])])).max[2];

  it('cove floor: adds the rounded-edge material in every cell (all, long, short walls)', () => {
    expect(rampArea(8, 8)).toBeCloseTo(coveEdge(8), 9); // a cove is a quarter-circle ramp
    for (const [columns, rows] of [[1, 1], [2, 1], [3, 2]]) {
      const flat = k.volume(itemTray.build(item(itemTray, { columns, rows }), k));
      for (const coveRadius of [3, 8, 14.5]) {
        for (const coveSides of ['all', 'long', 'short']) {
          const it = item(itemTray, { columns, rows, floorShape: 'cove', coveSides, coveRadius });
          const s = expectFootprintMatchesSolid(itemTray, it);
          // long: the walls along X (40 long, 2 of them); short: along Y (30).
          const perCell = coveSides === 'all' ? coveAll(40, 30, coveRadius) : 2 * coveEdge(coveRadius) * (coveSides === 'long' ? 40 : 30);
          const expected = columns * rows * perCell;
          expect(Math.abs(k.volume(s) - flat - expected) / expected).toBeLessThan(0.01);
          expect(itemTray.validate!(it)).toEqual([]);
        }
      }
    }
  });

  it('cove floor: the curve meets the floor r from the walls and the walls at floorZ + r', () => {
    const s = itemTray.build(item(itemTray, { columns: 2, rows: 2, floorShape: 'cove', coveRadius: 8 }), k);
    for (const [cx, cy] of [[WALL, WALL], [WALL + 41.2, WALL + 31.2]]) {
      expect(floorAt(s, cx + 20, cy + 15)).toBeCloseTo(FLOOR, 1);
      expect(floorAt(s, cx + 8.2, cy + 15)).toBeCloseTo(FLOOR, 1);
      for (const [x, y] of [[cx + 20, cy + 2], [cx + 2, cy + 15], [cx + 38, cy + 15], [cx + 20, cy + 28]]) {
        expect(Math.abs(floorAt(s, x, y) - (FLOOR + rampAt(8, 8, 1.9)))).toBeLessThan(0.05);
      }
      // Corner: the higher of the two coves (2.9 mm from both walls at the probe's corner); no ledge at r.
      expect(Math.abs(floorAt(s, cx + 3, cy + 3) - (FLOOR + rampAt(8, 8, 2.9)))).toBeLessThan(0.05);
      expect(Math.abs(floorAt(s, cx + 3, cy + 1) - (FLOOR + rampAt(8, 8, 0.9)))).toBeLessThan(0.05);
      expect(floorAt(s, cx + 1, cy + 1)).toBeLessThan(FLOOR + 8 - 0.5);
    }
    // long only: the left / right walls (along Y) stay square.
    const long = itemTray.build(item(itemTray, { floorShape: 'cove', coveSides: 'long', coveRadius: 8 }), k);
    expect(floorAt(long, WALL + 0.15, WALL + 15)).toBeCloseTo(FLOOR, 1);
    expect(floorAt(long, WALL + 20, WALL + 2)).toBeGreaterThan(FLOOR + 1);
  });

  it('ramp floor: one wall or two opposite walls, raised material in every cell', () => {
    for (const [columns, rows] of [[1, 1], [2, 1], [3, 2]]) {
      const flat = k.volume(itemTray.build(item(itemTray, { columns, rows }), k));
      for (const rampWall of ['front', 'back', 'left', 'right', 'front-back', 'left-right']) {
        for (const [rampLength, rampHeight] of [[0, 0], [12, 6], [15, 15]]) {
          const it = item(itemTray, { columns, rows, floorShape: 'ramp', rampWall, rampLength, rampHeight });
          const s = expectFootprintMatchesSolid(itemTray, it);
          const alongX = rampWall === 'front' || rampWall === 'back' || rampWall === 'front-back';
          const [along, span] = alongX ? [40, 30] : [30, 40];
          const sides = rampWall.includes('-') ? 2 : 1;
          const L = rampLength || (sides === 2 ? 0.4 : 0.5) * span;
          const h = rampHeight || Math.min(15, L);
          const expected = columns * rows * sides * rampArea(L, h) * along;
          expect(Math.abs(k.volume(s) - flat - expected) / expected).toBeLessThan(0.01);
          expect(itemTray.validate!(it)).toEqual([]);
        }
      }
    }
  });

  it('ramp floor: floorZ + height at the ramp wall, flat beyond the ramp length and at the other walls', () => {
    const L = 15;
    const h = 8;
    for (const rampWall of ['front', 'right', 'left-right']) {
      const s = itemTray.build(item(itemTray, { columns: 2, rows: 2, floorShape: 'ramp', rampWall, rampLength: L, rampHeight: h }), k);
      for (const [cx, cy] of [[WALL, WALL], [WALL + 41.2, WALL + 31.2]]) {
        const near = FLOOR + rampAt(L, h, 0.05);
        expect(near).toBeGreaterThan(FLOOR + h - 0.3);
        if (rampWall === 'front') {
          expect(Math.abs(floorAt(s, cx + 20, cy + 0.15) - near)).toBeLessThan(0.1);
          expect(floorAt(s, cx + 20, cy + 29.85)).toBeCloseTo(FLOOR, 1); // back wall: flat
          expect(floorAt(s, cx + 20, cy + L + 0.2)).toBeCloseTo(FLOOR, 1);
          expect(Math.abs(floorAt(s, cx + 20, cy + 5) - (FLOOR + rampAt(L, h, 4.9)))).toBeLessThan(0.05);
        } else {
          expect(Math.abs(floorAt(s, cx + 39.85, cy + 15) - near)).toBeLessThan(0.1);
          const left = floorAt(s, cx + 0.15, cy + 15);
          if (rampWall === 'right') expect(left).toBeCloseTo(FLOOR, 1);
          else expect(Math.abs(left - near)).toBeLessThan(0.1);
          expect(floorAt(s, cx + 20, cy + 15)).toBeCloseTo(FLOOR, 1);
        }
      }
    }
  });

  it('dividers are always full height; dividerHeight is not a param and is ignored', () => {
    expect(itemTray.params.map((p) => p.key)).not.toContain('dividerHeight');
    for (const floorShape of ['flat', 'cove', 'ramp']) {
      const full = k.volume(itemTray.build(item(itemTray, { columns: 3, rows: 2, floorShape }), k));
      const old = item(itemTray, { columns: 3, rows: 2, floorShape, dividerHeight: 8 });
      expect(k.volume(expectFootprintMatchesSolid(itemTray, old))).toBeCloseTo(full, 6);
      expect(itemTray.validate!(item(itemTray, { columns: 3, dividerHeight: 30 }))).toEqual([]);
      const areas = itemTray.bearingAreas!(old).filter((a) => a.name === 'divider');
      expect(areas).toHaveLength(3);
      for (const a of areas) {
        expect(a.role ?? 'bearing').toBe('bearing');
        expect(a.height).toBeCloseTo(FLOOR + 20, 9);
      }
    }
  });

  it('stacking variants build and validate', () => {
    for (const st of stackVariants) {
      for (const floorShape of ['flat', 'cove', 'ramp']) {
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
    const v = (params: ItemParams) => itemTray.validate!(item(itemTray, params));
    // Cove: radius below half the span across the coved walls, at most the inner height.
    expect(v({ floorShape: 'cove', coveRadius: 0 })).toEqual(['Cove radius must be greater than 0 (is 0).']);
    expect(v({ floorShape: 'cove', coveRadius: 15 })).toEqual(['Cove radius (15 mm) must be less than half the cell depth (15 mm).']);
    expect(v({ floorShape: 'cove', coveRadius: 14.5 })).toEqual([]);
    expect(v({ floorShape: 'cove', coveSides: 'short', coveRadius: 18 })).toEqual([]);
    expect(v({ floorShape: 'cove', coveSides: 'short', coveRadius: 20 })).toEqual(['Cove radius (20 mm) must be less than half the cell width (20 mm).']);
    expect(v({ floorShape: 'cove', coveSides: 'short', coveRadius: 18, innerHeight: 10 })).toEqual([
      'Cove radius (18 mm) must not be more than the inner height (10 mm).',
    ]);
    expect(v({ floorShape: 'cove', coveRadius: 10, innerHeight: 10 })).toEqual([]);
    expect(v({ floorShape: 'flat', coveRadius: 50, rampHeight: 50 })).toEqual([]);
    // Ramp: length within the span (half of it with two walls), height ≤ inner height and ≤ length.
    expect(v({ floorShape: 'ramp', rampLength: -1 })).toEqual(['Ramp length must not be negative (is -1).']);
    expect(v({ floorShape: 'ramp', rampHeight: -2 })).toEqual(['Ramp height must not be negative (is -2).']);
    expect(v({ floorShape: 'ramp', rampLength: 30, rampHeight: 20 })).toEqual([]);
    expect(v({ floorShape: 'ramp', rampLength: 31 })).toEqual(['Ramp length (31 mm) must not be more than the cell depth (30 mm).']);
    expect(v({ floorShape: 'ramp', rampWall: 'left-right', rampLength: 21 })).toEqual([
      'Ramp length (21 mm) must not be more than half the cell width (20 mm) with ramps on two walls.',
    ]);
    expect(v({ floorShape: 'ramp', rampWall: 'right', rampLength: 30, rampHeight: 21 })).toEqual([
      'Ramp height (21 mm) must not be more than the inner height (20 mm).',
    ]);
    expect(v({ floorShape: 'ramp', rampWall: 'front-back', rampHeight: 13 })).toEqual([
      'Ramp height (13 mm) must not be more than the ramp length (12 mm): a curve that starts flat on the floor cannot climb higher than it runs without leaning over.',
    ]);
    // Automatic values always validate: front-back of the default cell → length 12, height min(15, 12).
    for (const rampWall of ['front', 'back', 'left', 'right', 'front-back', 'left-right']) expect(v({ floorShape: 'ramp', rampWall })).toEqual([]);
  });

  it('floor params: shown only for their floor shape', () => {
    const spec = (key: string) => itemTray.params.find((p) => p.key === key)!;
    expect(itemTray.params.map((p) => p.key)).not.toContain('scoopRise');
    expect(spec('floorShape')).toMatchObject({ default: 'flat', group: 'Floor' });
    expect(spec('coveRadius')).toMatchObject({ label: 'Cove radius', default: 8, min: 1, unit: 'mm', group: 'Floor' });
    expect(spec('coveSides')).toMatchObject({ default: 'all' });
    expect(spec('rampWall')).toMatchObject({ default: 'front' });
    for (const key of ['coveSides', 'coveRadius']) {
      expect(spec(key).visibleIf!({ floorShape: 'cove' })).toBe(true);
      expect(spec(key).visibleIf!({ floorShape: 'ramp' })).toBe(false);
    }
    for (const key of ['rampWall', 'rampLength', 'rampHeight']) {
      expect(spec(key).visibleIf!({ floorShape: 'ramp' })).toBe(true);
      expect(spec(key).visibleIf!({ floorShape: 'flat' })).toBe(false);
    }
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

  it('with a recessed base the slab under the groove clears the recess', () => {
    const recess = 2 + 0.15; // lipHeight + clearance
    const grooveFloor = recess + 0.4;
    const it = item(cardTrayFlat, { stackBottom: 'recess' });
    // Raised by the extra slab, and by exactly that (gaps on); lip adds on top.
    expect(cardTrayFlat.footprint(it).height).toBeCloseTo(grooveFloor + 2 + 30, 9);
    expect(cardTrayFlat.footprint(item(cardTrayFlat, { stackBottom: 'recess', stackTop: 'lip' })).height).toBeCloseTo(grooveFloor + 2 + 30 + 2, 9);
    // Without gaps the floor is not raised and the extra does not apply.
    expect(cardTrayFlat.footprint(item(cardTrayFlat, { stackBottom: 'recess', gapWidth: 0 })).height).toBeCloseTo(FLOOR + 30, 9);
    // A floor already thicker than recess + 0.4 is kept.
    expect(cardTrayFlat.footprint(item(cardTrayFlat, { stackBottom: 'recess' }, WALL, 4)).height).toBeCloseTo(4 + 2 + 30, 9);
    expectFootprintMatchesSolid(cardTrayFlat, it);
    const s = cardTrayFlat.build(it, k);
    // Outer half of the left wall (x from 0 to wall/2) at the gap: material from the recess top up to the groove bottom.
    const y0 = WALL + cd / 2 - 12;
    const outer = k.intersection([s, k.box(WALL / 2 - 0.1, 24, grooveFloor + 1, [0.05, y0, 0])]);
    const bo = k.bounds(outer);
    // The recess ring is wall/2 + clearance wide, so the outer half is only there above the recess top.
    expect(bo.max[2]).toBeCloseTo(grooveFloor, 6);
    const above = k.intersection([s, k.box(WALL / 2 - 0.1, 24, grooveFloor - recess, [0.05, y0, recess])]);
    expect(k.volume(above)).toBeCloseTo((WALL / 2 - 0.1) * 24 * (grooveFloor - recess), 4);
    // The slab under the groove is solid across the whole wall thickness above the recess.
    expect(grooveFloor - recess).toBeCloseTo(0.4, 9);
    // Groove volume: slab grooveFloor + G, minus the recess ring (checked indirectly by validity).
    expect(k.isValid(s)).toBe(true);
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
