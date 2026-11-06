import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { fakeBox } from './fakeBox.testutil';
import type { PlacedItem, ProjectSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import type { ItemRect } from './layout';
import { settle, usableArea } from './layout';
import { chooseDragPlane, dragDelta, dragPlanePoint, dragStep, gapLabels, nudgeDelta, startDragSession } from './drag';

// Usable area: x, y in [1, 399] (tolerance 2).
const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 400, depth: 400, height: 100 },
  gridSnap: 1,
};

function at(id: string, x: number, y: number, w = 40, d = 20, h = 10): PlacedItem {
  return { id, type: 'fake', label: id, x, y, rotation: 0, params: { w, d, h } };
}

const rect = (x: number, y: number, width: number, depth: number, z = 0, height = 10): ItemRect => ({
  x,
  y,
  width,
  depth,
  z,
  height,
  top: z + height,
});

beforeEach(() => {
  clearRegistry();
  registerBoxType(fakeBox);
});

describe('drag session', () => {
  it('snaps against items that stay put; with carry the stack on the item is excluded', () => {
    const items = settle([at('a', 100, 100), at('b', 100, 100), at('c', 200, 100)], settings);
    const carry = startDragSession(items, settings, 'a', { x: 110, y: 105 }, true)!;
    expect(carry.movingIds.sort()).toEqual(['a', 'b']);
    expect(carry.others).toHaveLength(1);
    expect(carry.size).toEqual({ width: 40, depth: 20 });
    const pull = startDragSession(items, settings, 'a', { x: 110, y: 105 }, false)!;
    expect(pull.movingIds).toEqual(['a']);
    expect(pull.others).toHaveLength(2);
    expect(startDragSession(items, settings, 'nope', { x: 0, y: 0 }, true)).toBeNull();
  });

  it('keeps the grab offset and snaps to a neighbour edge', () => {
    const items = [at('a', 100, 100), at('c', 200, 100)];
    const s = startDragSession(items, settings, 'a', { x: 110, y: 105 }, true)!;
    // Moving the pointer by (+58.3, +0.4) proposes x 158.3 → right edge 198.3 snaps to c's left edge (200).
    const step = dragStep(s, { x: 168.3, y: 105.4 }, settings, { snap: true, threshold: 3 });
    expect(step.x).toBe(160);
    expect(step.y).toBe(100); // aligned with c's top edge
    expect(step.guides.some((g) => g.axis === 'x' && g.pos === 200)).toBe(true);
    expect(dragDelta(items[0], step)).toEqual({ dx: 60, dy: 0 });
  });

  it('without snapping only rounds to 0.1 mm', () => {
    const items = [at('a', 100, 100), at('c', 200, 100)];
    const s = startDragSession(items, settings, 'a', { x: 110, y: 105 }, true)!;
    const step = dragStep(s, { x: 168.34, y: 105.46 }, settings, { snap: false, threshold: 3 });
    expect(step).toEqual({ x: 158.3, y: 100.5, guides: [] });
  });

  it('keeps at least half of the item inside the game box', () => {
    const s = startDragSession([at('a', 100, 100)], settings, 'a', { x: 100, y: 100 }, true)!;
    const step = dragStep(s, { x: -500, y: 900 }, settings, { snap: false, threshold: 3 });
    expect(step.x).toBe(-20);
    expect(step.y).toBe(390);
  });
});

