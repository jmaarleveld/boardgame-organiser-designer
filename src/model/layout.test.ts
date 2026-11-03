import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import type { PlacedItem, ProjectSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import {
  findOverlaps,
  itemRect,
  itemsOutsideUsable,
  itemsTooTall,
  layoutSummary,
  rectCovered,
  restingElevation,
  safeItemRect,
  unsupportedItems,
  snapPosition,
  usableArea,
} from './layout';
import { fakeBox } from './fakeBox.testutil';
import { tray } from '../boxes/definitions/tray';
import { platform } from '../boxes/definitions/platform';
import { spacer } from '../boxes/definitions/spacer';
import type { ItemParams } from './types';

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 200, depth: 100, height: 50 },
  tolerance: { x: 2, y: 4 },
  gridSnap: 5,
};

function item(id: string, x: number, y: number, p: Partial<{ w: number; d: number; h: number; e: number }> = {}, rotation: 0 | 90 = 0): PlacedItem {
  return { id, type: 'fake', label: id.toUpperCase(), x, y, rotation, params: { ...p } };
}

function at(z: number, i: PlacedItem): PlacedItem {
  return { ...i, z };
}

beforeEach(() => {
  clearRegistry();
  registerBoxType(fakeBox);
});

describe('usableArea', () => {
  it('shrinks the box by the tolerance, centred', () => {
    expect(usableArea(settings)).toEqual({ x: 1, y: 2, width: 198, depth: 96 });
  });
});

describe('itemRect', () => {
  it('uses the rotated footprint', () => {
    expect(itemRect(item('a', 3, 4), settings)).toEqual({ x: 3, y: 4, width: 40, depth: 20, height: 10, z: 0, top: 10 });
    expect(itemRect(item('a', 3, 4, {}, 90), settings)).toMatchObject({ width: 20, depth: 40 });
  });
  it('safeItemRect falls back for unknown types', () => {
    const r = safeItemRect({ ...item('a', 0, 0), type: 'nope' }, settings);
    expect(r.broken).toBe(true);
    expect(r.width).toBeGreaterThan(0);
  });
});

