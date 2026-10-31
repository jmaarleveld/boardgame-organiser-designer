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
  safeItemRect,
  snapPosition,
  usableArea,
} from './layout';
import { fakeBox } from './fakeBox.testutil';

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 200, depth: 100, height: 50 },
  tolerance: { x: 2, y: 4 },
  gridSnap: 5,
};

function item(id: string, x: number, y: number, p: Partial<{ w: number; d: number; h: number }> = {}, rotation: 0 | 90 = 0): PlacedItem {
  return { id, type: 'fake', label: id.toUpperCase(), x, y, rotation, params: { ...p } };
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
    expect(itemRect(item('a', 3, 4), settings)).toEqual({ x: 3, y: 4, width: 40, depth: 20, height: 10 });
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
