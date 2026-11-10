/**
 * Single application store (zustand). Holds the project, selection and a
 * snapshot-based undo history of `project`.
 */
import { create } from 'zustand';
import type { ParamValue, PlacedItem, Project, ProjectSettings } from '../model/types';
import { createEmptyProject } from '../model/types';
import { getBoxType } from '../boxes/registry';
import { newItemParams, type RaiseMode } from '../boxes/types';
import { flatBasesOnFloor, flattenTop, type FinishResult } from '../model/finish';
import type { Rect } from '../model/layout';
import { carriedItemIds, elevationOf, rectInside, rectsOverlap, safeItemRect, settle, stackedAboveIds, usableArea } from '../model/layout';

export const HISTORY_LIMIT = 100;
/**
 * Consecutive changes to the same field (same coalescing key) made within this
 * many milliseconds merge into one undo step, so typing "120" into a number
 * field or dragging a spinner is undone in one go instead of per keystroke.
 */
export const COALESCE_MS = 1000;

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
  /**
   * Coalescing key and time of the last recorded change; a change with the
   * same key within COALESCE_MS joins that undo step instead of adding one.
   * Reset by undo/redo, drags and every change without a key.
   */
  lastCommit: { key: string; at: number } | null;

  setKernelReady(ready: boolean): void;
  setKernelError(error: string | null): void;
  setSettings(partial: DeepPartial<ProjectSettings>): void;
  setBoxSize(size: { width?: number; depth?: number; height?: number }): void;
  /** Adds an item; `at` is the desired centre of its footprint. Returns the new id. */
  addItem(typeId: string, at?: { x: number; y: number }): string;
  updateItem(id: string, patch: ItemPatch): void;
  setParam(id: string, key: string, value: ParamValue): void;
  /**
   * Move an item to (x, y), carrying the items stacked on it (moveStack with
   * carry). Inside beginDrag/endDrag, moves are coalesced into one undo step.
   */
  moveItem(id: string, x: number, y: number): void;
  /**
   * Move an item by (dx, dy). With `carry`, everything resting on it
   * (transitively; a bridge only when all its supporters move) moves along,
   * and the moved items go to the end of the stack order (keeping their
   * relative order), so they land on top of whatever they now overlap.
   * Without `carry` (pull-out) only the item moves; it goes to the end of
   * the order just before everything resting on it (`stackedAboveIds`, which
   * stays put), so what still overlaps it stays on it, what no longer does
   * drops to whatever is under it, and it climbs onto what it is pushed over
   * instead of pushing neighbours up.
   */
  moveStack(id: string, dx: number, dy: number, opts: { carry: boolean }): void;
  /** Move an item to position `toIndex` (clamped) of the stack order. */
  reorderItem(id: string, toIndex: number): void;
  rotateItem(id: string): void;
  removeItem(id: string): void;
  duplicateItem(id: string): string | null;
  /**
   * Duplicate an item on top of itself: the copy (same x/y) is inserted right
   * after the source in the stack order, so it rests on it. Returns the new id.
   */
  duplicateItemStacked(id: string): string | null;
  /** Remove the base stacking features of every item on the game box floor (one undo step). */
  flatBasesOnFloor(): FinishResult;
  /** Raise every stack top to `height` and remove its lip (one undo step); see `flattenTop`. */
  flattenTop(height: number, mode: RaiseMode): FinishResult;
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

/** "Tokens" → "Tokens (level 2)", "Tokens (level 2)" → "Tokens (level 3)". */
export function stackedLabel(label: string): string {
  const m = /^(.*?)\s*\(level (\d+)\)$/.exec(label);
  if (m) return `${m[1]} (level ${Number(m[2]) + 1})`;
  return `${label.trim() || 'Box'} (level 2)`;
}

/** `p` with `items` settled by gravity (`settle`); `p` itself when nothing changes. */
function withItems(p: Project, items: PlacedItem[]): Project {
  const settled = settle(items, p.settings);
  return settled === p.items ? p : { ...p, items: settled };
}

