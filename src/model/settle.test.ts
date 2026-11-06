import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { itemTray } from '../boxes/definitions/item-tray';
import { platform } from '../boxes/definitions/platform';
import { spacer } from '../boxes/definitions/spacer';
import { fakeBox, trayParams } from './fakeBox.testutil';
import type { ItemParams, PlacedItem, ProjectSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { carriedItemIds, itemRect, layoutSummary, settle, supportersById } from './layout';

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 400, depth: 400, height: 150 },
};

function at(id: string, type: string, x: number, y: number, params: ItemParams = {}, z?: number): PlacedItem {
  const item: PlacedItem = { id, type, label: id.toUpperCase(), x, y, rotation: 0, params: trayParams(type, params) };
  if (z !== undefined) item.z = z;
  return item;
}

const zOf = (items: PlacedItem[]) => Object.fromEntries(items.map((i) => [i.id, i.z ?? 0]));

beforeEach(() => {
  clearRegistry();
  for (const d of [fakeBox, itemTray, platform, spacer]) registerBoxType(d);
});

describe('settle', () => {
  it('stack order is the array order: later items rest on earlier ones', () => {
    const a = at('a', 'fake', 10, 10, { w: 40, d: 20, h: 10 });
    const b = at('b', 'fake', 10, 10, { w: 40, d: 20, h: 5 });
    expect(zOf(settle([a, b], settings))).toEqual({ a: 0, b: 10 });
    expect(zOf(settle([b, a], settings))).toEqual({ b: 0, a: 5 });
    // A third item on both ends up on the top of the stack.
    const c = at('c', 'fake', 20, 15);
    expect(zOf(settle([a, b, c], settings))).toEqual({ a: 0, b: 10, c: 15 });
  });

  it('ignores stored z: stale values are replaced, floor items lose the field', () => {
    const a = at('a', 'fake', 10, 10, {}, 33);
    const b = at('b', 'fake', 100, 100, {}, 4);
    const c = at('c', 'fake', 15, 12, {}, 0);
    const out = settle([a, b, c], settings);
    expect('z' in out[0]).toBe(false);
    expect('z' in out[1]).toBe(false);
    expect(out[2].z).toBe(10);
  });

  it('keeps identity: unchanged items and an already settled array are returned as is', () => {
    const a = at('a', 'fake', 10, 10);
    const b = at('b', 'fake', 10, 10, {}, 10);
    const c = at('c', 'fake', 100, 10, {}, 7);
    const items = [a, b, c];
    const out = settle(items, settings);
    expect(out).not.toBe(items);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
    expect(out[2]).not.toBe(c);
    expect(settle(out, settings)).toBe(out);
  });

  it('rounds to 0.001 mm', () => {
    const a = at('a', 'fake', 10, 10, { w: 40, d: 20, h: 10.12345 });
    const b = at('b', 'fake', 10, 10);
    expect(settle([a, b], settings)[1].z).toBe(10.123);
  });

  it('subtracts the engagement of the item on what it rests on (lip + recess)', () => {
    const lip = { stackTop: 'lip', stackBottom: 'recess' };
    const items = settle([at('a', 'item-tray', 1, 1, lip), at('b', 'item-tray', 1, 1, lip), at('c', 'item-tray', 1, 1, lip)], settings);
    // Tray 31.2 + 2 mm lip; the recess sinks the 2 mm lip.
    expect(zOf(items)).toEqual({ a: 0, b: 31.2, c: 62.4 });
    // A recess on a tray without a lip does not engage: it rests on the top.
    const plain = settle([at('a', 'item-tray', 1, 1), at('b', 'item-tray', 1, 1, { stackBottom: 'recess' })], settings);
    expect(plain[1].z).toBeCloseTo(31.2, 9);
    expect(layoutSummary(items, settings).issues).toEqual([]);
  });

  it('a bridge over two trays rests on the higher one', () => {
    const lo = at('lo', 'fake', 10, 10, { w: 40, d: 40, h: 10 });
    const hi = at('hi', 'fake', 50, 10, { w: 40, d: 40, h: 15 });
    const bridge = at('x', 'fake', 20, 20, { w: 60, d: 20, h: 3 });
    const items = settle([lo, hi, bridge], settings);
    expect(items[2].z).toBe(15);
    expect(supportersById(items, settings).get('x')).toEqual(['hi']);
    // Equal heights: supported by both.
    const both = settle([lo, { ...hi, params: { w: 40, d: 40, h: 10 } }, bridge], settings);
    expect(both[2].z).toBe(10);
    expect(supportersById(both, settings).get('x')).toEqual(['lo', 'hi']);
  });

  it('a platform on two trays, with a recessed tray on its plate (locating ridges)', () => {
    const t1 = at('t1', 'item-tray', 1, 1);
    const t2 = at('t2', 'item-tray', 64.2, 1);
    const p = at('p', 'platform', 1, 1, { width: 126.4, depth: 43.2 });
    const t = at('t', 'item-tray', 10, 5, { stackBottom: 'recess' }, 99);
    const items = settle([t1, t2, p, t], settings);
    const plate = itemRect(items[2], settings).top; // context‑free top: the plate
    expect(items[2].z).toBeCloseTo(31.2 - 2, 9); // corner stops sink 2 mm into the trays
    expect(items[3].z).toBeCloseTo(plate, 9);
    // The ridges now locate the tray: the platform's top is above its plate.
    expect(itemRect(items[2], settings, items).top).toBeGreaterThan(plate);
    expect(settle(items, settings)).toBe(items);
    expect(layoutSummary(items, settings).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('an empty list and unknown types do not throw', () => {
    expect(settle([], settings)).toEqual([]);
    const u = at('u', 'nope', 10, 10);
    const a = at('a', 'fake', 10, 10, {}, 5);
    expect(zOf(settle([u, a], settings))).toEqual({ u: 0, a: 0 });
  });
});

describe('carriedItemIds', () => {
  it('collects everything resting on the item, transitively, in stack order', () => {
    const items = settle(
      [at('a', 'fake', 10, 10), at('far', 'fake', 200, 10), at('b', 'fake', 10, 10), at('c', 'fake', 12, 10, { w: 10, d: 10 })],
      settings,
    );
    expect(carriedItemIds(items, settings, 'a')).toEqual(['a', 'b', 'c']);
    expect(carriedItemIds(items, settings, 'b')).toEqual(['b', 'c']);
    expect(carriedItemIds(items, settings, 'far')).toEqual(['far']);
    expect(carriedItemIds(items, settings, 'nope')).toEqual([]);
  });

  it('carries a bridge only when all its supporters are carried', () => {
    const base = at('base', 'fake', 10, 10, { w: 100, d: 40, h: 5 });
    const l = at('l', 'fake', 10, 10, { w: 40, d: 40, h: 10 });
    const r = at('r', 'fake', 60, 10, { w: 40, d: 40, h: 10 });
    const bridge = at('x', 'fake', 20, 20, { w: 60, d: 20, h: 3 });
    const items = settle([base, l, r, bridge], settings);
    expect(carriedItemIds(items, settings, 'l')).toEqual(['l']);
    expect(carriedItemIds(items, settings, 'base')).toEqual(['base', 'l', 'r', 'x']);
  });
});
