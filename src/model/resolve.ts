import type { BuildContext, ItemAbove, PlacedItem, ProjectSettings, ResolvedItem } from './types';
import { findBoxType, getBoxType } from '../boxes/registry';
import { defaultParams } from '../boxes/types';

/** Tolerance (mm) for "this item rests on that one" (top of supporter = bottom + engagement). */
export const SUPPORT_TOL = 0.01;
/** Strict‑overlap tolerance (touching edges do not overlap). */
const OVERLAP_EPS = 1e-6;

/** item.z with undefined / invalid → 0. */
export function elevationOf(item: PlacedItem): number {
  const z = item.z;
  return typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 0;
}

/** Defaults applied, no build context. */
function resolveBase(item: PlacedItem, settings: ProjectSettings): ResolvedItem {
  const def = getBoxType(item.type);
  return {
    id: item.id,
    type: item.type,
    label: item.label,
    wall: item.wall ?? settings.defaults.wall,
    floor: item.floor ?? settings.defaults.floor,
    params: { ...defaultParams(def), ...item.params },
  };
}

/**
 * Apply project defaults and parameter defaults to a placed item.
 *
 * Pass the project's `items` wherever the result feeds geometry (footprint,
 * build, draw, keys): for types whose `usesItemsAbove(item)` is true the
 * result then carries `context` (see `buildContext`). Without `items` the
 * context is left out (e.g. a platform without its locating ridges).
 */
export function resolveItem(item: PlacedItem, settings: ProjectSettings, items?: readonly PlacedItem[]): ResolvedItem {
  const resolved = resolveBase(item, settings);
  if (items) {
    const context = buildContext(item, resolved, items, settings);
    if (context) resolved.context = context;
  }
  return resolved;
}

function rotated(fp: { width: number; depth: number; height: number }, rotation: PlacedItem['rotation']) {
  return rotation === 90 ? { width: fp.depth, depth: fp.width, height: fp.height } : fp;
}

/**
 * The build context of `item` (already resolved without context), or
 * undefined when its type does not use one. Items above are the items that
 * overlap it in XY (strictly) with their base at its context‑free top
 * (z + footprint height without context, within SUPPORT_TOL); their
 * context‑free footprints are mapped into `item`'s local frame. Never
 * depends on another item's context, so there are no cycles.
 */
export function buildContext(
  item: PlacedItem,
  resolved: ResolvedItem,
  items: readonly PlacedItem[],
  settings: ProjectSettings,
): BuildContext | undefined {
  const def = getBoxType(item.type);
  if (!def.usesItemsAbove?.(resolved)) return undefined;
  const own = rotated(def.footprint(resolved), item.rotation);
  const top = elevationOf(item) + own.height;
  const localDepth = item.rotation === 90 ? own.width : own.depth;
  const itemsAbove: ItemAbove[] = [];
  for (const o of items) {
    if (o.id === item.id) continue;
    const odef = findBoxType(o.type);
    if (!odef) continue;
    let ro: ResolvedItem;
    let fp: { width: number; depth: number; height: number };
    try {
      ro = resolveBase(o, settings);
      fp = rotated(odef.footprint(ro), o.rotation);
    } catch {
      continue;
    }
    if (![fp.width, fp.depth].every((v) => Number.isFinite(v) && v > 0)) continue;
    if (Math.abs(elevationOf(o) - top) > SUPPORT_TOL) continue;
    const overlaps =
      o.x < item.x + own.width - OVERLAP_EPS &&
      item.x < o.x + fp.width - OVERLAP_EPS &&
      o.y < item.y + own.depth - OVERLAP_EPS &&
      item.y < o.y + fp.depth - OVERLAP_EPS;
    if (!overlaps) continue;
    // Game box frame → item local frame. Rotation 90 maps local (u, v) to
    // (x + d − v, y + u) (see placementMatrix), so u = Y − y, v = x + d − X.
    const rect =
      item.rotation === 90
        ? { x: o.y - item.y, y: item.x + localDepth - (o.x + fp.width), width: fp.depth, depth: fp.width }
        : { x: o.x - item.x, y: o.y - item.y, width: fp.width, depth: fp.depth };
    const lip = ro.params.lipHeight;
    itemsAbove.push({
      id: o.id,
      ...rect,
      wall: ro.wall,
      stackBottom: typeof ro.params.stackBottom === 'string' ? ro.params.stackBottom : 'none',
      lipHeight: typeof lip === 'number' && Number.isFinite(lip) ? lip : 0,
    });
  }
  itemsAbove.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { itemsAbove };
}

/**
 * Map a rectangle from an item's local unrotated frame (as used by `draw`,
 * `bearingAreas`, `baseFeatures`, `keepOut`) to the game box frame. `localDepth`
 * is the item's unrotated footprint depth. Rotation 90 maps local (u, v) to
 * (x + localDepth − v, y + u) (see placementMatrix; inverse in buildContext).
 * Extra fields of `r` are kept.
 */
export function localToBoxRect<R extends { x: number; y: number; width: number; depth: number }>(
  item: Pick<PlacedItem, 'x' | 'y' | 'rotation'>,
  localDepth: number,
  r: R,
): R {
  if (item.rotation === 90) {
    return { ...r, x: item.x + localDepth - (r.y + r.depth), y: item.y + r.x, width: r.depth, depth: r.width };
  }
  return { ...r, x: item.x + r.x, y: item.y + r.y };
}

/**
 * Rotated outer footprint of a placed item, in the game box frame. Pass the
 * project's `items` so context‑dependent heights (platform ridges) count.
 */
export function placedFootprint(item: PlacedItem, settings: ProjectSettings, items?: readonly PlacedItem[]) {
  const def = getBoxType(item.type);
  return rotated(def.footprint(resolveItem(item, settings, items)), item.rotation);
}
