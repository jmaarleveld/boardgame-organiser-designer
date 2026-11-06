import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { createEmptyProject } from '../model/types';
import { findOverlaps, unsupportedItems, usableArea } from '../model/layout';
import { fakeBox } from '../model/fakeBox.testutil';
import { tray } from '../boxes/definitions/tray';
import { dividedTray } from '../boxes/definitions/divided-tray';
import { cardTray } from '../boxes/definitions/card-tray';
import { spacer } from '../boxes/definitions/spacer';
import { platform } from '../boxes/definitions/platform';
import { defaultParams } from '../boxes/types';
import { HISTORY_LIMIT, migrateStackOrder, useStore } from './store';
import { registerAllBoxTypes } from '../boxes/index';
import { createPersistence } from '../services/persistence';
import { readFileSync } from 'node:fs';

const st = () => useStore.getState();
const items = () => st().project.items;

beforeEach(() => {
  clearRegistry();
  registerBoxType(fakeBox);
  useStore.setState({ project: createEmptyProject(), past: [], future: [], selectedId: null, dragBase: null });
});

describe('store', () => {
  it('adds items with labels and free spots', () => {
    const a = st().addItem('fake');
    const b = st().addItem('fake');
    expect(items().map((i) => i.label)).toEqual(['Tray 1', 'Tray 2']);
    const u = usableArea(st().project.settings);
    expect(items()[0]).toMatchObject({ x: u.x, y: u.y, rotation: 0, params: { w: 40, d: 20, h: 10 } });
    expect(items()[1]).toMatchObject({ x: u.x + 40, y: u.y });
    expect(findOverlaps(items(), st().project.settings)).toEqual([]);
    expect(st().selectedId).toBe(b);
    expect(a).not.toBe(b);
  });

  it('adds at a drop point (centre), clamped into the usable area', () => {
    st().addItem('fake', { x: 100, y: 100 });
    expect(items()[0]).toMatchObject({ x: 80, y: 90 });
    st().addItem('fake', { x: 1000, y: -50 });
    const u = usableArea(st().project.settings);
    expect(items()[1]).toMatchObject({ x: u.x + u.width - 40, y: u.y });
  });

  it('moves, and undo/redo restores', () => {
    const id = st().addItem('fake');
    st().moveItem(id, 50, 60);
    expect(items()[0]).toMatchObject({ x: 50, y: 60 });
    st().undo();
    expect(items()[0]).toMatchObject({ x: 1, y: 1 });
    st().undo();
    expect(items()).toHaveLength(0);
    expect(st().selectedId).toBeNull();
    st().redo();
    st().redo();
    expect(items()[0]).toMatchObject({ x: 50, y: 60 });
  });

  it('coalesces drags into one undo step', () => {
    const id = st().addItem('fake');
    const pastLen = st().past.length;
    st().beginDrag();
    for (let i = 0; i < 10; i++) st().moveItem(id, 10 + i, 10);
    st().endDrag();
    expect(st().past.length).toBe(pastLen + 1);
    st().undo();
    expect(items()[0]).toMatchObject({ x: 1, y: 1 });
  });

  it('a drag without movement adds no history', () => {
    st().addItem('fake');
    const pastLen = st().past.length;
    st().beginDrag();
    st().endDrag();
    expect(st().past.length).toBe(pastLen);
  });

  it('rotates around the centre', () => {
    const id = st().addItem('fake', { x: 100, y: 50 });
    const before = items()[0];
    expect(before).toMatchObject({ x: 80, y: 40 });
    st().rotateItem(id);
    // 40x20 → 20x40 around centre (100, 50).
    expect(items()[0]).toMatchObject({ rotation: 90, x: 90, y: 30 });
    st().rotateItem(id);
    expect(items()[0]).toMatchObject({ rotation: 0, x: 80, y: 40 });
  });

  it('rotation stays inside the usable area when possible', () => {
    const id = st().addItem('fake'); // at (1,1), 40x20
    st().rotateItem(id);
    expect(items()[0]).toMatchObject({ rotation: 90, x: 11, y: 1 });
  });

  it('duplicates next to the source and removes', () => {
    const id = st().addItem('fake');
    const copy = st().duplicateItem(id)!;
    expect(items()).toHaveLength(2);
    expect(items()[1]).toMatchObject({ x: 41, y: 1, label: 'Tray 2' });
    expect(st().selectedId).toBe(copy);
    st().removeItem(copy);
    expect(items()).toHaveLength(1);
    expect(st().selectedId).toBeNull();
  });

  it('setParam / updateItem / overrides', () => {
    const id = st().addItem('fake');
    st().setParam(id, 'w', 70);
    st().updateItem(id, { wall: 2 });
    expect(items()[0]).toMatchObject({ params: { w: 70 }, wall: 2 });
    st().updateItem(id, { wall: undefined });
    expect('wall' in items()[0]).toBe(false);
  });

  it('deep-merges settings', () => {
    st().setSettings({ tolerance: { x: 5 } });
    expect(st().project.settings.tolerance).toEqual({ x: 5, y: 2 });
    st().setBoxSize({ height: 33 });
    expect(st().project.settings.box.height).toBe(33);
    expect(st().project.settings.box.width).toBe(290);
  });

  it('caps history', () => {
    const id = st().addItem('fake');
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) st().moveItem(id, i + 2, 1);
    expect(st().past.length).toBe(HISTORY_LIMIT);
  });

  it('loadProject and newProject reset selection and are undoable', () => {
    st().addItem('fake');
    const saved = structuredClone(st().project);
    st().newProject();
    expect(items()).toHaveLength(0);
    st().loadProject(saved);
    expect(items()).toHaveLength(1);
    expect(st().selectedId).toBeNull();
    st().undo();
    expect(items()).toHaveLength(0);
  });

  it('z is derived by gravity: a stale z is replaced on every change', () => {
    const id = st().addItem('fake');
    st().updateItem(id, { z: 12.34567 });
    expect('z' in items()[0]).toBe(false);
    const b = st().addItem('fake');
    st().updateItem(b, { x: items()[0].x, y: items()[0].y, z: 99 });
    expect(items()[1].z).toBe(10);
    // Removing what it rests on drops it to the floor.
    st().removeItem(id);
    expect('z' in items()[0]).toBe(false);
    st().undo();
    expect(items()[1].z).toBe(10);
  });

  it('moving an item onto another makes it rest on it (with engagement); moving it off drops it', () => {
    const a = st().addItem('fake'); // 40×20×10
    const b = st().addItem('fake');
    const [ia, ib] = items();
    st().setParam(b, 'e', 2);
    expect('z' in ib).toBe(false);
    st().moveItem(b, ia.x, ia.y);
    expect(items()[1]).toMatchObject({ id: b, z: 8 });
    expect(findOverlaps(items(), st().project.settings)).toEqual([]);
    st().moveItem(b, 150, 60);
    expect('z' in items()[1]).toBe(false);
    // A moved item goes on top: moving the lower one under it lifts it onto b.
    st().moveItem(a, 150, 60);
    expect(items().map((i) => i.id)).toEqual([b, a]);
    expect(items()[1].z).toBe(10);
  });

  it('duplicateItemStacked inserts a copy right after the source: same x/y, rests on it, level label', () => {
    const id = st().addItem('fake');
    const other = st().addItem('fake');
    const copyId = st().duplicateItemStacked(id)!;
    expect(items().map((i) => i.id)).toEqual([id, copyId, other]);
    const copy = items()[1];
    expect(copy).toMatchObject({ id: copyId, x: items()[0].x, y: items()[0].y, z: 10, label: 'Tray 1 (level 2)' });
    expect(st().selectedId).toBe(copyId);
    const third = st().duplicateItemStacked(copyId)!;
    expect(items().find((i) => i.id === third)).toMatchObject({ z: 20, label: 'Tray 1 (level 3)' });
    // With engagement the copy sinks into the source (re-settled automatically).
    st().setParam(third, 'e', 2);
    expect(items().find((i) => i.id === third)?.z).toBe(18);
    const fourth = st().duplicateItemStacked(third)!;
    expect(items().find((i) => i.id === fourth)?.z).toBe(26);
    expect(findOverlaps(items(), st().project.settings)).toEqual([]);
    expect(unsupportedItems(items(), st().project.settings)).toEqual([]);
    // Duplicating the bottom one inserts into the stack: everything above moves up.
    st().duplicateItemStacked(id);
    expect(items().find((i) => i.id === fourth)?.z).toBe(36);
    // A plain duplicate goes back to the floor level.
    const flat = st().duplicateItem(copyId)!;
    expect('z' in items().find((i) => i.id === flat)!).toBe(false);
  });

  describe('moveStack', () => {
    /** a (floor) ← b ← c, plus d on the floor elsewhere. */
    const tower = () => {
      const a = st().addItem('fake', { x: 50, y: 50 });
      const b = st().duplicateItemStacked(a)!;
      const c = st().duplicateItemStacked(b)!;
      const d = st().addItem('fake', { x: 200, y: 50 });
      return { a, b, c, d };
    };
    const byId = (id: string) => items().find((i) => i.id === id)!;

    it('with carry moves the item and everything on it, and puts them on top of the order', () => {
      const { a, b, c, d } = tower();
      st().moveStack(a, 100, 10, { carry: true });
      expect(items().map((i) => i.id)).toEqual([d, a, b, c]);
      expect(byId(a)).toMatchObject({ x: 130, y: 50 });
      expect(byId(b)).toMatchObject({ x: 130, y: 50, z: 10 });
      expect(byId(c)).toMatchObject({ x: 130, y: 50, z: 20 });
      // Over d, the whole stack lands on top of it.
      expect('z' in byId(a)).toBe(false);
      st().moveStack(a, 50, 0, { carry: true });
      expect(byId(a).z).toBe(10);
      expect(byId(c).z).toBe(30);
    });

    it('moving a middle item takes only what is above it', () => {
      const { a, b, c } = tower();
      st().moveStack(b, 0, 100, { carry: true });
      expect('z' in byId(a)).toBe(false);
      expect('z' in byId(b)).toBe(false);
      expect(byId(c)).toMatchObject({ y: 140, z: 10 });
    });

    it('without carry pulls the item out; what was on it drops and re-settles', () => {
      const { a, b, c, d } = tower();
      st().moveStack(a, 0, 100, { carry: false });
      // The pulled item goes to the end, just before what rested on it.
      expect(items().map((i) => i.id)).toEqual([d, a, b, c]);
      expect(byId(a)).toMatchObject({ x: 30, y: 140 });
      expect('z' in byId(a)).toBe(false);
      expect('z' in byId(b)).toBe(false);
      expect(byId(c)).toMatchObject({ x: 30, y: 40, z: 10 });
    });

    it('without carry, items still overlapping the pulled item stay on it until it slides out', () => {
      const { a, b, c, d } = tower();
      st().beginDrag();
      // Half way out (a is 40 wide): b and c still rest on a and do not move.
      st().moveStack(a, 20, 0, { carry: false });
      expect(items().map((i) => i.id)).toEqual([d, a, b, c]);
      expect('z' in byId(a)).toBe(false);
      expect(byId(b)).toMatchObject({ x: 30, z: 10 });
      expect(byId(c)).toMatchObject({ x: 30, z: 20 });
      // All the way out: they drop to the floor.
      st().moveStack(a, 30, 0, { carry: false });
      expect('z' in byId(b)).toBe(false);
      expect(byId(c).z).toBe(10);
      st().endDrag();
      expect(st().past.length).toBeGreaterThan(0);
    });

    it('without carry, a neighbour the pulled item is pushed against does not climb onto it', () => {
      const { a, b, d } = tower();
      // a (x 30..70) is pulled right over d (x 180..220): a climbs onto d, d stays on the floor.
      st().moveStack(a, 160, 0, { carry: false });
      expect('z' in byId(d)).toBe(false);
      expect(byId(a)).toMatchObject({ x: 190, z: 10 });
      expect('z' in byId(b)).toBe(false);
    });

    it('without carry, a bridge resting on the pulled item and a neighbour stays put', () => {
      const l = st().addItem('fake', { x: 50, y: 50 }); // 30..70
      const r = st().addItem('fake', { x: 90, y: 50 }); // 70..110
      const x = st().addItem('fake', { x: 70, y: 50 }); // 50..90, on both
      st().moveStack(l, -10, 0, { carry: false });
      expect(items().map((i) => i.id)).toEqual([r, l, x]);
      expect(byId(x)).toMatchObject({ x: 50, z: 10 });
    });

    it('a bridge stays (and re-settles) when one of its supporters stays behind', () => {
      const l = st().addItem('fake', { x: 50, y: 50 }); // 30..70 × 40..60, h 10
      const r = st().addItem('fake', { x: 90, y: 50 }); // 70..110
      const x = st().addItem('fake', { x: 70, y: 50 }); // 50..90, on both
      expect(byId(x).z).toBe(10);
      st().moveStack(l, 0, 100, { carry: true });
      expect(byId(l)).toMatchObject({ y: 140 });
      expect(byId(x)).toMatchObject({ x: 50, y: 40, z: 10 }); // still on r
      // Now it rests on r alone: moving r carries it; pulling r out drops it.
      st().moveStack(r, 0, 100, { carry: true });
      expect(byId(x)).toMatchObject({ y: 140, z: 10 });
      st().undo();
      st().moveStack(r, 0, 100, { carry: false });
      expect(byId(x)).toMatchObject({ x: 50, y: 40 });
      expect(byId(x).z).toBeUndefined();
    });

    it('carries a bridge whose supporters all move', () => {
      const base = st().addItem('fake', { x: 70, y: 50 });
      st().setParam(base, 'w', 80);
      const l = st().addItem('fake', { x: 50, y: 50 });
      const r = st().addItem('fake', { x: 90, y: 50 });
      const x = st().addItem('fake', { x: 70, y: 50 });
      expect([byId(l).z, byId(r).z, byId(x).z]).toEqual([10, 10, 20]);
      st().moveStack(base, 0, 100, { carry: true });
      expect(byId(x)).toMatchObject({ y: 140, z: 20 });
    });

    it('a zero move or an unknown id changes nothing', () => {
      const { a } = tower();
      const before = st().project;
      const pastLen = st().past.length;
      st().moveStack(a, 0, 0, { carry: true });
      st().moveStack('nope', 5, 5, { carry: true });
      expect(st().project).toBe(before);
      expect(st().past.length).toBe(pastLen);
    });

    it('a drag of a stack (many moveStack calls) is one undo step', () => {
      const { a, b, c, d } = tower();
      const order = items().map((i) => i.id);
      const pastLen = st().past.length;
      st().beginDrag();
      for (let i = 1; i <= 15; i++) st().moveStack(a, 10, 0, { carry: true });
      st().endDrag();
      expect(st().past.length).toBe(pastLen + 1);
      expect(byId(c)).toMatchObject({ x: 180, z: 30 }); // ended up on d
      st().undo();
      expect(items().map((i) => i.id)).toEqual(order);
      expect(byId(a)).toMatchObject({ x: 30 });
      expect(byId(c).z).toBe(20);
      expect([a, b, d].map((id) => byId(id).z ?? 0)).toEqual([0, 10, 0]);
      st().redo();
      expect(byId(c)).toMatchObject({ x: 180, z: 30 });
    });
  });

  it('reorderItem changes the stack order and re-settles', () => {
    const a = st().addItem('fake', { x: 50, y: 50 });
    const b = st().duplicateItemStacked(a)!;
    st().setParam(b, 'h', 5);
    expect(items()[1]).toMatchObject({ id: b, z: 10 });
    st().reorderItem(b, 0);
    expect(items().map((i) => i.id)).toEqual([b, a]);
    expect('z' in items()[0]).toBe(false);
    expect(items()[1].z).toBe(5);
    // Clamped; a no‑op adds no history.
    const pastLen = st().past.length;
    st().reorderItem(b, -3);
    expect(st().past.length).toBe(pastLen);
    st().reorderItem(b, 99);
    expect(items().map((i) => i.id)).toEqual([a, b]);
    st().undo();
    expect(items().map((i) => i.id)).toEqual([b, a]);
  });

  describe('loading old projects (z → stack order)', () => {
    it('sorts by stored z (stable) and settles', () => {
      const p = createEmptyProject();
      const fake = (id: string, x: number, z?: number) => ({
        id,
        type: 'fake',
        label: id,
        x,
        y: 10,
        rotation: 0 as const,
        params: {},
        ...(z === undefined ? {} : { z }),
      });
      // Stored top‑down, and with a stale z for 'mid'.
      p.items.push(fake('top', 10, 20), fake('mid', 10, 12), fake('bottom', 10), fake('side', 100));
      st().loadProject(p);
      expect(items().map((i) => i.id)).toEqual(['bottom', 'side', 'mid', 'top']);
      expect(items().map((i) => i.z ?? 0)).toEqual([0, 0, 10, 20]);
      expect(migrateStackOrder(st().project)).toBe(st().project);
    });

    it('examples/stacking-demo.json keeps its stored z values under gravity', () => {
      clearRegistry();
      registerAllBoxTypes();
      const file = createPersistence({} as Storage).fromJson(readFileSync('examples/stacking-demo.json', 'utf8'));
      st().loadProject(file);
      const loaded = new Map(items().map((i) => [i.id, i.z ?? 0]));
      expect(loaded.size).toBe(file.items.length);
      const changed = file.items.filter((i) => loaded.get(i.id) !== (i.z ?? 0)).map((i) => [i.id, i.z, loaded.get(i.id)]);
      // Every stored z is reproduced by settling in stack order (case K, a tray
      // "sunk into" another, was removed: gravity cannot express it).
      expect(changed).toEqual([]);
    });
  });

  describe('creation-time stacking params', () => {
    beforeEach(() => {
      for (const d of [tray, dividedTray, cardTray, spacer, platform]) registerBoxType(d);
    });

    it.each(['tray', 'divided-tray', 'card-tray'])('a new %s gets lip + recess', (type) => {
      const id = st().addItem(type);
      const item = items().find((i) => i.id === id)!;
      expect(item.params).toMatchObject({ stackTop: 'lip', stackBottom: 'recess' });
    });

    it('ParamSpec defaults stay flat so saved projects keep their geometry', () => {
      for (const d of [tray, dividedTray, cardTray]) {
        expect(defaultParams(d)).toMatchObject({ stackTop: 'none', stackBottom: 'none' });
      }
    });

    it('spacer and platform are unaffected', () => {
      for (const d of [spacer, platform]) {
        const id = st().addItem(d.id);
        expect(items().find((i) => i.id === id)!.params).toEqual(defaultParams(d));
      }
    });

    it('duplicates keep the source params (no creation-time override)', () => {
      const id = st().addItem('tray');
      st().setParam(id, 'stackTop', 'none');
      st().setParam(id, 'stackBottom', 'plug');
      const copy = st().duplicateItem(id)!;
      const stacked = st().duplicateItemStacked(id)!;
      for (const c of [copy, stacked]) {
        expect(items().find((i) => i.id === c)!.params).toMatchObject({ stackTop: 'none', stackBottom: 'plug' });
      }
    });

    it('loading a project keeps its params as stored', () => {
      const p = createEmptyProject();
      p.items.push({ id: 'a', type: 'tray', label: 'T', x: 1, y: 1, rotation: 0, params: {} });
      st().loadProject(p);
      expect(items()[0].params).toEqual({});
    });
  });

  it('duplicate on top of a recessed tray without a lip rests on its top', () => {
    registerBoxType(tray);
    const id = st().addItem('tray');
    st().setParam(id, 'stackTop', 'none');
    const copy = st().duplicateItemStacked(id)!;
    expect(items().find((i) => i.id === copy)?.z).toBeCloseTo(31.2, 9);
    // Adding a lip to both: the copy re-settles with its recess on the lip.
    st().setParam(id, 'stackTop', 'lip');
    st().setParam(copy, 'stackTop', 'lip');
    expect(items().find((i) => i.id === copy)?.z).toBeCloseTo(31.2, 9); // 33.2 − 2
    const third = st().duplicateItemStacked(copy)!;
    expect(items().find((i) => i.id === third)?.z).toBeCloseTo(62.4, 9);
  });
});
