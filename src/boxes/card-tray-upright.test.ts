import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel } from '../geometry/types';
import type { ItemParams, ResolvedItem } from '../model/types';
import { defaultParams, engagementOf, keepOutOf, newItemParams } from './types';
import { cardTrayUpright } from './definitions/card-tray-upright';

let k: GeometryKernel;
beforeAll(async () => {
  k = await createKernel();
});

const WALL = 1.6;
const FLOOR = 1.2;
const def = cardTrayUpright;
// Default cell: X = 30 + 1, Y = 63.5 + 2, Z = 88 − 20.
const CW = 31;
const CD = 65.5;
const CH = 68;
// Auto wedge in the long walls: top 60 % of the cell X span, bottom 40 % of the top.
const TOP = 0.6 * CW;
const BOT = 0.4 * TOP;
// Auto wedge in the end walls / dividers: top 60 % of the cell Y span, bottom 40 % of the top.
const ETOP = 0.6 * CD;
const EBOT = 0.4 * ETOP;
const DIV = 1.2;
const LONG = { wedgeEnds: false, wedgeLong: true } as const;
const NONE = { wedgeEnds: false, wedgeLong: false } as const;
const BOTH = { wedgeEnds: true, wedgeLong: true } as const;

function item(params: ItemParams = {}, wall = WALL, floor = FLOOR): ResolvedItem {
  return { id: 'x', type: def.id, label: def.name, wall, floor, params: { ...defaultParams(def), ...params } };
}

