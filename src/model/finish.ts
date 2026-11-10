/**
 * One-off "finishing" actions on the whole layout (DESIGN.md §4.5): they
 * rewrite item params through the box types' `flatBase` / `flatTop` / `raise`
 * hooks and return the new items; the store settles them.
 *
 * - `flatBasesOnFloor`: every item standing on the game box floor loses the
 *   stacking features of its base (recess, plug, corner stops).
 * - `flattenTop`: every item at the top of a stack (no later item overlaps it
 *   in XY, so by gravity nothing rests on it) loses its lip and is raised so
 *   its top is exactly the given height: a flat surface for the game board.
 */
import { findBoxType } from '../boxes/registry';
import type { ItemEdit, RaiseMode } from '../boxes/types';
import { effectiveTop, EPS, rectsOverlap, safeItemRect } from './layout';
import { elevationOf, resolveItem } from './resolve';
import type { PlacedItem, ProjectSettings } from './types';

export interface FinishResult {
  /** The new items (the input array itself when nothing changed). */
  items: PlacedItem[];
  /** Ids of the items that were changed. */
  changedIds: string[];
  /** Why something could not be done, as full sentences. */
  problems: string[];
}

/** Tolerance (mm) for "the top is at the target height". */
const HEIGHT_TOL = 0.01;

const fmt = (v: number) => `${Math.round(v * 100) / 100} mm`;

/** `item` with `edit` applied; `item` itself when the edit changes nothing. */
export function applyEdit(item: PlacedItem, edit: ItemEdit | null | undefined): PlacedItem {
  if (!edit) return item;
  let next = item;
  const params = edit.params ?? {};
  if (Object.entries(params).some(([k, v]) => item.params[k] !== v)) next = { ...next, params: { ...item.params, ...params } };
  if (edit.floor !== undefined && edit.floor !== item.floor) next = { ...next, floor: edit.floor };
  return next;
}

function replaced(items: readonly PlacedItem[], item: PlacedItem): PlacedItem[] {
  return items.map((i) => (i.id === item.id ? item : i));
}

/** Remove the base stacking features of every item on the game box floor (z = 0). */
export function flatBasesOnFloor(items: PlacedItem[], settings: ProjectSettings): FinishResult {
  const changedIds: string[] = [];
  const problems: string[] = [];
  const next = items.map((item) => {
    if (elevationOf(item) > 0) return item;
    const def = findBoxType(item.type);
    if (!def?.flatBase) return item;
    try {
      const out = applyEdit(item, def.flatBase(resolveItem(item, settings, items)));
      if (out !== item) changedIds.push(item.id);
      return out;
    } catch (e) {
      problems.push(`${item.label} could not be changed: ${e instanceof Error ? e.message : String(e)}`);
      return item;
    }
  });
  return { items: changedIds.length ? next : items, changedIds, problems };
}

/**
 * Ids of the items at the top of their stack: no later item in the stack
 * order overlaps them in XY (gravity puts every later overlapping item on
 * top), in stack order.
 */
export function stackTopIds(items: readonly PlacedItem[], settings: ProjectSettings): string[] {
  const rects = items.map((i) => safeItemRect(i, settings, items));
  return items.filter((_, i) => !rects.some((r, j) => j > i && rectsOverlap(rects[i], r))).map((i) => i.id);
}

/**
 * Raise every stack top to `height` (mm above the game box floor) and remove
 * its lip, so the insert's top is flat. `height` must be at least the highest
 * point of the insert (incl. standing cards); otherwise nothing changes and
 * the problem is reported. `mode` picks how the height is added (`RaiseMode`).
 */
export function flattenTop(items: PlacedItem[], settings: ProjectSettings, height: number, mode: RaiseMode): FinishResult {
  const none = (problem: string): FinishResult => ({ items, changedIds: [], problems: [problem] });
  if (!(Number.isFinite(height) && height > 0)) return none(`Flatten height must be greater than 0 (is ${height}).`);
  if (!items.length) return none('There are no items to flatten.');
  let highest = -Infinity;
  let highestLabel = '';
  for (const i of items) {
    const t = effectiveTop(i, settings, items);
    if (t > highest) {
      highest = t;
      highestLabel = i.label;
    }
  }
  if (height < highest - HEIGHT_TOL) {
    return none(`Flatten height (${fmt(height)}) must be at least the highest point of the insert (${fmt(highest)}, ${highestLabel}).`);
  }

  let current = items;
  const changedIds: string[] = [];
  const problems: string[] = [];
  for (const id of stackTopIds(items, settings)) {
    const item = current.find((i) => i.id === id)!;
    const def = findBoxType(item.type);
    if (!def) {
      problems.push(`${item.label} has an unknown type (${item.type}) and was left as it is.`);
      continue;
    }
    try {
      let next = applyEdit(item, def.flatTop?.(resolveItem(item, settings, current)));
      let all = replaced(current, next);
      const top = safeItemRect(next, settings, all).top;
      const by = height - top;
      if (by > EPS) {
        if (!def.raise) {
          problems.push(`${item.label} (${def.name}) cannot be raised; its top stays at ${fmt(top)}.`);
        } else {
          const headroom = height - effectiveTop(next, settings, all);
          next = applyEdit(next, def.raise(resolveItem(next, settings, all), by, { mode, headroom }));
          all = replaced(current, next);
          const reached = safeItemRect(next, settings, all).top;
          if (Math.abs(reached - height) > HEIGHT_TOL) {
            problems.push(`${item.label} reaches ${fmt(reached)} instead of ${fmt(height)}.`);
          }
        }
      }
      if (next !== item) {
        changedIds.push(id);
        current = all;
      }
    } catch (e) {
      problems.push(`${item.label} could not be changed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { items: changedIds.length ? current : items, changedIds, problems };
}
