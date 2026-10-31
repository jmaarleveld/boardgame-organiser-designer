/**
 * Single application store (zustand). Holds the project, selection and a
 * snapshot-based undo history of `project`.
 */
import { create } from 'zustand';
import type { ParamValue, PlacedItem, Project, ProjectSettings } from '../model/types';
import { createEmptyProject } from '../model/types';
import { getBoxType } from '../boxes/registry';
import { defaultParams } from '../boxes/types';
import type { Rect } from '../model/layout';
import { rectInside, rectsOverlap, safeItemRect, usableArea } from '../model/layout';

export const HISTORY_LIMIT = 100;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type ItemPatch = Partial<Omit<PlacedItem, 'id'>>;

export interface AppState {
  project: Project;
  selectedId: string | null;
  kernelReady: boolean;
  /** Non-null when loading the geometry kernel failed. */
  kernelError: string | null;
  past: Project[];
  future: Project[];
  /** Snapshot taken by beginDrag; non-null while a drag is in progress. */
  dragBase: Project | null;

  setKernelReady(ready: boolean): void;
  setKernelError(error: string | null): void;
  setSettings(partial: DeepPartial<ProjectSettings>): void;
  setBoxSize(size: { width?: number; depth?: number; height?: number }): void;
  /** Adds an item; `at` is the desired centre of its footprint. Returns the new id. */
  addItem(typeId: string, at?: { x: number; y: number }): string;
  updateItem(id: string, patch: ItemPatch): void;
  setParam(id: string, key: string, value: ParamValue): void;
  /** Move an item. Inside beginDrag/endDrag, moves are coalesced into one undo step. */
  moveItem(id: string, x: number, y: number): void;
  rotateItem(id: string): void;
  removeItem(id: string): void;
  duplicateItem(id: string): string | null;
  select(id: string | null): void;
  loadProject(project: Project): void;
  newProject(): void;
  beginDrag(): void;
  endDrag(): void;
  undo(): void;
  redo(): void;
}

