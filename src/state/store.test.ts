import { beforeEach, describe, expect, it } from 'vitest';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { createEmptyProject } from '../model/types';
import { findOverlaps, unsupportedItems, usableArea } from '../model/layout';
import { fakeBox } from '../model/fakeBox.testutil';
import { HISTORY_LIMIT, useStore } from './store';

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

  it('setElevation clamps, rounds, clears at 0 and is undoable', () => {
    const id = st().addItem('fake');
    st().setElevation(id, 12.34567);
    expect(items()[0].z).toBe(12.346);
    st().setElevation(id, -4);
    expect('z' in items()[0]).toBe(false);
    st().undo();
    expect(items()[0].z).toBe(12.346);
  });

  it('stackOnBelow rests an item on what it overlaps (with engagement) or drops it to the floor', () => {
    const a = st().addItem('fake'); // 40×20×10
    const b = st().addItem('fake');
    const [ia, ib] = items();
    st().updateItem(b, { x: ia.x, y: ia.y, z: 50, params: { ...ib.params, e: 2 } });
    st().stackOnBelow(b);
    expect(items()[1].z).toBe(8);
    expect(findOverlaps(items(), st().project.settings)).toEqual([]);
    st().moveItem(b, 150, 60);
    st().stackOnBelow(b);
    expect('z' in items()[1]).toBe(false);
    expect(a).not.toBe(b);
  });

  it('duplicateItemStacked puts a copy on top: same x/y, z = top − engagement, level label', () => {
    const id = st().addItem('fake');
    const copyId = st().duplicateItemStacked(id)!;
    const copy = items()[1];
    expect(copy).toMatchObject({ id: copyId, x: items()[0].x, y: items()[0].y, z: 10, label: 'Tray 1 (level 2)' });
    expect(st().selectedId).toBe(copyId);
    const third = st().duplicateItemStacked(copyId)!;
    expect(items().find((i) => i.id === third)).toMatchObject({ z: 20, label: 'Tray 1 (level 3)' });
    // With engagement the copy sinks into the source.
    st().updateItem(third, { params: { ...items()[2].params, e: 2 } });
    st().stackOnBelow(third);
    expect(items()[2].z).toBe(18);
    const fourth = st().duplicateItemStacked(third)!;
    expect(items().find((i) => i.id === fourth)?.z).toBe(26);
    expect(findOverlaps(items(), st().project.settings)).toEqual([]);
    expect(unsupportedItems(items(), st().project.settings)).toEqual([]);
    // A plain duplicate goes back to the floor level.
    const flat = st().duplicateItem(copyId)!;
    expect('z' in items().find((i) => i.id === flat)!).toBe(false);
  });
});
