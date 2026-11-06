import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { tray } from '../boxes/definitions/tray';
import { platform } from '../boxes/definitions/platform';
import { spacer } from '../boxes/definitions/spacer';
import { fakeBox } from './fakeBox.testutil';
import type { ItemParams, PlacedItem, ProjectSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { buildStackTree, dropBeforeIndex, flattenStackTree } from './stackTree';

const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 400, depth: 400, height: 150 },
};

function at(id: string, x: number, y: number, params: ItemParams = {}): PlacedItem {
  return { id, type: 'fake', label: id.toUpperCase(), x, y, rotation: 0, params };
}

beforeEach(() => {
  clearRegistry();
  for (const d of [fakeBox, tray, platform, spacer]) registerBoxType(d);
});

describe('buildStackTree', () => {
  it('floor-only items are all roots in array order', () => {
    const t = buildStackTree([at('a', 0, 0), at('b', 100, 0), at('c', 200, 0)], settings);
    expect(t.map((n) => n.item.id)).toEqual(['a', 'b', 'c']);
    expect(t.every((n) => n.children.length === 0 && n.z === 0 && n.depth === 0)).toBe(true);
  });

  it('single stack nests bottom to top', () => {
    const p = { w: 40, d: 20, h: 10 };
    const t = buildStackTree([at('a', 10, 10, p), at('b', 10, 10, p), at('c', 10, 10, p)], settings);
    expect(t).toHaveLength(1);
    expect(t[0].children[0].item.id).toBe('b');
    expect(t[0].children[0].z).toBe(10);
    expect(t[0].children[0].children[0].item.id).toBe('c');
    expect(t[0].children[0].children[0].depth).toBe(2);
    expect(flattenStackTree(t).map((n) => n.item.id)).toEqual(['a', 'b', 'c']);
  });

  it('a bridge over two trays is listed under its first supporter with alsoOn', () => {
    const p = { w: 40, d: 40, h: 10 };
    const items = [at('a', 0, 0, p), at('b', 50, 0, p), at('br', 20, 0, { w: 50, d: 40, h: 5 })];
    const t = buildStackTree(items, settings);
    expect(t.map((n) => n.item.id)).toEqual(['a', 'b']);
    expect(t[0].children.map((n) => n.item.id)).toEqual(['br']);
    expect(t[0].children[0].alsoOn).toEqual(['B']);
    expect(t[1].children).toEqual([]);
  });

  it('order change flips which item is underneath', () => {
    const p = { w: 40, d: 20, h: 10 };
    const t = buildStackTree([at('b', 10, 10, p), at('a', 10, 10, p)], settings);
    expect(t[0].item.id).toBe('b');
    expect(t[0].children[0].item.id).toBe('a');
  });
});

describe('dropBeforeIndex', () => {
  it('computes reorderItem target', () => {
    expect(dropBeforeIndex(0, 3)).toBe(2);
    expect(dropBeforeIndex(3, 1)).toBe(1);
    expect(dropBeforeIndex(2, 3)).toBe(2);
  });
});
