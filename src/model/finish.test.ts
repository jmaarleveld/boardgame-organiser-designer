import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllBoxTypes } from '../boxes/index';
import { getBoxType } from '../boxes/registry';
import { newItemParams } from '../boxes/types';
import { flatBasesOnFloor, flattenTop, stackTopIds } from './finish';
import { effectiveTop, itemRect, itemsTooTall, settle } from './layout';
import { resolveItem } from './resolve';
import type { ItemParams, PlacedItem, ProjectSettings } from './types';
import { DEFAULT_SETTINGS } from './types';

beforeAll(() => {
  registerAllBoxTypes();
});

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 300, depth: 300, height: 120 },
};

function at(id: string, type: string, x: number, y: number, params: ItemParams = {}): PlacedItem {
  return { id, type, label: id.toUpperCase(), x, y, rotation: 0, params: { ...newItemParams(getBoxType(type)), ...params } };
}

/**
 * A: item tray on the floor, B: the same tray on A (lip / recess), C: upright
 * card tray (cards stick out), D: spacer, E: platform on the floor (corner
 * stops), F: plugged tray on the floor.
 */
function layout(): PlacedItem[] {
  return settle(
    [
      at('a', 'item-tray', 10, 10),
      at('b', 'item-tray', 10, 10),
      at('c', 'card-tray-upright', 100, 10),
      at('d', 'spacer', 10, 200),
      at('e', 'platform', 150, 150),
      at('f', 'item-tray', 60, 200, { stackBottom: 'plug' }),
    ],
    settings,
  );
}

const byId = (items: PlacedItem[], id: string) => items.find((i) => i.id === id)!;

describe('flatBasesOnFloor', () => {
  it('removes recess, plug and corner stops from the items on the floor only', () => {
    const items = layout();
    const zB = itemRect(byId(items, 'b'), settings, items).z;
    const r = flatBasesOnFloor(items, settings);
    expect(r.problems).toEqual([]);
    expect(r.changedIds.sort()).toEqual(['a', 'c', 'e', 'f']);
    expect(byId(r.items, 'a').params.stackBottom).toBe('none');
    expect(byId(r.items, 'a').params.stackTop).toBe('lip'); // the lip stays: B is located by it
    expect(byId(r.items, 'b').params.stackBottom).toBe('recess');
    expect(byId(r.items, 'e').params.cornerStops).toBe(false);
    expect(byId(r.items, 'f').params.stackBottom).toBe('none');
    // A keeps its height (the recess is cut into it), so B stays where it is.
    const settled = settle(r.items, settings);
    expect(itemRect(byId(settled, 'b'), settings, settled).z).toBeCloseTo(zB, 9);
  });

  it('a second run changes nothing', () => {
    const once = flatBasesOnFloor(layout(), settings).items;
    const twice = flatBasesOnFloor(once, settings);
    expect(twice.changedIds).toEqual([]);
    expect(twice.items).toBe(once);
  });
});

describe('stackTopIds', () => {
  it('lists the items nothing rests on', () => {
    expect(stackTopIds(layout(), settings).sort()).toEqual(['b', 'c', 'd', 'e', 'f']);
  });
});

describe('flattenTop', () => {
  for (const mode of ['type', 'walls'] as const) {
    it(`mode ${mode}: every stack top ends at the height, without a lip, nothing sticks out`, () => {
      const items = layout();
      const r = flattenTop(items, settings, 120, mode);
      expect(r.problems).toEqual([]);
      expect(r.changedIds.sort()).toEqual(['b', 'c', 'd', 'e', 'f']);
      const out = settle(r.items, settings);
      for (const id of r.changedIds) {
        expect(itemRect(byId(out, id), settings, out).top).toBeCloseTo(120, 2);
        expect(effectiveTop(byId(out, id), settings, out)).toBeLessThanOrEqual(120 + 0.01);
        expect(byId(out, id).params.stackTop ?? 'none').not.toBe('lip');
      }
      // A, under B, is left alone.
      expect(byId(out, 'a')).toEqual(byId(items, 'a'));
      expect(itemsTooTall(out, settings)).toEqual([]);
      for (const i of out) expect(getBoxType(i.type).validate?.(resolveItem(i, settings, out)) ?? []).toEqual([]);
    });
  }

  it('per type raises the upright tray floor so the cards end at the height; taller walls hide them instead', () => {
    const items = layout();
    const c0 = byId(items, 'c');
    const cards0 = effectiveTop(c0, settings, items);
    const perType = byId(flattenTop(items, settings, 120, 'type').items, 'c');
    const walls = byId(flattenTop(items, settings, 120, 'walls').items, 'c');
    expect(perType.floor).toBeCloseTo(1.2 + (120 - cards0), 3);
    expect(walls.floor).toBeUndefined();
    expect(walls.params.extraHeight).toBeGreaterThan(0);
  });

  it('refuses a height below the highest point, naming it', () => {
    const items = layout();
    const r = flattenTop(items, settings, 50, 'type');
    expect(r.items).toBe(items);
    expect(r.changedIds).toEqual([]);
    expect(r.problems[0]).toMatch(/^Flatten height \(50 mm\) must be at least the highest point of the insert \([\d.]+ mm, C\)\.$/);
  });

  it('a second run at the same height changes nothing', () => {
    const once = settle(flattenTop(layout(), settings, 110, 'type').items, settings);
    const twice = flattenTop(once, settings, 110, 'type');
    expect(twice.changedIds).toEqual([]);
    expect(twice.problems).toEqual([]);
  });
});
