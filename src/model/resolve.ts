import type { PlacedItem, ProjectSettings, ResolvedItem } from './types';
import { getBoxType } from '../boxes/registry';
import { defaultParams } from '../boxes/types';

/** Apply project defaults and parameter defaults to a placed item. */
export function resolveItem(item: PlacedItem, settings: ProjectSettings): ResolvedItem {
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

/** Rotated outer footprint of a placed item, in the game box frame. */
export function placedFootprint(item: PlacedItem, settings: ProjectSettings) {
  const def = getBoxType(item.type);
  const fp = def.footprint(resolveItem(item, settings));
  return item.rotation === 90
    ? { width: fp.depth, depth: fp.width, height: fp.height }
    : fp;
}