/** `p` with its items settled (snapshots from undo/redo are normally settled already). */
function settled(p: Project): Project {
  return withItems(p, p.items);
}

/**
 * Migration for projects saved before z was derived (DESIGN.md §2): the stack
 * order is the stored z, ascending (stable), then gravity settles the items.
 */
export function migrateStackOrder(project: Project): Project {
  const order = project.items.map((item, idx) => ({ item, idx, z: elevationOf(item) }));
  order.sort((a, b) => a.z - b.z || a.idx - b.idx);
  const unchanged = order.every((o, i) => o.idx === i);
  return withItems(project, unchanged ? project.items : order.map((o) => o.item));
}

function labelBase(name: string): string {
  return name.trim() || 'Box';
}

export const useStore = create<AppState>()((set, get) => {
  /**
   * Apply a change to the project, recording an undo snapshot. With a
   * `coalesceKey`, a change that follows one with the same key within
   * COALESCE_MS extends that undo step (the snapshot is kept, no new one).
   */
  const commit = (fn: (p: Project) => Project, coalesceKey?: string) => {
    const { project, past, dragBase, lastCommit } = get();
    const next = fn(project);
    if (next === project) return;
    if (dragBase) {
      // Coalesced: the snapshot was already pushed by beginDrag.
      set({ project: next });
      return;
    }
    const now = Date.now();
    if (coalesceKey && lastCommit && lastCommit.key === coalesceKey && now - lastCommit.at <= COALESCE_MS && past.length) {
      set({ project: next, future: [], lastCommit: { key: coalesceKey, at: now } });
      return;
    }
    const nextPast = [...past, project];
    if (nextPast.length > HISTORY_LIMIT) nextPast.splice(0, nextPast.length - HISTORY_LIMIT);
    set({ project: next, past: nextPast, future: [], lastCommit: coalesceKey ? { key: coalesceKey, at: now } : null });
  };

  const mapItem = (id: string, fn: (i: PlacedItem) => PlacedItem, coalesceKey?: string) =>
    commit((p) => {
      const idx = p.items.findIndex((i) => i.id === id);
      if (idx < 0) return p;
      const updated = fn(p.items[idx]);
      if (updated === p.items[idx]) return p;
      const items = p.items.slice();
      items[idx] = updated;
      return withItems(p, items);
    }, coalesceKey);

  return {
    project: createEmptyProject(),
    selectedId: null,
    kernelReady: false,
    kernelError: null,
    past: [],
    future: [],
    dragBase: null,
    lastCommit: null,

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
        return settled({ ...p, settings });
      }, `settings:${settingsPaths(partial).join(',')}`),

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
        params: newItemParams(def),
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
      commit((p) => withItems(p, [...p.items, item]));
      set({ selectedId: item.id });
      return item.id;
    },

    updateItem: (id, patch) =>
      mapItem(
        id,
        (i) => {
          const next = { ...i, ...patch, id: i.id };
          // Allow clearing overrides by passing undefined explicitly.
          if ('wall' in patch && patch.wall === undefined) delete next.wall;
          if ('floor' in patch && patch.floor === undefined) delete next.floor;
          return next;
        },
        `item:${id}:${Object.keys(patch).sort().join(',')}`,
      ),

    setParam: (id, key, value) =>
      mapItem(id, (i) => (i.params[key] === value ? i : { ...i, params: { ...i.params, [key]: value } }), `param:${id}:${key}`),

    moveItem: (id, x, y) => {
      const item = get().project.items.find((i) => i.id === id);
      if (!item) return;
      get().moveStack(id, round(x) - item.x, round(y) - item.y, { carry: true });
    },

    moveStack: (id, dx, dy, { carry }) =>
      commit((p) => {
        if (!p.items.some((i) => i.id === id)) return p;
        if (!(Number.isFinite(dx) && Number.isFinite(dy)) || (dx === 0 && dy === 0)) return p;
        // carry: the item and its stack move and go to the end of the order.
        // Pull-out: only the item moves, but it goes to the end together with
        // everything resting on it (which stays in place), so what still
        // overlaps it stays on it and drops once it slides out, while
        // neighbours it is pushed against do not climb onto it.
        const ids = new Set(carry ? carriedItemIds(p.items, p.settings, id) : stackedAboveIds(p.items, p.settings, id));
        const rest: PlacedItem[] = [];
        const moved: PlacedItem[] = [];
        for (const i of p.items) {
          if (!ids.has(i.id)) rest.push(i);
          else if (carry || i.id === id) moved.push({ ...i, x: round(i.x + dx), y: round(i.y + dy) });
          else moved.push(i);
        }
        return withItems(p, [...rest, ...moved]);
      }),

    reorderItem: (id, toIndex) =>
      commit((p) => {
        const from = p.items.findIndex((i) => i.id === id);
        if (from < 0) return p;
        const to = Math.min(Math.max(0, Math.trunc(Number.isFinite(toIndex) ? toIndex : from)), p.items.length - 1);
        if (to === from) return p;
        const items = p.items.slice();
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item);
        return withItems(p, items);
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
      commit((p) => (p.items.some((i) => i.id === id) ? withItems(p, p.items.filter((i) => i.id !== id)) : p));
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
      // The free spot search works on the floor level: the copy starts there.
      delete copy.z;
      commit((p) => withItems(p, [...p.items, copy]));
      set({ selectedId: copy.id });
      return copy.id;
    },

    duplicateItemStacked: (id) => {
      const { items } = get().project;
      const src = items.find((i) => i.id === id);
      if (!src) return null;
      const copy: PlacedItem = {
        ...structuredClone(src),
        id: newId(),
        label: stackedLabel(src.label),
      };
      delete copy.z;
      commit((p) => {
        const idx = p.items.findIndex((i) => i.id === id);
        if (idx < 0) return p;
        const next = p.items.slice();
        next.splice(idx + 1, 0, copy);
        return withItems(p, next);
      });
      set({ selectedId: copy.id });
      return copy.id;
    },

    flatBasesOnFloor: () => {
      const { project } = get();
      const result = flatBasesOnFloor(project.items, project.settings);
      if (result.changedIds.length) commit((p) => withItems(p, result.items));
      return result;
    },

    flattenTop: (height, mode) => {
      const { project } = get();
      const result = flattenTop(project.items, project.settings, height, mode);
      if (result.changedIds.length) commit((p) => withItems(p, result.items));
      return result;
    },

    select: (id) => set({ selectedId: id }),

    loadProject: (project) => {
      commit(() => migrateStackOrder(structuredClone(project)));
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
      set({ dragBase: null, past: nextPast, future: [], lastCommit: null });
    },

    undo: () => {
      if (get().dragBase) get().endDrag();
      const { past, future, project, selectedId } = get();
      if (!past.length) return;
      const prev = settled(past[past.length - 1]);
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future],
        lastCommit: null,
        selectedId: selectedId && prev.items.some((i) => i.id === selectedId) ? selectedId : null,
      });
    },

    redo: () => {
      const { past, future, project, selectedId } = get();
      if (!future.length) return;
      const next = settled(future[0]);
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        lastCommit: null,
        selectedId: selectedId && next.items.some((i) => i.id === selectedId) ? selectedId : null,
      });
    },
  };
});

/** Dotted paths of the defined leaves of a settings patch, sorted: `box.width`, `name`, … */
function settingsPaths(partial: DeepPartial<ProjectSettings>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) if (v2 !== undefined) out.push(`${k}.${k2}`);
    } else out.push(k);
  }
  return out.sort();
}

function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  const out: Partial<T> = {};
  if (!o) return out;
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