describe('findOverlaps', () => {
  it('reports strict overlaps only', () => {
    const items = [item('a', 1, 2), item('b', 41, 2), item('c', 30, 10)];
    // a and b touch (allowed); c overlaps both.
    expect(findOverlaps(items, settings)).toEqual([
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });
  it('tolerates floating point touching', () => {
    const items = [item('a', 0.1 + 0.2, 2), item('b', 40.3, 2)];
    expect(findOverlaps(items, settings)).toEqual([]);
  });
});

describe('outside / too tall', () => {
  it('flags items outside the usable area', () => {
    const items = [item('in', 1, 2), item('left', 0.5, 2), item('right', 160, 2), item('ok', 159, 78)];
    expect(itemsOutsideUsable(items, settings)).toEqual(['left', 'right']);
  });
  it('flags items taller than the box', () => {
    expect(itemsTooTall([item('a', 1, 2, { h: 50 }), item('b', 50, 2, { h: 51 })], settings)).toEqual(['b']);
  });
});

describe('snapPosition', () => {
  const usable = usableArea(settings);
  const moving = { width: 40, depth: 20 };

  it('snaps to usable-area edges', () => {
    const r = snapPosition(moving, { x: 2.5, y: 3.2 }, [], usable, 0);
    expect(r.x).toBe(1);
    expect(r.y).toBe(2);
    expect(r.snapX).toBe('usable');
    expect(r.guides.some((g) => g.axis === 'x' && g.pos === 1)).toBe(true);
    expect(r.guides.some((g) => g.axis === 'y' && g.pos === 2)).toBe(true);
  });

  it('snaps the trailing edge to the far usable edge', () => {
    const r = snapPosition(moving, { x: 157.5, y: 50 }, [], usable, 0);
    expect(r.x).toBe(199 - 40);
  });

  it('snaps left edge to a neighbour right edge and aligns tops', () => {
    const other = { x: 1, y: 2, width: 30, depth: 20 };
    const r = snapPosition(moving, { x: 32.4, y: 3.9 }, [other], usable, 0);
    expect(r.x).toBe(31);
    expect(r.y).toBe(2);
    expect(r.snapX).toBe('item');
  });

  it('snaps top edge to a neighbour bottom edge', () => {
    const other = { x: 50, y: 30, width: 30, depth: 20 };
    const r = snapPosition(moving, { x: 70, y: 51.5 }, [other], usable, 0);
    expect(r.y).toBe(50);
    expect(r.guides.find((g) => g.axis === 'y')?.pos).toBe(50);
  });

  it('falls back to the grid (relative to the usable origin) beyond the threshold', () => {
    const r = snapPosition(moving, { x: 52.2, y: 33.9 }, [], usable, 5, 3);
    expect(r.x).toBe(51);
    expect(r.y).toBe(32);
    expect(r.snapX).toBe('grid');
    expect(r.guides).toEqual([]);
  });

  it('is not sticky: just beyond the threshold no edge snap happens', () => {
    const r = snapPosition(moving, { x: 1 + 3.01, y: 40 }, [], usable, 0, 3);
    expect(r.x).toBeCloseTo(4.01);
    expect(r.snapX).toBeNull();
  });

  it('prefers the closest candidate', () => {
    const others = [{ x: 60, y: 50, width: 10, depth: 10 }];
    // left edge 2 from 60 (x=58 → 60) vs right edge: 58+40=98, no line near.
    const r = snapPosition(moving, { x: 59, y: 70 }, others, usable, 0);
    expect(r.x).toBe(60);
  });
});

describe('layoutSummary', () => {
  it('computes slack from the bounding box', () => {
    const items = [item('a', 1, 2), item('b', 41, 2, { w: 50, d: 30 })];
    const s = layoutSummary(items, settings);
    expect(s.itemCount).toBe(2);
    expect(s.bounds).toEqual({ x: 1, y: 2, width: 90, depth: 30 });
    expect(s.slackX).toBe(198 - 90);
    expect(s.slackY).toBe(96 - 30);
    expect(s.issues).toEqual([]);
  });

  it('reports full usable size when empty', () => {
    const s = layoutSummary([], settings);
    expect(s.slackX).toBe(198);
    expect(s.slackY).toBe(96);
  });

  it('collects issues with severities', () => {
    const items = [item('a', 1, 2), item('b', 20, 2, { h: 60 }), item('c', 0, 50, { w: 2 }), { ...item('d', 100, 50), type: 'nope' }];
    const s = layoutSummary(items, settings);
    const by = (sev: string) => s.issues.filter((i) => i.severity === sev);
    expect(by('error').some((i) => i.itemIds.join() === 'a,b')).toBe(true);
    expect(by('error').some((i) => i.itemIds[0] === 'b' && /too tall/.test(i.message))).toBe(true);
    expect(by('error').some((i) => i.itemIds[0] === 'c' && /outside/.test(i.message))).toBe(true);
    expect(by('error').some((i) => i.itemIds[0] === 'd' && /unknown/.test(i.message))).toBe(true);
    expect(by('warning').map((i) => i.itemIds[0])).toEqual(['c']);
    expect(s.errorCount).toBe(by('error').length);
  });

  it('reports negative slack when items exceed the usable area', () => {
    const s = layoutSummary([item('a', 1, 2, { w: 250 })], settings);
    expect(s.slackX).toBe(198 - 250);
  });
});

describe('stacking', () => {
  it('itemRect reports z and top', () => {
    expect(itemRect(at(5, item('a', 3, 4)), settings)).toMatchObject({ z: 5, top: 15, height: 10 });
  });

  it('3D overlaps: XY overlap only collides when Z ranges intersect', () => {
    const base = item('base', 1, 2); // 40×20×10 at z 0
    expect(findOverlaps([base, at(10, item('on', 1, 2))], settings)).toEqual([]);
    expect(findOverlaps([base, at(12, item('above', 1, 2))], settings)).toEqual([]);
    expect(findOverlaps([base, at(9, item('sunk', 1, 2))], settings)).toEqual([['base', 'sunk']]);
    expect(findOverlaps([base, item('same', 10, 2)], settings)).toEqual([['base', 'same']]);
    // Engagement: an upper item at z 8 sinking 2 mm into the lower one is fine…
    expect(findOverlaps([base, at(8, item('lip', 1, 2, { e: 2 }))], settings)).toEqual([]);
    // …but at z 7 its effective bottom (9) is inside the lower body.
    expect(findOverlaps([base, at(7, item('deep', 1, 2, { e: 2 }))], settings)).toEqual([['base', 'deep']]);
    // An item whose engagement region lies inside the lower one is only checked above z + e.
    expect(findOverlaps([at(8, item('lip', 1, 2, { e: 2 })), base], settings)).toEqual([]);
  });

  it('layoutSummary reports an intersection error for a base inside another body', () => {
    const s = layoutSummary([item('base', 1, 2), at(4, item('mid', 1, 2))], settings);
    expect(s.errorCount).toBe(1);
    expect(s.issues[0].message).toMatch(/MID intersects BASE/);
    expect(s.issues[0].itemIds).toEqual(['mid', 'base']);
  });

  it('itemsTooTall uses the top', () => {
    expect(itemsTooTall([at(40, item('a', 1, 2, { h: 10 })), at(41, item('b', 50, 2, { h: 10 }))], settings)).toEqual(['b']);
  });

  it('rectCovered is exact (coordinate compression)', () => {
    const t = { x: 0, y: 0, width: 10, depth: 10 };
    expect(rectCovered(t, [{ x: 0, y: 0, width: 5, depth: 10 }, { x: 5, y: 0, width: 5, depth: 10 }])).toBe(true);
    expect(rectCovered(t, [{ x: 0, y: 0, width: 5, depth: 10 }, { x: 5.5, y: 0, width: 5, depth: 10 }])).toBe(false);
    expect(rectCovered(t, [{ x: -5, y: -5, width: 20, depth: 20 }])).toBe(true);
    // L-shaped union with a missing corner.
    expect(
      rectCovered(t, [
        { x: 0, y: 0, width: 10, depth: 5 },
        { x: 0, y: 5, width: 5, depth: 5 },
      ]),
    ).toBe(false);
    expect(rectCovered(t, [])).toBe(false);
  });

  it('unsupportedItems: two supporters cover one item; gaps, wrong heights and partial cover float', () => {
    const a = item('a', 1, 2); // x 1..41
    const b = item('b', 41, 2); // x 41..81
    const plate = at(10, item('plate', 1, 2, { w: 80, d: 20, h: 2 }));
    expect(unsupportedItems([a, b, plate], settings)).toEqual([]);
    // b shorter → only half covered at z = 10.
    const bLow = item('b', 41, 2, { h: 9 });
    expect(unsupportedItems([a, bLow, plate], settings)).toEqual(['plate']);
    // gap between supporters
    const bGap = item('b', 42, 2);
    expect(unsupportedItems([a, bGap, plate], settings)).toEqual(['plate']);
    // nothing underneath at all
    expect(unsupportedItems([at(5, item('x', 100, 50))], settings)).toEqual(['x']);
    // engagement: resting at z 8 with e 2 on a 10 high item is supported
    expect(unsupportedItems([a, at(8, item('lip', 1, 2, { e: 2 }))], settings)).toEqual([]);
    // tolerance 0.01 mm
    expect(unsupportedItems([a, at(10.005, item('t', 1, 2))], settings)).toEqual([]);
    expect(unsupportedItems([a, at(10.05, item('t', 1, 2))], settings)).toEqual(['t']);
  });

  it('layoutSummary warns about floating items', () => {
    const s = layoutSummary([at(5, item('x', 100, 50))], settings);
    expect(s.errorCount).toBe(0);
    expect(s.warningCount).toBe(1);
    expect(s.issues[0]).toMatchObject({ severity: 'warning', kind: 'floating', itemIds: ['x'] });
    expect(s.issues[0].message).toMatch(/^Floating: nothing underneath X/);
  });

  it('restingElevation = max top of XY-overlapping others − engagement', () => {
    const items = [item('a', 1, 2), item('b', 41, 2, { h: 25 }), item('far', 120, 50, { h: 40 }), at(3, item('m', 20, 2, { e: 2 }))];
    expect(restingElevation('m', items, settings)).toBe(23);
    // Rests on whatever it overlaps, regardless of which one is currently higher (m.top = 3 + 10).
    expect(restingElevation('a', items, settings)).toBe(13);
    expect(restingElevation('far', items, settings)).toBe(0);
    expect(restingElevation('nope', items, settings)).toBe(0);
  });
});

describe('recess engagement depends on what is below', () => {
  // Default tray: 63.2 × 43.2 outer, 31.2 high (+2 with a lip); platform 100×100, 4 high (2 mm stops).
  const real = (id: string, type: string, x: number, y: number, params: ItemParams = {}, z?: number): PlacedItem => ({
    id,
    type,
    label: id.toUpperCase(),
    x,
    y,
    rotation: 0,
    params,
    ...(z !== undefined ? { z } : {}),
  });
  const s2: ProjectSettings = { ...settings, box: { width: 300, depth: 150, height: 100 } };
  const recess = { stackBottom: 'recess' };

  beforeEach(() => {
    for (const d of [tray, platform, spacer]) registerBoxType(d);
  });

  it('a recessed tray on a platform rests on the platform top (not lipHeight lower)', () => {
    const items = [real('p', 'platform', 1, 1), real('t', 'tray', 10, 10, recess)];
    expect(restingElevation('t', items, s2)).toBe(4);
    const placed = [items[0], { ...items[1], z: 4 }];
    expect(unsupportedItems(placed, s2)).toEqual([]);
    expect(findOverlaps(placed, s2)).toEqual([]);
    // 2 mm lower is an intersection, not a valid seat.
    const sunk = [items[0], { ...items[1], z: 2 }];
    expect(unsupportedItems(sunk, s2)).toEqual(['t']);
    expect(layoutSummary(sunk, s2).issues.some((i) => /T intersects P/.test(i.message))).toBe(true);
  });

  it('a recessed tray on a lipped tray still engages lipHeight', () => {
    const items = [real('lo', 'tray', 1, 1, { stackTop: 'lip' }), real('hi', 'tray', 1, 1, recess, 50)];
    expect(restingElevation('hi', items, s2)).toBeCloseTo(31.2, 9);
    const placed = [items[0], { ...items[1], z: 31.2 }];
    expect(unsupportedItems(placed, s2)).toEqual([]);
    expect(findOverlaps(placed, s2)).toEqual([]);
  });

  it('a recessed tray on a plain tray or a spacer rests on top', () => {
    const onTray = [real('lo', 'tray', 1, 1), real('hi', 'tray', 1, 1, recess, 50)];
    expect(restingElevation('hi', onTray, s2)).toBeCloseTo(31.2, 9);
    const sunk = [onTray[0], { ...onTray[1], z: 29.2 }];
    expect(unsupportedItems(sunk, s2)).toEqual(['hi']);
    expect(findOverlaps(sunk, s2)).toEqual([['lo', 'hi']]);
    const onSpacer = [real('s', 'spacer', 1, 1, { width: 70, depth: 50 }), real('hi', 'tray', 1, 1, recess, 50)];
    expect(restingElevation('hi', onSpacer, s2)).toBe(30);
  });

  it('on a mix it rests on the highest effective surface; supporters are those that meet it', () => {
    // Lipped tray (top 33.2, engages 2 → 31.2) next to a plain tray (top 31.2): both carry it at 31.2.
    const lo1 = real('l1', 'tray', 1, 1, { stackTop: 'lip' });
    const lo2 = real('l2', 'tray', 64.2, 1);
    const wide = { ...recess, innerWidth: 123.2 };
    const hi = real('hi', 'tray', 1, 1, wide, 50);
    expect(restingElevation('hi', [lo1, lo2, hi], s2)).toBeCloseTo(31.2, 9);
    const placed = [lo1, lo2, { ...hi, z: 31.2 }];
    expect(unsupportedItems(placed, s2)).toEqual([]);
    expect(findOverlaps(placed, s2)).toEqual([]);
    // Two lipped trays: rests at 31.2 too; a lipped + a spacer of 33.2 → spacer is the highest surface.
    const sp = real('sp', 'spacer', 64.2, 1, { width: 63.2, depth: 43.2, height: 33.2 });
    expect(restingElevation('hi', [lo1, sp, hi], s2)).toBeCloseTo(33.2, 9);
    // At 33.2 only the spacer meets it: half covered → floating.
    expect(unsupportedItems([lo1, sp, { ...hi, z: 33.2 }], s2)).toEqual(['hi']);
  });

  it('plugs and platform corner stops keep their engagement on anything', () => {
    const plug = [real('lo', 'tray', 1, 1), real('hi', 'tray', 1, 1, { stackBottom: 'plug' }, 50)];
    expect(restingElevation('hi', plug, s2)).toBeCloseTo(29.2, 9);
    const stops = [real('lo', 'tray', 1, 1, { innerWidth: 96.8, innerDepth: 96.8 }), real('p', 'platform', 1, 1, {}, 50)];
    expect(restingElevation('p', stops, s2)).toBeCloseTo(29.2, 9);
  });
});