describe('drag plane', () => {
  const grab = { x: 50, y: 60, z: 30 };

  it('uses the horizontal plane at the grab height for steep views', () => {
    expect(chooseDragPlane([0, 0, -1])).toBe('horizontal');
    expect(chooseDragPlane([0.6, 0.6, -0.5])).toBe('horizontal');
    // Ray from (0, -100, 130) going down 45° hits z = 30 at y = 0.
    expect(dragPlanePoint('horizontal', [10, -100, 130], [0, Math.SQRT1_2, -Math.SQRT1_2], grab)).toEqual({
      x: 10,
      y: expect.closeTo(0, 9),
    });
    // Pointing up, away from the plane.
    expect(dragPlanePoint('horizontal', [0, 0, 130], [0, 0.6, 0.8], grab)).toBeNull();
  });

  it('falls back to an upright plane through the grab point for near-horizontal views', () => {
    expect(chooseDragPlane([0, 1, -0.05])).toBe('vertical');
    // Front view: looking along +y; the plane is y = 60, so x follows the ray and y stays.
    const p = dragPlanePoint('vertical', [80, -400, 40], [0, 1, -0.02], grab)!;
    expect(p.x).toBeCloseTo(80);
    expect(p.y).toBeCloseTo(60);
    // Side view: looking along −x; the plane is x = 50.
    const q = dragPlanePoint('vertical', [500, 70, 40], [-1, 0, 0], grab)!;
    expect(q).toEqual({ x: 50, y: 70 });
    expect(dragPlanePoint('vertical', [0, 0, 0], [0, 0, -1], grab)).toBeNull();
  });
});

describe('gapLabels', () => {
  const usable = usableArea(settings);

  it('measures to the walls when there are no neighbours', () => {
    const g = gapLabels(rect(50, 60, 40, 20), [], usable);
    const by = Object.fromEntries(g.map((l) => [l.side, l]));
    expect(by['x-']).toMatchObject({ distance: 49, kind: 'wall', from: { x: 50, y: 70 }, to: { x: 1, y: 70 } });
    expect(by['x+']).toMatchObject({ distance: 309, kind: 'wall' });
    expect(by['y-']).toMatchObject({ distance: 59, kind: 'wall', from: { x: 70, y: 60 }, to: { x: 70, y: 1 } });
    expect(by['y+']).toMatchObject({ distance: 319, kind: 'wall' });
  });

  it('measures to the nearest neighbour edge that faces the item', () => {
    const r = rect(100, 100, 40, 20);
    const others = [
      rect(10, 100, 20, 20), // left, far
      rect(60, 110, 30, 20), // left, nearer, overlaps 110..120
      rect(150, 0, 10, 50), // right but not overlapping in y
      rect(160, 90, 10, 20), // right
      rect(100, 130, 10, 10), // behind (+y)
      rect(100, 100, 40, 20, 10), // stacked on top: not at the same height
    ];
    const by = Object.fromEntries(gapLabels(r, others, usable).map((l) => [l.side, l]));
    expect(by['x-']).toMatchObject({ distance: 10, kind: 'item', from: { x: 100, y: 115 }, to: { x: 90, y: 115 } });
    expect(by['x+']).toMatchObject({ distance: 20, kind: 'item', from: { x: 140, y: 105 } });
    expect(by['y+']).toMatchObject({ distance: 10, kind: 'item', from: { x: 105, y: 120 }, to: { x: 105, y: 130 } });
    expect(by['y-']).toMatchObject({ distance: 99, kind: 'wall' });
  });

  it('ignores items at another height and items overlapping the footprint', () => {
    const r = rect(100, 100, 40, 20, 10);
    const others = [rect(60, 100, 30, 20, 0, 10), rect(90, 100, 60, 20, 0, 10)];
    const by = Object.fromEntries(gapLabels(r, others, usable).map((l) => [l.side, l]));
    expect(by['x-'].kind).toBe('wall');
    expect(by['x+'].kind).toBe('wall');
  });
});

describe('nudgeDelta', () => {
  it('follows the screen: ArrowUp increases y in the y-up 3D editor', () => {
    expect(nudgeDelta('ArrowUp', 1, true)).toEqual({ dx: 0, dy: 1 });
    expect(nudgeDelta('ArrowDown', 10, true)).toEqual({ dx: 0, dy: -10 });
    expect(nudgeDelta('ArrowLeft', 1, true)).toEqual({ dx: -1, dy: 0 });
    expect(nudgeDelta('ArrowRight', 1, false)).toEqual({ dx: 1, dy: 0 });
  });
  it('ArrowUp decreases y in the y-down 2D view', () => {
    expect(nudgeDelta('ArrowUp', 1, false)).toEqual({ dx: 0, dy: -1 });
    expect(nudgeDelta('ArrowDown', 1, false)).toEqual({ dx: 0, dy: 1 });
    expect(nudgeDelta('a', 1, true)).toBeNull();
  });
});
