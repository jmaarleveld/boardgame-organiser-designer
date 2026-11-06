import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel, Solid } from '../geometry/types';
import type { ItemParams, PlacedItem, ProjectSettings, ResolvedItem } from '../model/types';
import { DEFAULT_SETTINGS } from '../model/types';
import { effectiveTop, keepOutViolations } from '../model/layout';
import { defaultParams, keepOutOf, newItemParams, type BoxTypeDefinition } from './types';
import { cardTrayTilted, tiltedGeom, tiltedPitch } from './definitions/card-tray-tilted';
import { findBoxType, registerBoxType } from './registry';
import { fakeBox } from '../model/fakeBox.testutil';

let k: GeometryKernel;
beforeAll(async () => {
  k = await createKernel();
});

const WALL = 1.6;
const FLOOR = 1.2;
const def: BoxTypeDefinition = cardTrayTilted;

function item(params: ItemParams = {}, wall = WALL, floor = FLOOR): ResolvedItem {
  return { id: 'x', type: def.id, label: def.name, wall, floor, params: { ...defaultParams(def), ...params } };
}

function build(it: ResolvedItem): Solid {
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

/** Material inside a 0.2 mm cube centred at (x, y, z). */
function material(s: Solid, x: number, y: number, z: number): number {
  const h = 0.1;
  return k.volume(k.intersection([s, k.box(2 * h, 2 * h, 2 * h, [x - h, y - h, z - h])]));
}
const FULL = 0.2 ** 3;

const rad = (d: number) => (d * Math.PI) / 180;

describe('card-tray-tilted', () => {
  it('cell width, pitch and footprint', () => {
    for (const tiltAngle of [5, 15, 30]) {
      for (const columns of [1, 2, 3]) {
        const it = item({ tiltAngle, columns });
        const th = rad(tiltAngle);
        const H = (88 - 20) * Math.cos(th);
        const s = 31 / Math.cos(th);
        const pitch = s + 1.2 / Math.cos(th);
        const g = tiltedGeom(it);
        expect(g.H).toBeCloseTo(H, 9);
        expect(g.s).toBeCloseTo(s, 9);
        expect(g.width).toBeCloseTo(H * Math.tan(th) + s, 9);
        expect(tiltedPitch(it)).toBeCloseTo(pitch, 9);
        expect(pitch).toBeLessThan(g.width);
        const fp = def.footprint(it);
        expect(fp.width).toBeCloseTo(2 * WALL + (columns - 1) * pitch + H * Math.tan(th) + s, 9);
        expect(fp.depth).toBeCloseTo(2 * WALL + 65.5, 9);
        expect(fp.height).toBeCloseTo(FLOOR + H, 9);
      }
    }
    // Rows are not a parameter any more: an old `rows` value is ignored.
    expect(def.params.some((p) => p.key === 'rows')).toBe(false);
    expect(def.footprint(item({ rows: 3 })).depth).toBeCloseTo(2 * WALL + 65.5, 9);
  });

  it('valid manifold, bounds = footprint for columns, angles and stacking variants', () => {
    for (const columns of [1, 2, 3]) {
      for (const tiltAngle of [5, 15, 30]) {
        const it = item({ columns, tiltAngle });
        build(it);
        expect(def.validate!(it)).toEqual([]);
      }
    }
    for (const p of [
      { stackTop: 'lip', stackBottom: 'recess' },
      { stackTop: 'lip', stackBottom: 'plug' },
      { stackBottom: 'plug' },
      { stackTop: 'lip', tiltAngle: 40, columns: 2 },
      { stackTop: 'lip', stackBottom: 'recess', columns: 3, dividerHeight: 30 },
      { stackTop: 'lip', stackBottom: 'plug', columns: 3, dividerHeight: 20, tiltAngle: 30 },
      { columns: 3, dividerHeight: 5, tiltAngle: 5 },
      { frontHeight: 0, columns: 2 },
    ] as ItemParams[]) {
      const it = item(p);
      build(it);
      expect(def.validate!(it)).toEqual([]);
    }
  });

  it('new items get lip and recess', () => {
    expect(newItemParams(def)).toMatchObject({ stackTop: 'lip', stackBottom: 'recess' });
  });

  it('the slot is tilted: material behind it at the bottom, none at the top', () => {
    for (const tiltAngle of [5, 15, 30]) {
      for (const p of [{}, { stackTop: 'lip', stackBottom: 'plug' }] as ItemParams[]) {
        const it = item({ tiltAngle, ...p });
        const s = build(it);
        const g = tiltedGeom(it);
        const plug = p.stackBottom === 'plug' ? 2 : 0;
        const floorZ = plug + FLOOR;
        const y = WALL + g.depth / 2;
        const x = WALL + 0.3;
        expect(material(s, x, y, floorZ + 0.3)).toBeCloseTo(FULL, 9);
        expect(material(s, x, y, floorZ + g.H - 0.15)).toBeLessThan(1e-9);
        // The back face at mid height is at x_back(z) = wall + (H − z)·tan θ.
        const zm = g.H / 2;
        const xb = WALL + (g.H - zm) * g.tan;
        expect(material(s, xb - 0.2, y, floorZ + zm)).toBeCloseTo(FULL, 9);
        expect(material(s, xb + 0.2, y, floorZ + zm)).toBeLessThan(1e-9);
        // The slot floor is tilted: just above the floor at the slot's front‑bottom corner there is material.
        const xf = WALL + g.H * g.tan + g.T * g.cos;
        expect(material(s, xf - 0.5, y, floorZ + 0.15)).toBeCloseTo(FULL, 9);
      }
    }
  });

  it('tilted dividers between the slots: bottom to top, lowered by dividerHeight', () => {
    for (const tiltAngle of [5, 15, 30]) {
      for (const dividerHeight of [0, 30]) {
        const it = item({ tiltAngle, columns: 3, dividerHeight, stackTop: 'lip' });
        const s = build(it);
        const g = tiltedGeom(it);
        const pitch = tiltedPitch(it);
        const W = def.footprint(it).width;
        const y = WALL + g.depth / 2;
        // Divider i (between slot i and i + 1) at height z: x_back_i(z) + s … + pitch.
        const mid = (i: number, z: number) => WALL + i * pitch + (g.H - z) * g.tan + g.s + (pitch - g.s) / 2;
        for (const i of [0, 1]) {
          for (const z of [3, 15, 29]) expect(material(s, mid(i, z), y, FLOOR + z)).toBeCloseTo(FULL, 9);
          // Just inside the slots on both sides: empty.
          expect(material(s, mid(i, 25) - (pitch - g.s) / 2 - 0.3, y, FLOOR + 25)).toBeLessThan(1e-9);
          expect(material(s, mid(i, 25) + (pitch - g.s) / 2 + 0.3, y, FLOOR + 25)).toBeLessThan(1e-9);
          for (const z of [31, g.H - 0.3]) {
            const m = material(s, mid(i, z), y, FLOOR + z);
            if (dividerHeight) expect(m).toBeLessThan(1e-9);
            else expect(m).toBeCloseTo(FULL, 9);
          }
          // The side walls and their lip keep their full height next to the divider.
          expect(material(s, mid(i, g.H - 0.3), WALL / 4, FLOOR + g.H + 1.5)).toBeCloseTo(FULL, 9);
          expect(material(s, mid(i, g.H - 0.3), WALL - 0.2, FLOOR + g.H - 0.15)).toBeCloseTo(FULL, 9);
        }
        // Front opening only at the outer front wall: open above frontHeight, closed below.
        expect(material(s, W - WALL / 2, y, FLOOR + 22)).toBeLessThan(1e-9);
        expect(material(s, W - WALL / 2, y, FLOOR + 18)).toBeCloseTo(FULL, 9);
        const z = 30;
        const xf = WALL + 2 * pitch + g.H * g.tan + g.s - z * g.tan;
        expect(material(s, xf + 0.5, y, FLOOR + z)).toBeLessThan(1e-9);
        // In front of the interior slots the dividers stand (full height): no front opening there.
        if (!dividerHeight) expect(material(s, mid(0, 45) , y, FLOOR + 45)).toBeCloseTo(FULL, 9);
        // The outer side wall at the front stays full height.
        expect(material(s, W - WALL / 2, WALL / 2, FLOOR + g.H - 0.5)).toBeCloseTo(FULL, 9);
      }
    }
  });

  it('draw: slot openings, tilted dividers, shelf and front notch inside the footprint', () => {
    const it = item({ columns: 3 });
    const g = tiltedGeom(it);
    const pitch = tiltedPitch(it);
    const fp = def.footprint(it);
    const feats = def.draw(it);
    const roles = (r: string) => feats.filter((f) => f.kind === 'rect' && f.role === r);
    expect(roles('cavity')).toHaveLength(3);
    expect(roles('solid')).toHaveLength(1);
    expect(roles('notch')).toHaveLength(1);
    const dividers = roles('divider');
    expect(dividers).toHaveLength(2);
    dividers.forEach((d, i) => {
      if (d.kind !== 'rect') return;
      expect(d.x).toBeCloseTo(WALL + i * pitch + g.s, 9);
      expect(d.w).toBeCloseTo(1.2 / g.cos, 9);
      expect(d.y).toBeCloseTo(WALL, 9);
      expect(d.h).toBeCloseTo(g.depth, 9);
    });
    const cav = roles('cavity');
    for (const i of [0, 1]) {
      const c = cav[i];
      if (c.kind !== 'rect') continue;
      expect(c.x).toBeCloseTo(WALL + i * pitch, 9);
      expect(c.w).toBeCloseTo(g.s, 9);
    }
    // The notch is in the front outer wall.
    const n = roles('notch')[0];
    if (n.kind === 'rect') expect(n.x + n.w).toBeCloseTo(fp.width, 9);
    for (const f of feats) {
      if (f.kind !== 'rect') continue;
      expect(f.x).toBeGreaterThanOrEqual(-1e-9);
      expect(f.y).toBeGreaterThanOrEqual(-1e-9);
      expect(f.x + f.w).toBeLessThanOrEqual(fp.width + 1e-9);
      expect(f.y + f.h).toBeLessThanOrEqual(fp.depth + 1e-9);
    }
  });

  it('bearing areas: the front opening carries nothing, the shelf is low', () => {
    const it = item({ stackTop: 'lip', stackBottom: 'recess', columns: 2 });
    const g = tiltedGeom(it);
    const fp = def.footprint(it);
    const areas = def.bearingAreas!(it);
    const y = WALL + g.depth / 2;
    const at = (x: number) => areas.filter((a) => x > a.x && x < a.x + a.width && y > a.y && y < a.y + a.depth);
    const front = at(fp.width - 0.2);
    expect(front).toHaveLength(1);
    expect(front[0]).toMatchObject({ role: 'low', height: FLOOR + 20 });
    // At 15° the slot clears the back lip (2·tan 15° = 0.54 < wall / 2 = 0.8): still a lip.
    expect(at(0.2)).toEqual([expect.objectContaining({ role: 'lip' })]);
    // At 40° the slot notches the back lip: it becomes low.
    const steep = item({ stackTop: 'lip', tiltAngle: 40 });
    const sa = def.bearingAreas!(steep);
    const back = sa.filter((a) => 0.2 > a.x && 0.2 < a.x + a.width && y > a.y && y < a.y + a.depth);
    expect(back).toEqual([expect.objectContaining({ role: 'low' })]);
    // And the solid really is notched there.
    const s = build(steep);
    const fz = def.footprint(steep).height;
    expect(material(s, WALL / 2 - 0.15, y, fz - 0.15)).toBeLessThan(1e-9);
  });

  it('bearing areas: tilted divider tops, bearing at full height, low when lowered', () => {
    for (const dividerHeight of [0, 30]) {
      const it = item({ stackTop: 'lip', stackBottom: 'recess', columns: 3, dividerHeight });
      const g = tiltedGeom(it);
      const pitch = tiltedPitch(it);
      const areas = def.bearingAreas!(it).filter((a) => a.name === 'divider');
      expect(areas).toHaveLength(2);
      const z = dividerHeight || g.H;
      areas.forEach((a, i) => {
        expect(a.role).toBe(dividerHeight ? 'low' : 'bearing');
        expect(a.height).toBeCloseTo(FLOOR + z, 9);
        expect(a.x).toBeCloseTo(WALL + i * pitch + (g.H - z) * g.tan + g.s, 9);
        expect(a.width).toBeCloseTo(1.2 / g.cos, 9);
      });
      // Only one front shelf (last cell).
      expect(def.bearingAreas!(it).filter((a) => a.name === 'front wall')).toHaveLength(1);
    }
  });

  it('keepOut: leaning cards above the top, may stick out behind', () => {
    for (const tiltAngle of [5, 15, 30]) {
      const it = item({ tiltAngle, columns: 3, stackTop: 'lip' });
      const g = tiltedGeom(it);
      const pitch = tiltedPitch(it);
      const ko = keepOutOf(def, it);
      expect(ko).toHaveLength(3);
      const th = rad(tiltAngle);
      for (const [i, r] of ko.entries()) {
        expect(r.x).toBeCloseTo(WALL + i * pitch - 20 * Math.sin(th), 9);
        expect(r.y).toBeCloseTo(WALL, 9);
        expect(r.width).toBeCloseTo(g.s + 20 * Math.sin(th), 9);
        expect(r.depth).toBeCloseTo(g.depth, 9);
        expect(r.height).toBeCloseTo(20 * Math.cos(th) + 30 * Math.sin(th) - 2, 9);
      }
    }
    expect(keepOutOf(def, item({ tiltAngle: 30 }))[0].x).toBeLessThan(0);
    expect(keepOutOf(def, item({ exposedHeight: 0, tiltAngle: 5, stackHeight: 1, stackTop: 'lip' }))).toEqual([]);
  });

  it('keepOut sticking out behind the footprint is seen by the layout', () => {
    if (!findBoxType(def.id)) registerBoxType(def);
    if (!findBoxType(fakeBox.id)) registerBoxType(fakeBox);
    const settings: ProjectSettings = { ...structuredClone(DEFAULT_SETTINGS), box: { width: 300, depth: 300, height: 200 } };
    const tray: PlacedItem = { id: 't', type: def.id, label: 'T', x: 50, y: 50, rotation: 0, params: { tiltAngle: 30 } };
    const top = effectiveTop(tray, settings, [tray]);
    expect(top).toBeGreaterThan(def.footprint(item({ tiltAngle: 30 }, settings.defaults.wall, settings.defaults.floor)).height);
    // A tall block right behind the tray (x < 50) is hit only by the overhanging cards.
    const ko = keepOutOf(def, item({ tiltAngle: 30 }, settings.defaults.wall, settings.defaults.floor))[0];
    expect(ko.x).toBeLessThan(0);
    const behind: PlacedItem = { id: 'b', type: 'fake', label: 'B', x: 50 + ko.x - 10, y: 60, rotation: 0, params: { w: 10 - ko.x / 2, d: 20, h: 150 } };
    expect(keepOutViolations([tray, behind], settings)).toEqual([expect.objectContaining({ keeperId: 't', intruderId: 'b' })]);
    const clear: PlacedItem = { ...behind, params: { ...behind.params, w: 9.5 } };
    expect(keepOutViolations([tray, clear], settings)).toEqual([]);
  });

  it('validation messages', () => {
    const v = (p: ItemParams) => def.validate!(item(p));
    expect(v({})).toEqual([]);
    expect(v({ tiltAngle: 4 })).toEqual(['Tilt angle must be between 5° and 40° (is 4°).']);
    expect(v({ tiltAngle: 41 })).toEqual(['Tilt angle must be between 5° and 40° (is 41°).']);
    expect(v({ exposedHeight: -1 })).toContain('Exposed height must not be negative (is -1).');
    expect(v({ exposedHeight: 88 })).toContain('Exposed height (88 mm) must be smaller than the card height (88 mm).');
    expect(v({ frontHeight: -1 })).toEqual(['Front wall height must not be negative (is -1).']);
    const H = tiltedGeom(item()).H;
    expect(v({ frontHeight: 70 })).toEqual([`Front wall height (70 mm) must be lower than the inner height (${Math.round(H * 100) / 100} mm).`]);
    expect(v({ cardWidth: 0 })).toContain('Card width must be greater than 0 (is 0).');
    expect(v({ columns: 1.5 })).toContain('Columns must be a whole number ≥ 1 (is 1.5).');
    expect(v({ columns: 2, dividerThickness: 0 })).toEqual(['Divider thickness must be greater than 0 (is 0).']);
    expect(v({ columns: 1, dividerThickness: 0 })).toEqual([]);
    expect(v({ columns: 3, dividerHeight: -1 })).toEqual(['Divider height must not be negative (is -1).']);
    expect(v({ columns: 3, dividerHeight: 70 })).toEqual([`Divider height (70 mm) must not exceed the inner height (${Math.round(H * 100) / 100} mm).`]);
    expect(v({ columns: 3, dividerHeight: H })).toEqual([]);
  });
});