function expectFootprintMatchesSolid(it: ResolvedItem) {
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

const rects = (it: ResolvedItem, role: string) => def.draw(it).filter((f) => f.kind === 'rect' && f.role === role);

const stackVariants: ItemParams[] = [
  {},
  { stackTop: 'lip' },
  { stackBottom: 'recess' },
  { stackBottom: 'plug' },
  { stackTop: 'lip', stackBottom: 'recess' },
  { stackTop: 'lip', stackBottom: 'plug' },
];

/** Volume of one wedge through a wall of thickness `t` (plus the lip ring, outer half of the outer wall). */
const wedgeVolume = (top: number, bottom: number, depth: number, lipH = 0, t = WALL) =>
  ((top + bottom) / 2) * depth * t + top * lipH * (WALL / 2);
/** End-wall wedges of `columns` stacks: two outer end walls (with lip) plus columns − 1 dividers (no lip). */
const endsVolume = (columns: number, top = ETOP, bottom = EBOT, depth = 0.6 * CH, lipH = 0, divDepth = depth) =>
  2 * wedgeVolume(top, bottom, depth, lipH) + (columns - 1) * wedgeVolume(top, bottom, divDepth, 0, DIV);

describe('card-tray-upright', () => {
  it('footprint, cavities and wedges for 1, 2, 3 columns', () => {
    for (const columns of [1, 2, 3]) {
      for (const wedges of [true, false]) {
        const it = item({ columns, wedgeEnds: false, wedgeLong: wedges });
        const fp = def.footprint(it);
        expect(fp.width).toBeCloseTo(2 * WALL + (columns - 1) * (CW + 1.2) + CW, 9);
        expect(fp.depth).toBeCloseTo(2 * WALL + CD, 9);
        expect(fp.height).toBeCloseTo(FLOOR + CH, 9);
        expectFootprintMatchesSolid(it);
        expect(rects(it, 'cavity')).toHaveLength(columns);
        expect(rects(it, 'divider')).toHaveLength(columns - 1);
        expect(rects(it, 'notch')).toHaveLength(wedges ? 2 * columns : 0);
        expect(def.validate!(it)).toEqual([]);
      }
    }
  });

  it('wedge notch rects span the top width × wall thickness, centred on the cell', () => {
    const notches = rects(item({ columns: 2, ...LONG }), 'notch');
    expect(notches).toHaveLength(4);
    for (const n of notches) {
      if (n.kind !== 'rect') continue;
      expect(n.w).toBeCloseTo(TOP, 9);
      expect(n.h).toBeCloseTo(WALL, 9);
      expect([0, WALL + CD]).toContainEqual(expect.closeTo(n.y, 9));
      const cx = n.x + n.w / 2;
      expect([WALL + CW / 2, WALL + CW + 1.2 + CW / 2]).toContainEqual(expect.closeTo(cx, 9));
    }
  });

  it('stacking variants build and validate, with and without wedges', () => {
    for (const st of stackVariants) {
      for (const columns of [1, 3]) {
        for (const wedgeEnds of [true, false]) {
          for (const wedgeLong of [true, false]) {
            const it = item({ columns, wedgeEnds, wedgeLong, ...st });
            expectFootprintMatchesSolid(it);
            expect(def.validate!(it)).toEqual([]);
          }
        }
      }
    }
    expect(newItemParams(def)).toMatchObject({ stackTop: 'lip', stackBottom: 'recess' });
    expect(engagementOf(def, item({ stackBottom: 'recess' }))).toBe(2);
  });

  it('wedges remove the trapezoid (auto sizes: top 60 % of the slot, bottom 40 % of the top, depth 60 % of the height)', () => {
    for (const columns of [1, 2]) {
      const plain = k.volume(def.build(item({ columns, ...NONE }), k));
      const cut = k.volume(def.build(item({ columns, ...LONG }), k));
      expect(plain - cut).toBeCloseTo(2 * columns * wedgeVolume(TOP, BOT, 0.6 * CH), 2);
    }
  });

  it('explicit sizes override, auto bottom follows an explicit top, and the lip part', () => {
    const plain = k.volume(def.build(item(NONE), k));
    const deep = k.volume(def.build(item({ wedgeDepth: 25, ...LONG }), k));
    expect(plain - deep).toBeCloseTo(2 * wedgeVolume(TOP, BOT, 25), 2);
    const explicit = expectFootprintMatchesSolid(item({ wedgeTopWidth: 20, wedgeBottomWidth: 5, wedgeDepth: 25, ...LONG }));
    expect(plain - k.volume(explicit)).toBeCloseTo(2 * wedgeVolume(20, 5, 25), 2);
    const autoBottom = k.volume(def.build(item({ wedgeTopWidth: 20, wedgeDepth: 25, ...LONG }), k));
    expect(plain - autoBottom).toBeCloseTo(2 * wedgeVolume(20, 8, 25), 2);
    const lipPlain = k.volume(def.build(item({ ...NONE, stackTop: 'lip' }), k));
    const lipCut = k.volume(expectFootprintMatchesSolid(item({ stackTop: 'lip', ...LONG })));
    expect(lipPlain - lipCut).toBeCloseTo(2 * wedgeVolume(TOP, BOT, 0.6 * CH, 2), 2);
  });

  it('the default wedges leave at least `wall` of material between wedges and at the ends', () => {
    for (const columns of [1, 3]) {
      const it = item({ columns, stackTop: 'lip', ...LONG });
      const s = def.build(it, k);
      const fp = def.footprint(it);
      // A thin slice through the front wall just below the wall top: walk along X and measure the solid runs.
      const z = FLOOR + CH - 0.5;
      const slice = k.intersection([s, k.box(fp.width, WALL - 0.2, 0.2, [0, 0.1, z])]);
      const step = 0.05;
      const runs: number[] = [];
      let run = 0;
      for (let x = step / 2; x < fp.width; x += step) {
        const hit = k.volume(k.intersection([slice, k.box(step, WALL, 1, [x - step / 2, 0, z - 0.1])])) > 1e-9;
        if (hit) run += step;
        else if (run > 0) {
          runs.push(run);
          run = 0;
        }
      }
      if (run > 0) runs.push(run);
      expect(runs).toHaveLength(columns + 1); // ends + one post per divider
      for (const r of runs) expect(r).toBeGreaterThanOrEqual(WALL - 2 * step);
      expect(rects(it, 'notch')).toHaveLength(2 * columns);
    }
  });

  it('two wedge toggles; the size params show when either is on', () => {
    for (const key of ['wedgeTopWidth', 'wedgeBottomWidth', 'wedgeDepth']) {
      const p = def.params.find((x) => x.key === key)!;
      expect(p.visibleIf!({ wedgeEnds: true, wedgeLong: false })).toBe(true);
      expect(p.visibleIf!({ wedgeEnds: false, wedgeLong: true })).toBe(true);
      expect(p.visibleIf!({ wedgeEnds: true, wedgeLong: true })).toBe(true);
      expect(p.visibleIf!({ wedgeEnds: false, wedgeLong: false })).toBe(false);
    }
    expect(def.params.find((x) => x.key === 'wedgeEnds')).toMatchObject({
      kind: 'boolean',
      default: true,
      label: 'Wedges in the end walls and dividers',
      group: 'Wedge',
    });
    expect(def.params.find((x) => x.key === 'wedgeLong')).toMatchObject({ kind: 'boolean', default: false, label: 'Wedges in the long walls', group: 'Wedge' });
    expect(def.params.some((x) => x.key === 'wedges' || x.key === 'wedgeWalls')).toBe(false);
    // Both off: no notches.
    expect(rects(item(NONE), 'notch')).toHaveLength(0);
  });

  it('the wedge cuts the wall from the top down to its depth', () => {
    const s = def.build(item({ wedgeDepth: 25, ...LONG }), k);
    const cx = WALL + CW / 2;
    // A thin probe in the front wall at the cell centre: material only below the wedge bottom.
    const probe = k.box(1, WALL - 0.2, FLOOR + CH, [cx - 0.5, 0.1, 0]);
    const b = k.bounds(k.intersection([s, probe]));
    expect(b.max[2]).toBeCloseTo(FLOOR + CH - 25, 6);
  });

  it('lowered dividers', () => {
    const full = k.volume(def.build(item({ columns: 3, ...LONG }), k));
    const low = expectFootprintMatchesSolid(item({ columns: 3, dividerHeight: 30, ...LONG }));
    expect(full - k.volume(low)).toBeCloseTo(2 * 1.2 * CD * (CH - 30), 2);
    const areas = def.bearingAreas!(item({ columns: 3, dividerHeight: 30 })).filter((a) => a.name === 'divider');
    expect(areas.map((a) => a.role)).toEqual(['low', 'low']);
    expect(def.validate!(item({ columns: 3, dividerHeight: 30 }))).toEqual([]);
    const p = def.params.find((x) => x.key === 'dividerHeight')!;
    expect(p.visibleIf!({ columns: 1 })).toBe(false);
    expect(p.visibleIf!({ columns: 2 })).toBe(true);
  });

  it('keepOut: the standing cards above the outer top, over every cavity', () => {
    const plain = keepOutOf(def, item({ columns: 2 }));
    expect(plain).toHaveLength(2);
    expect(plain[0]).toMatchObject({ x: WALL, y: WALL, width: CW, depth: CD, height: 20 });
    expect(plain[1].x).toBeCloseTo(WALL + CW + 1.2, 9);
    const lip = keepOutOf(def, item({ stackTop: 'lip' }));
    expect(lip).toHaveLength(1);
    expect(lip[0].height).toBeCloseTo(18, 9);
    expect(keepOutOf(def, item({ exposedHeight: 0 }))).toEqual([]);
  });

  it('bearing areas and base features via the framework', () => {
    const it = item({ columns: 2, stackTop: 'lip', stackBottom: 'recess' });
    const areas = def.bearingAreas!(it);
    expect(areas.some((a) => a.role === 'lip')).toBe(true);
    expect(areas.filter((a) => a.name === 'divider')).toHaveLength(1);
    expect(def.baseFeatures!(it).every((f) => f.kind === 'recess')).toBe(true);
  });

  it('validates bad params', () => {
    const msg = (p: ItemParams) => def.validate!(item(p)).join(' ');
    expect(msg({ exposedHeight: -1 })).toMatch(/Exposed height must not be negative/);
    expect(msg({ exposedHeight: 88 })).toMatch(/Exposed height \(88 mm\) must be smaller than the card height \(88 mm\)/);
    expect(msg({ wedgeTopWidth: -1 })).toMatch(/Wedge top width must not be negative/);
    expect(msg({ wedgeBottomWidth: -1 })).toMatch(/Wedge bottom width must not be negative/);
    expect(msg({ wedgeTopWidth: 20, wedgeBottomWidth: 21, ...LONG })).toMatch(/Wedge bottom width \(21 mm\) must not exceed the top width \(20 mm\)/);
    expect(msg({ wedgeBottomWidth: 19, ...LONG })).toMatch(/Wedge bottom width \(19 mm\) must not exceed the top width \(18\.6 mm\)/);
    // Slot 31, wall 1.6: the top must stay below 31 − 2·1.6 = 27.8.
    expect(msg({ wedgeTopWidth: 27.8, ...LONG })).toMatch(/Wedge top width \(27\.8 mm\) must be smaller than 27\.8 mm/);
    expect(def.validate!(item({ wedgeTopWidth: 27.5, ...LONG }))).toEqual([]);
    // Thin walls: at least 1 mm per side.
    expect(def.validate!(item({ wedgeTopWidth: 29.5, ...LONG }, 0.8)).join(' ')).toMatch(/smaller than 29 mm/);
    expect(msg({ wedgeDepth: 70 })).toMatch(/Wedge depth \(70 mm\) must not exceed the inner height \(68 mm\)/);
    expect(msg({ wedgeDepth: -1 })).toMatch(/Wedge depth must not be negative/);
    expect(msg({ cardWidth: 0 })).toMatch(/Card width/);
    expect(msg({ clearance: -1 })).toMatch(/Clearance/);
    expect(msg({ columns: 0 })).toMatch(/Columns/);
    expect(msg({ columns: 2, dividerThickness: 0 })).toMatch(/Divider thickness/);
    expect(msg({ columns: 2, dividerHeight: 80 })).toMatch(/Divider height/);
    // No wedges: the wedge checks are skipped.
    expect(def.validate!(item({ ...NONE, wedgeTopWidth: 50, wedgeBottomWidth: 60, wedgeDepth: 100 }))).toEqual([]);
    expect(def.validate!(item({ wedgeDepth: 68 }))).toEqual([]);
  });

  describe('wedgeEnds (default): end walls and dividers: end walls and dividers, centred on the card width', () => {
    it('builds valid and in bounds for 1 and 3 columns; one notch per end wall and divider', () => {
      for (const columns of [1, 3]) {
        const it = item({ columns });
        expectFootprintMatchesSolid(it);
        expect(def.validate!(it)).toEqual([]);
        const fp = def.footprint(it);
        const notches = rects(it, 'notch');
        expect(notches).toHaveLength(columns + 1); // 2 end walls + columns − 1 dividers
        const xs: number[] = [];
        for (const n of notches) {
          if (n.kind !== 'rect') continue;
          expect(n.h).toBeCloseTo(ETOP, 9);
          expect(n.y + n.h / 2).toBeCloseTo(WALL + CD / 2, 9);
          xs.push(n.x);
          const isEnd = Math.abs(n.x) < 1e-9 || Math.abs(n.x - (fp.width - WALL)) < 1e-9;
          expect(n.w).toBeCloseTo(isEnd ? WALL : DIV, 9);
        }
        const expected = [0, fp.width - WALL];
        for (let j = 0; j < columns - 1; j++) expected.push(WALL + CW + j * (CW + DIV));
        expect(xs.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b).map((x) => expect.closeTo(x, 9)));
      }
    });

    it('removes exactly the trapezoids: outer end walls (with the lip part) and every divider once', () => {
      for (const columns of [1, 3]) {
        const plain = k.volume(def.build(item({ columns, ...NONE }), k));
        const cut = k.volume(def.build(item({ columns }), k));
        expect(plain - cut).toBeCloseTo(endsVolume(columns), 2);
      }
      const lipPlain = k.volume(def.build(item({ columns: 3, ...NONE, stackTop: 'lip' }), k));
      const lipCut = k.volume(expectFootprintMatchesSolid(item({ columns: 3, stackTop: 'lip' })));
      expect(lipPlain - lipCut).toBeCloseTo(endsVolume(3, ETOP, EBOT, 0.6 * CH, 2), 2);
      const plain = k.volume(def.build(item({ columns: 2, ...NONE }), k));
      const explicit = k.volume(def.build(item({ columns: 2, wedgeTopWidth: 30, wedgeBottomWidth: 10, wedgeDepth: 25 }), k));
      expect(plain - explicit).toBeCloseTo(endsVolume(2, 30, 10, 25), 2);
    });

    it('a lowered divider: the cut starts at the divider top and stops max(wall, 1) above the floor', () => {
      const low = { columns: 3, dividerHeight: 30 };
      const plain = k.volume(def.build(item({ ...low, ...NONE }), k));
      const it = item(low);
      const cut = k.volume(expectFootprintMatchesSolid(it));
      expect(def.validate!(it)).toEqual([]);
      // Outer end walls: full auto depth 40.8; dividers: clamped to 30 − 1.6.
      expect(plain - cut).toBeCloseTo(endsVolume(3, ETOP, EBOT, 0.6 * CH, 0, 30 - WALL), 2);
      // A probe in the first divider at the card-width centre: material only up to the clamp.
      const s = def.build(it, k);
      const probe = k.box(DIV - 0.2, 1, FLOOR + CH, [WALL + CW + 0.1, WALL + CD / 2 - 0.5, 0]);
      expect(k.bounds(k.intersection([s, probe])).max[2]).toBeCloseTo(FLOOR + WALL, 6);
      // A shallow wedge is not clamped.
      const shallow = k.volume(def.build(item({ ...low, wedgeDepth: 10 }), k));
      expect(plain - shallow).toBeCloseTo(endsVolume(3, ETOP, EBOT, 10), 2);
    });

    it('both = long + ends', () => {
      for (const columns of [1, 3]) {
        for (const st of [{}, { stackTop: 'lip' }] as ItemParams[]) {
          const lipH = 'stackTop' in st ? 2 : 0;
          const plain = k.volume(def.build(item({ columns, ...NONE, ...st }), k));
          const it = item({ columns, ...BOTH, ...st });
          const cut = k.volume(expectFootprintMatchesSolid(it));
          const expected = 2 * columns * wedgeVolume(TOP, BOT, 0.6 * CH, lipH) + endsVolume(columns, ETOP, EBOT, 0.6 * CH, lipH);
          expect(plain - cut).toBeCloseTo(expected, 2);
          expect(rects(it, 'notch')).toHaveLength(2 * columns + columns + 1);
        }
      }
    });

    it('validates the top width against the span of the walls it is cut from', () => {
      const msg = (p: ItemParams) => def.validate!(item(p)).join(' ');
      // Card slot 65.5, wall 1.6: the top must stay below 65.5 − 2·1.6 = 62.3.
      expect(msg({ wedgeTopWidth: 62.3 })).toMatch(/Wedge top width \(62\.3 mm\) must be smaller than 62\.3 mm \(the card slot width 65\.5 mm/);
      expect(def.validate!(item({ wedgeTopWidth: 62 }))).toEqual([]);
      // 30 fits the card width but not the stack slot (27.8).
      expect(def.validate!(item({ wedgeTopWidth: 30 }))).toEqual([]);
      expect(msg({ wedgeTopWidth: 30, ...BOTH })).toMatch(/smaller than 27\.8 mm \(the stack slot width 31 mm/);
      expect(msg({ wedgeTopWidth: 62.3, ...BOTH }).match(/must be smaller than/g)).toHaveLength(2);
      // The auto top for the ends is 39.3, for the long walls 18.6: an explicit bottom is checked against the smaller one in use.
      expect(def.validate!(item({ wedgeBottomWidth: 19 }))).toEqual([]);
      expect(msg({ wedgeBottomWidth: 19, ...BOTH })).toMatch(/must not exceed the top width \(18\.6 mm\)/);
      expect(msg({ wedgeBottomWidth: 40 })).toMatch(/must not exceed the top width \(39\.3 mm\)/);
    });
  });
});
