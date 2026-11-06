/**
 * Core data model. All lengths in millimetres. See DESIGN.md §2–3.
 */

export interface BoxDimensions {
  /** Inner width of the game box (X, left→right in the top view). */
  width: number;
  /** Inner depth of the game box (Y, top→bottom in the top view). */
  depth: number;
  /** Inner height of the game box (Z, up). */
  height: number;
}

export interface Tolerance {
  /** Total slack that must remain along X after tiling. */
  x: number;
  /** Total slack that must remain along Y after tiling. */
  y: number;
}

export interface ThicknessDefaults {
  /** Project‑wide default wall thickness. */
  wall: number;
  /** Project‑wide default floor thickness. */
  floor: number;
}

export interface ProjectSettings {
  name: string;
  box: BoxDimensions;
  tolerance: Tolerance;
  defaults: ThicknessDefaults;
  /** Snapping increment in the top view. 0 disables grid snapping. */
  gridSnap: number;
}

export type ParamValue = number | boolean | string;
export type ItemParams = Record<string, ParamValue>;

export type Rotation = 0 | 90;

export interface PlacedItem {
  id: string;
  /** Box type id, see src/boxes/registry.ts */
  type: string;
  label: string;
  /** Top‑left corner of the outer footprint, in the game box frame. */
  x: number;
  y: number;
  rotation: Rotation;
  /**
   * Bottom elevation above the game box floor (mm). undefined ⇒ 0. Derived,
   * never user-entered: a cache of gravity (`settle` in src/model/layout.ts),
   * which puts every item on the highest surface of the *earlier* items in
   * `Project.items` it overlaps (the array order is the stack order). The
   * store re-settles after every change; old files are migrated on load by
   * sorting on the stored z.
   */
  z?: number;
  /** Per‑item wall thickness override; undefined → settings.defaults.wall */
  wall?: number;
  /** Per‑item floor thickness override; undefined → settings.defaults.floor */
  floor?: number;
  /** Type‑specific parameters. Missing keys fall back to ParamSpec.default. */
  params: ItemParams;
}

export interface Project {
  version: 1;
  settings: ProjectSettings;
  items: PlacedItem[];
}

/**
 * An item resting on another one (its base at the other's context‑free top),
 * described in the lower item's local frame (unrotated, origin = outer
 * top‑left corner, mm). Rotation of both items is already applied.
 */
export interface ItemAbove {
  id: string;
  /** Outer footprint rectangle in the lower item's local frame. */
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Resolved wall thickness of the item above. */
  wall: number;
  /** Its `stackBottom` param ('none' when absent). */
  stackBottom: string;
  /** Its `lipHeight` param (0 when absent). */
  lipHeight: number;
}

/**
 * Build context: what a box needs to know about the rest of the project.
 * Computed in one place (`resolveItem(item, settings, items)` →
 * `buildContext`), only for types whose `usesItemsAbove(item)` is true.
 */
export interface BuildContext {
  /** Items resting on this one, sorted by id. */
  itemsAbove: ItemAbove[];
}

/** An item with every default applied; what box definitions consume. */
export interface ResolvedItem {
  id: string;
  type: string;
  label: string;
  wall: number;
  floor: number;
  params: ItemParams;
  /**
   * Present only when the type asks for it (`usesItemsAbove`) and the caller
   * passed the project's items to `resolveItem`. Geometry (footprint, build,
   * draw) may depend on it, so it is part of the exporter's `geometryKey`.
   */
  context?: BuildContext;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  name: 'Untitled insert',
  box: { width: 290, depth: 290, height: 70 },
  tolerance: { x: 2, y: 2 },
  defaults: { wall: 1.6, floor: 1.2 },
  gridSnap: 1,
};

export function createEmptyProject(): Project {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    items: [],
  };
}
