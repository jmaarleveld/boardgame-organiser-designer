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

/** An item with every default applied; what box definitions consume. */
export interface ResolvedItem {
  id: string;
  type: string;
  label: string;
  wall: number;
  floor: number;
  params: ItemParams;
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
