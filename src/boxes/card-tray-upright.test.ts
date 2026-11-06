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

/** Volume of one wedge through a wall of thickness `wall` (plus the lip ring, outer half of the wall). */
const wedgeVolume = (top: number, bottom: number, depth: number, lipH = 0) =>
  ((top + bottom) / 2) * depth * WALL + top * lipH * (WALL / 2);

describe('card-tray-upright', () => {
  it('footprint, cavities and wedges for 1, 2, 3 columns', () => {
    for (const columns of [1, 2, 3]) {
      for (const wedgeTopWidth of [30, 0]) {
        const it = item({ columns, wedgeTopWidth });
        const fp = def.footprint(it);
        expect(fp.width).toBeCloseTo(2 * WALL + (columns - 1) * (CW + 1.2) + CW, 9);
        expect(fp.depth).toBeCloseTo(2 * WALL + CD, 9);
        expect(fp.height).toBeCloseTo(FLOOR + CH, 9);
        expectFootprintMatchesSolid(it);
        expect(rects(it, 'cavity')).toHaveLength(columns);
        expect(rects(it, 'divider')).toHaveLength(columns - 1);
        expect(rects(it, 'notch')).toHaveLength(wedgeTopWidth > 0 ? 2 * columns : 0);
        expect(def.validate!(it)).toEqual([]);
      }
    }
  });

  it('wedge notch rects span the top width × wall thickness, centred on the cell', () => {
    const notches = rects(item({ columns: 2 }), 'notch');
    expect(notches).toHaveLength(4);
    for (const n of notches) {
      if (n.kind !== 'rect') continue;
      expect(n.w).toBeCloseTo(30, 9);
      expect(n.h).toBeCloseTo(WALL, 9);
      expect([0, WALL + CD]).toContainEqual(expect.closeTo(n.y, 9));
      const cx = n.x + n.w / 2;
      expect([WALL + CW / 2, WALL + CW + 1.2 + CW / 2]).toContainEqual(expect.closeTo(cx, 9));
    }
  });

  it('stacking variants build and validate, with and without wedges', () => {
    for (const st of stackVariants) {
      for (const columns of [1, 3]) {
        for (const wedgeTopWidth of [30, 0]) {
          const it = item({ columns, wedgeTopWidth, ...st });
          expectFootprintMatchesSolid(it);
          expect(def.validate!(it)).toEqual([]);
        }
      }
    }
    expect(newItemParams(def)).toMatchObject({ stackTop: 'lip', stackBottom: 'recess' });
    expect(engagementOf(def, item({ stackBottom: 'recess' }))).toBe(2);
  });

  it('wedges remove the trapezoid (auto depth = 60 % of the inner height)', () => {
    for (const columns of [1, 2]) {
      const plain = k.volume(def.build(item({ columns, wedgeTopWidth: 0 }), k));
      const cut = k.volume(def.build(item({ columns }), k));
      expect(plain - cut).toBeCloseTo(2 * columns * wedgeVolume(30, 12, 0.6 * CH), 2);
    }
  });

  it('explicit depth, pointed bottom and the lip part', () => {
    const plain = k.volume(def.build(item({ wedgeTopWidth: 0 }), k));
    const deep = k.volume(def.build(item({ wedgeDepth: 25 }), k));
    expect(plain - deep).toBeCloseTo(2 * wedgeVolume(30, 12, 25), 2);
    const pointed = expectFootprintMatchesSolid(item({ wedgeBottomWidth: 0, wedgeDepth: 25 }));
    expect(plain - k.volume(pointed)).toBeCloseTo(2 * wedgeVolume(30, 0, 25), 2);
    const lipPlain = k.volume(def.build(item({ wedgeTopWidth: 0, stackTop: 'lip' }), k));
    const lipCut = k.volume(expectFootprintMatchesSolid(item({ stackTop: 'lip' })));
    expect(lipPlain - lipCut).toBeCloseTo(2 * wedgeVolume(30, 12, 0.6 * CH, 2), 2);
  });

  it('the wedge cuts the wall from the top down to its depth', () => {
    const s = def.build(item({ wedgeDepth: 25 }), k);
    const cx = WALL + CW / 2;
    // A thin probe in the front wall at the cell centre: material only below the wedge bottom.
    const probe = k.box(1, WALL - 0.2, FLOOR + CH, [cx - 0.5, 0.1, 0]);
    const b = k.bounds(k.intersection([s, probe]));
    expect(b.max[2]).toBeCloseTo(FLOOR + CH - 25, 6);
  });

  it('lowered dividers', () => {
    const full = k.volume(def.build(item({ columns: 3 }), k));
    const low = expectFootprintMatchesSolid(item({ columns: 3, dividerHeight: 30 }));
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
    expect(msg({ wedgeBottomWidth: 31 })).toMatch(/Wedge bottom width \(31 mm\) must not exceed the top width \(30 mm\)/);
    expect(msg({ wedgeTopWidth: 31 })).toMatch(/Wedge top width \(31 mm\) must be smaller than the cell width it is cut from \(31 mm\)/);
    expect(msg({ wedgeDepth: 70 })).toMatch(/Wedge depth \(70 mm\) must not exceed the inner height \(68 mm\)/);
    expect(msg({ wedgeDepth: -1 })).toMatch(/Wedge depth must not be negative/);
    expect(msg({ cardWidth: 0 })).toMatch(/Card width/);
    expect(msg({ clearance: -1 })).toMatch(/Clearance/);
    expect(msg({ columns: 0 })).toMatch(/Columns/);
    expect(msg({ columns: 2, dividerThickness: 0 })).toMatch(/Divider thickness/);
    expect(msg({ columns: 2, dividerHeight: 80 })).toMatch(/Divider height/);
    // No wedges: the wedge checks are skipped.
    expect(def.validate!(item({ wedgeTopWidth: 0, wedgeBottomWidth: 50 }))).toEqual([]);
    expect(def.validate!(item({ wedgeDepth: 68 }))).toEqual([]);
  });
});
