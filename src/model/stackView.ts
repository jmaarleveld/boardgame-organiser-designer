/**
 * Display helpers for reaching items hidden inside stacks in the 3D editor:
 * which items fade out above the selection, and the exploded‑view offsets.
 * Pure: they take settled items (store items always are) and never move
 * anything in the model.
 */
import type { PlacedItem, ProjectSettings } from './types';
import { EPS, rectsOverlap, safeItemRect, supportersById } from './layout';

/**
 * Ids of the items that fade (translucent, not pickable) while `selectedId`
 * is selected: every item whose footprint overlaps the selected item's
 * footprint and whose bottom is higher than the selected item's bottom —
 * i.e. the column of items stacked on and above it (including a lid that
 * sinks into its lip, which rests slightly below its top). Items of other
 * stacks stay solid so they remain visible as context and clickable.
 * Empty when nothing (or an unknown id) is selected.
 */
export function fadedItemIds(
  items: readonly PlacedItem[],
  settings: ProjectSettings,
  selectedId: string | null,
): Set<string> {
  const out = new Set<string>();
  const sel = selectedId ? items.find((i) => i.id === selectedId) : undefined;
  if (!sel) return out;
  const s = safeItemRect(sel, settings, items);
  for (const item of items) {
    if (item.id === sel.id) continue;
    const r = safeItemRect(item, settings, items);
    if (r.z > s.z + EPS && rectsOverlap(r, s)) out.add(item.id);
  }
  return out;
}

/**
 * Stack level of every item for the exploded view: 0 on the floor, else one
 * more than the highest level among the items it rests on — so a bridge over
 * two stacks of different height sits above both exploded supporters.
 */
export function stackLevels(items: PlacedItem[], settings: ProjectSettings): Map<string, number> {
  const sup = supportersById(items, settings);
  const out = new Map<string, number>();
  // Supporters always come earlier in the array, so one pass suffices.
  for (const item of items) {
    const below = sup.get(item.id) ?? [];
    out.set(item.id, below.length ? 1 + Math.max(...below.map((id) => out.get(id) ?? 0)) : 0);
  }
  return out;
}

/** Default vertical gap (mm) added per stack level in the exploded view. */
export const EXPLODE_GAP = 15;

/** Exploded gap scaled to the layout: 30 % of the tallest item, at least EXPLODE_GAP. */
export function explodeGap(items: PlacedItem[], settings: ProjectSettings): number {
  let tallest = 0;
  for (const item of items) {
    const r = safeItemRect(item, settings, items);
    tallest = Math.max(tallest, r.top - r.z);
  }
  return Math.max(EXPLODE_GAP, Math.round(tallest * 0.3));
}

/** True when at least one item rests on another (the exploded view changes something). */
export function hasStacks(items: PlacedItem[], settings: ProjectSettings): boolean {
  const sup = supportersById(items, settings);
  return items.some((i) => (sup.get(i.id) ?? []).length > 0);
}

/** Display‑only z offset per item: level × gap (all 0 when `gap` is 0). */
export function explodeOffsets(items: PlacedItem[], settings: ProjectSettings, gap = EXPLODE_GAP): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, level] of stackLevels(items, settings)) out.set(id, level * gap);
  return out;
}
