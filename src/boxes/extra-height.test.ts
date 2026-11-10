import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import { createScadKernel } from '../geometry/scadKernel';
import type { GeometryKernel } from '../geometry/types';
import type { ItemParams, ResolvedItem } from '../model/types';
import { openBox } from './definitions/common';
import { STRETCH_BELOW_TOP } from './definitions/tiling';
import { cardTrayFlat, cardTrayTilted, cardTrayUpright, itemTray } from './index';
import { keepOutOf, newItemParams, type BoxTypeDefinition } from './types';

let k: GeometryKernel;
beforeAll(async () => {
  k = await createKernel();
});

function item(def: BoxTypeDefinition, params: ItemParams = {}, floor = 1.2): ResolvedItem {
  return { id: 'x', type: def.id, label: def.name, wall: 1.6, floor, params: { ...newItemParams(def), ...params } };
}

describe('kernel.stretchZ', () => {
  it('moves everything above the plane up and fills the band with the cross section', () => {
    // 20 × 10 × 10 open box, wall 1, floor 1: the cross section at z = 5 is the wall ring.
    const s = openBox(k, 18, 8, 9, 1, 1);
    const out = k.stretchZ(s, 5, 7);
    expect(k.isValid(out)).toBe(true);
    const b = k.bounds(out);
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max[2]).toBeCloseTo(17, 6);
    const ring = 20 * 10 - 18 * 8;
    expect(k.volume(out)).toBeCloseTo(k.volume(s) + ring * 7, 4);
  });

  it('rejects a non-positive stretch', () => {
    const s = k.box(1, 1, 1);
    expect(() => k.stretchZ(s, 0.5, 0)).toThrow(/by must be a finite number > 0/);
  });

  it('OpenSCAD: below, the extruded cut and the moved top in one union', () => {
    const sk = createScadKernel();
    const src = sk.toScad(sk.stretchZ(sk.box(1, 2, 3), 1.5, 4));
    expect(src).toContain('linear_extrude(height=4) projection(cut=true) translate([0, 0, -1.5]) cube([1, 2, 3]);');
    expect(src).toContain('translate([0, 0, 4]) intersection()');
  });
});

describe.each([
  ['card-tray-flat', cardTrayFlat],
  ['card-tray-upright', cardTrayUpright],
  ['card-tray-tilted', cardTrayTilted],
] as const)('%s with extra wall height', (_id, def) => {
  const extra = 12;

  it('is that much taller, with a valid solid matching the footprint', () => {
    const base = item(def);
    const tall = item(def, { extraHeight: extra });
    const fp0 = def.footprint(base);
    const fp = def.footprint(tall);
    expect(fp.width).toBeCloseTo(fp0.width, 9);
    expect(fp.depth).toBeCloseTo(fp0.depth, 9);
    expect(fp.height).toBeCloseTo(fp0.height + extra, 9);
    const s = def.build(tall, k);
    expect(k.isValid(s)).toBe(true);
    const b = k.bounds(s);
    expect(b.max[0]).toBeCloseTo(fp.width, 6);
    expect(b.max[1]).toBeCloseTo(fp.depth, 6);
    expect(b.max[2]).toBeCloseTo(fp.height, 6);
    // The added band is solid wall material only: more volume, but less than a full slab.
    const v0 = k.volume(def.build(base, k));
    const v = k.volume(s);
    expect(v).toBeGreaterThan(v0);
    expect(v - v0).toBeLessThan(fp.width * fp.depth * extra * 0.6);
    expect(def.validate?.(tall)).toEqual([]);
  });

  it('raises the top bearing faces, leaves the low ones, and shrinks the keep-out', () => {
    const base = item(def);
    const tall = item(def, { extraHeight: extra });
    const top0 = Math.max(...def.bearingAreas!(base).map((a) => a.height));
    const top = Math.max(...def.bearingAreas!(tall).map((a) => a.height));
    expect(top).toBeCloseTo(top0 + extra, 9);
    // Faces well under the wall top (the lip is 2 mm), e.g. the tilted tray's front opening, stay put.
    const low = (it: ResolvedItem) => def.bearingAreas!(it).filter((a) => a.height < top0 - 3).map((a) => a.height);
    expect(low(tall)).toEqual(low(base));
    const ko = (it: ResolvedItem) => Math.max(0, ...keepOutOf(def, it).map((x) => x.height));
    if (ko(base) > 0) expect(ko(tall)).toBeCloseTo(Math.max(0, ko(base) - extra), 9);
  });

  it('reports a negative extra wall height', () => {
    expect(def.validate?.(item(def, { extraHeight: -1 }))).toContain('Extra wall height must not be negative (is -1).');
  });
});

describe('raise hooks', () => {
  it('item tray: deeper cells in both modes', () => {
    const it0 = item(itemTray, { innerHeight: 20 });
    expect(itemTray.raise!(it0, 5.5, { mode: 'type', headroom: 5.5 })).toEqual({ params: { innerHeight: 25.5 } });
    expect(itemTray.raise!(it0, 5.5, { mode: 'walls', headroom: 5.5 })).toEqual({ params: { innerHeight: 25.5 } });
  });

  it('upright tray: per type raises the floor as far as the cards allow, the rest is wall', () => {
    const it0 = item(cardTrayUpright, { extraHeight: 1 }, 1.2);
    expect(cardTrayUpright.raise!(it0, 10, { mode: 'type', headroom: 4 })).toEqual({ floor: 5.2, params: { extraHeight: 7 } });
    expect(cardTrayUpright.raise!(it0, 10, { mode: 'type', headroom: 10 })).toEqual({ floor: 11.2 });
    expect(cardTrayUpright.raise!(it0, 10, { mode: 'walls', headroom: 10 })).toEqual({ params: { extraHeight: 11 } });
  });

  it('the stretch plane stays under the wall top and above a lowered divider', () => {
    // Divider 0.1 mm under the wall top: the plane must lie between them, so the divider is not raised.
    const tall = item(cardTrayUpright, { columns: 2, extraHeight: 5 });
    const cellH = 88 - 20;
    const lowered = item(cardTrayUpright, { columns: 2, dividerHeight: cellH - 0.1, extraHeight: 5 });
    const top = (it: ResolvedItem, name: string) => Math.max(...cardTrayUpright.bearingAreas!(it).filter((a) => a.name === name).map((a) => a.height));
    expect(top(lowered, 'divider')).toBeCloseTo(top(tall, 'wall') - 5 - 0.1, 9);
    expect(top(tall, 'divider')).toBeCloseTo(top(tall, 'wall'), 9);
    expect(STRETCH_BELOW_TOP).toBeGreaterThan(0.1);
    expect(k.isValid(cardTrayUpright.build(lowered, k))).toBe(true);
  });
});