let idCounter = 0;
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  idCounter += 1;
  return `item-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function rectOf(item: PlacedItem, settings: ProjectSettings): Rect {
  return safeItemRect(item, settings);
}

/** First position (scanning candidates top→bottom, left→right) where a rect fits without overlap. */
export function findFreeSpot(
  size: { width: number; depth: number },
  others: Rect[],
  usable: Rect,
): { x: number; y: number } | null {
  const xs = new Set<number>([usable.x]);
  const ys = new Set<number>([usable.y]);
  for (const o of others) {
    xs.add(o.x + o.width);
    xs.add(o.x);
    ys.add(o.y + o.depth);
    ys.add(o.y);
  }
  const cands: { x: number; y: number }[] = [];
  for (const y of ys) for (const x of xs) cands.push({ x, y });
  cands.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of cands) {
    const r = { x: c.x, y: c.y, width: size.width, depth: size.depth };
    if (!rectInside(r, usable)) continue;
    if (others.some((o) => rectsOverlap(o, r))) continue;
    return c;
  }
  return null;
}

/** Shift a rect minimally so it lies inside `area` (if it fits). */
function clampInto(r: Rect, area: Rect): { x: number; y: number } {
  let { x, y } = r;
  if (r.width <= area.width) x = Math.min(Math.max(x, area.x), area.x + area.width - r.width);
  if (r.depth <= area.depth) y = Math.min(Math.max(y, area.y), area.y + area.depth - r.depth);
  return { x, y };
}

function nextLabel(base: string, items: PlacedItem[]): string {
  const used = new Set(items.map((i) => i.label));
  let n = items.filter((i) => i.label.startsWith(base + ' ')).length + 1;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function labelBase(name: string): string {
  return name.trim() || 'Box';
}

export const useStore = create<AppState>()((set, get) => {
  /** Apply a change to the project, recording an undo snapshot. */
  const commit = (fn: (p: Project) => Project) => {
    const { project, past, dragBase } = get();
    const next = fn(project);
    if (next === project) return;
    if (dragBase) {
      // Coalesced: the snapshot was already pushed by beginDrag.
      set({ project: next });
      return;
    }
    const nextPast = [...past, project];
    if (nextPast.length > HISTORY_LIMIT) nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
    set({ project: next, past: nextPast, future: [] });
  };

  const mapItem = (id: string, fn: (i: PlacedItem) => PlacedItem) =>
    commit((p) => {
      const idx = p.items.findIndex((i) => i.id === id);
      if (idx < 0) return p;
      const updated = fn(p.items[idx]);
      if (updated === p.items[idx]) return p;
      const items = p.items.slice();
      items[idx] = updated;
      return { ...p, items };
    });

  return {
    project: createEmptyProject(),
    selectedId: null,
    kernelReady: false,
    kernelError: null,
    past: [],
    future: [],
    dragBase: null,

    setKernelReady: (ready) => set({ kernelReady: ready, ...(ready ? { kernelError: null } : {}) }),
    setKernelError: (error) => set({ kernelError: error, ...(error ? { kernelReady: false } : {}) }),

    setSettings: (partial) =>
      commit((p) => {
        const s = p.settings;
        const settings: ProjectSettings = {
          name: partial.name ?? s.name,
          gridSnap: partial.gridSnap ?? s.gridSnap,
          box: { ...s.box, ...stripUndefined(partial.box) },
          tolerance: { ...s.tolerance, ...stripUndefined(partial.tolerance) },
          defaults: { ...s.defaults, ...stripUndefined(partial.defaults) },
        };
        return { ...p, settings };
      }),

    setBoxSize: (size) => get().setSettings({ box: size }),

    addItem: (typeId, at) => {
      const def = getBoxType(typeId);
      const { project } = get();
      const { settings, items } = project;
      const item: PlacedItem = {
        id: newId(),
        type: typeId,
        label: nextLabel(labelBase(def.name), items),
        x: 0,
        y: 0,
        rotation: 0,
        params: defaultParams(def),
      };
      const usable = usableArea(settings);
      const r = rectOf(item, settings);
      const others = items.map((i) => rectOf(i, settings));
      let pos: { x: number; y: number };
      if (at) {
        pos = { x: at.x - r.width / 2, y: at.y - r.depth / 2 };
        const g = settings.gridSnap;
        if (g > 0) {
          pos = {
            x: usable.x + Math.round((pos.x - usable.x) / g) * g,
            y: usable.y + Math.round((pos.y - usable.y) / g) * g,
          };
        }
        pos = clampInto({ ...r, ...pos }, usable);
      } else {
        pos = findFreeSpot(r, others, usable) ?? { x: usable.x, y: usable.y };
      }
      item.x = round(pos.x);
      item.y = round(pos.y);
      commit((p) => ({ ...p, items: [...p.items, item] }));
      set({ selectedId: item.id });
      return item.id;
    },

    updateItem: (id, patch) =>
      mapItem(id, (i) => {
        const next = { ...i, ...patch, id: i.id };
        // Allow clearing overrides by passing undefined explicitly.
        if ('wall' in patch && patch.wall === undefined) delete next.wall;
        if ('floor' in patch && patch.floor === undefined) delete next.floor;
        return next;
      }),

    setParam: (id, key, value) =>
      mapItem(id, (i) => (i.params[key] === value ? i : { ...i, params: { ...i.params, [key]: value } })),

    moveItem: (id, x, y) =>
      mapItem(id, (i) => {
        const nx = round(x);
        const ny = round(y);
        return i.x === nx && i.y === ny ? i : { ...i, x: nx, y: ny };
      }),

    rotateItem: (id) => {
      const { settings, items } = get().project;
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const before = rectOf(item, settings);
      const rotated: PlacedItem = { ...item, rotation: item.rotation === 90 ? 0 : 90 };
      const after = rectOf(rotated, settings);
      const cx = before.x + before.width / 2;
      const cy = before.y + before.depth / 2;
      let pos = { x: cx - after.width / 2, y: cy - after.depth / 2 };
      const usable = usableArea(settings);
      const g = settings.gridSnap;
      if (g > 0) {
        pos = {
          x: usable.x + Math.round((pos.x - usable.x) / g) * g,
          y: usable.y + Math.round((pos.y - usable.y) / g) * g,
        };
      }
      // Keep the item in the usable area if it was there before.
      if (rectInside(before, usable)) pos = clampInto({ ...after, ...pos }, usable);
      mapItem(id, () => ({ ...rotated, x: round(pos.x), y: round(pos.y) }));
    },

    removeItem: (id) => {
      commit((p) => (p.items.some((i) => i.id === id) ? { ...p, items: p.items.filter((i) => i.id !== id) } : p));
      if (get().selectedId === id) set({ selectedId: null });
    },

    duplicateItem: (id) => {
      const { settings, items } = get().project;
      const src = items.find((i) => i.id === id);
      if (!src) return null;
      const r = rectOf(src, settings);
      const usable = usableArea(settings);
      const others = items.map((i) => rectOf(i, settings));
      const free = (pos: { x: number; y: number }) => {
        const c = { ...r, ...pos };
        return rectInside(c, usable) && !others.some((o) => rectsOverlap(o, c));
      };
      const candidates = [
        { x: r.x + r.width, y: r.y },
        { x: r.x, y: r.y + r.depth },
        { x: r.x - r.width, y: r.y },
        { x: r.x, y: r.y - r.depth },
      ];
      const pos =
        candidates.find(free) ??
        findFreeSpot(r, others, usable) ??
        clampInto({ ...r, x: r.x + r.width, y: r.y }, usable);
      const base = src.label.replace(/\s+\d+$/, '') || 'Box';
      const copy: PlacedItem = {
        ...structuredClone(src),
        id: newId(),
        label: nextLabel(base, items),
        x: round(pos.x),
        y: round(pos.y),
      };
      commit((p) => ({ ...p, items: [...p.items, copy] }));
      set({ selectedId: copy.id });
      return copy.id;
    },

    select: (id) => set({ selectedId: id }),

    loadProject: (project) => {
      commit(() => structuredClone(project));
      set({ selectedId: null });
    },

    newProject: () => {
      commit(() => createEmptyProject());
      set({ selectedId: null });
    },

    beginDrag: () => {
      const { project, dragBase } = get();
      if (dragBase) return;
      set({ dragBase: project });
    },

    endDrag: () => {
      const { project, dragBase, past } = get();
      if (!dragBase) return;
      if (project === dragBase) {
        set({ dragBase: null });
        return;
      }
      const nextPast = [...past, dragBase];
      if (nextPast.length > HISTORY_LIMIT) nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
      set({ dragBase: null, past: nextPast, future: [] });
    },

    undo: () => {
      if (get().dragBase) get().endDrag();
      const { past, future, project, selectedId } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future],
        selectedId: selectedId && prev.items.some((i) => i.id === selectedId) ? selectedId : null,
      });
    },

    redo: () => {
      const { past, future, project, selectedId } = get();
      if (!future.length) return;
      const next = future[0];
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        selectedId: selectedId && next.items.some((i) => i.id === selectedId) ? selectedId : null,
      });
    },
  };
});

function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
