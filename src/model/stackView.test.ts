import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { fakeBox } from './fakeBox.testutil';
import type { ItemParams, PlacedItem, ProjectSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { settle } from './layout';
import { EXPLODE_GAP, explodeGap, explodeOffsets, fadedItemIds, hasStacks, stackLevels } from './stackView';

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 400, depth: 400, height: 150 },
};

function at(id: string, x: number, y: number, params: ItemParams = { w: 40, d: 20, h: 10 }): PlacedItem {
  return { id, type: 'fake', label: id.toUpperCase(), x, y, rotation: 0, params };
}

const S = (items: PlacedItem[]) => settle(items, settings);

beforeEach(() => {
  clearRegistry();
  registerBoxType(fakeBox);
});

describe('fadedItemIds', () => {
  it('is empty without a (known) selection', () => {
    const items = S([at('a', 0, 0), at('b', 0, 0)]);
    expect(fadedItemIds(items, settings, null).size).toBe(0);
    expect(fadedItemIds(items, settings, 'nope').size).toBe(0);
  });

  it('fades everything stacked over the selected item, not what is below or beside it', () => {
    // a ← b ← c stack; d is a separate stack, e sits on d at the same height as c.
    const items = S([at('a', 0, 0), at('b', 0, 0), at('c', 0, 0), at('d', 100, 0), at('e', 100, 0), at('f', 100, 0)]);
    expect([...fadedItemIds(items, settings, 'a')].sort()).toEqual(['b', 'c']);
    expect([...fadedItemIds(items, settings, 'b')]).toEqual(['c']);
    expect(fadedItemIds(items, settings, 'c').size).toBe(0);
  });

  it('fades a partly overlapping bridge above the selection', () => {
    const p = { w: 40, d: 40, h: 10 };
    const items = S([at('a', 0, 0, p), at('b', 50, 0, p), at('br', 20, 0, { w: 50, d: 40, h: 5 })]);
    expect([...fadedItemIds(items, settings, 'b')]).toEqual(['br']);
    expect(fadedItemIds(items, settings, 'br').size).toBe(0);
  });

  it('fades a lid that sinks into the selected tray (rests below its top)', () => {
    const items = S([at('a', 0, 0), at('lid', 0, 0, { w: 40, d: 20, h: 4, e: 2 })]);
    expect(items[1].z).toBeCloseTo(8);
    expect([...fadedItemIds(items, settings, 'a')]).toEqual(['lid']);
  });
});

describe('stackLevels / explodeOffsets', () => {
  it('counts levels per stack', () => {
    const items = S([at('a', 0, 0), at('b', 0, 0), at('c', 0, 0), at('d', 100, 0)]);
    const lv = stackLevels(items, settings);
    expect(Object.fromEntries(lv)).toEqual({ a: 0, b: 1, c: 2, d: 0 });
    const off = explodeOffsets(items, settings);
    expect(off.get('c')).toBe(2 * EXPLODE_GAP);
    expect(explodeOffsets(items, settings, 0).get('c')).toBe(0);
  });

  it('puts a bridge one level above its highest supporter', () => {
    // Left stack is two high (a, a2), right is one (b), both tops at z = 20 / 20.
    const items = S([
      at('a', 0, 0, { w: 40, d: 40, h: 10 }),
      at('a2', 0, 0, { w: 40, d: 40, h: 10 }),
      at('b', 50, 0, { w: 40, d: 40, h: 20 }),
      at('br', 20, 0, { w: 50, d: 40, h: 5 }),
    ]);
    expect(items[3].z).toBeCloseTo(20);
    const lv = stackLevels(items, settings);
    expect(lv.get('br')).toBe(2);
    expect(explodeOffsets(items, settings, 10).get('br')).toBe(20);
  });
});

describe('explodeGap / hasStacks', () => {
  it('scales the gap with the tallest item, never below EXPLODE_GAP', () => {
    expect(explodeGap(S([at('a', 0, 0)]), settings)).toBe(EXPLODE_GAP);
    const tall = S([at('a', 0, 0, { w: 40, d: 20, h: 100 })]);
    expect(explodeGap(tall, settings)).toBeGreaterThanOrEqual(30);
    expect(explodeGap(tall, settings)).toBeLessThanOrEqual(33);
  });

  it('is false when every item stands on the floor', () => {
    expect(hasStacks([], settings)).toBe(false);
    expect(hasStacks(S([at('a', 0, 0), at('b', 100, 0)]), settings)).toBe(false);
    expect(hasStacks(S([at('a', 0, 0), at('b', 0, 0)]), settings)).toBe(true);
  });
});
