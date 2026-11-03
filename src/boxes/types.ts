import type { ItemParams, ParamValue, ResolvedItem } from '../model/types';
import type { GeometryKernel, Solid } from '../geometry/types';

/** Describes one user‑editable parameter of a box type. The UI renders forms from these. */
export type ParamSpec =
  | {
      key: string;
      label: string;
      kind: 'number';
      default: number;
      min?: number;
      max?: number;
      step?: number;
      unit?: 'mm' | 'count';
      /** Optional grouping header in the inspector. */
      group?: string;
      /** Optional help text. */
      help?: string;
      /** Only show when this predicate on the current params is true. */
      visibleIf?: (params: ItemParams) => boolean;
    }
  | {
      key: string;
      label: string;
      kind: 'boolean';
      default: boolean;
      group?: string;
      help?: string;
      visibleIf?: (params: ItemParams) => boolean;
    }
  | {
      key: string;
      label: string;
      kind: 'select';
      default: string;
      options: { value: string; label: string }[];
      group?: string;
      help?: string;
      visibleIf?: (params: ItemParams) => boolean;
    };

/** Outer size of an item in its local (unrotated) frame. */
export interface Footprint {
  width: number;
  depth: number;
  height: number;
}

/**
 * 2D decoration drawn in the top view, in the item's local unrotated frame
 * (origin = outer top‑left corner, x right, y down, mm).
 */
export type TopViewFeature =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; role: 'cavity' | 'divider' | 'notch' | 'solid' }
  | { kind: 'text'; x: number; y: number; text: string };

/**
 * A top face of an item that other items may rest on or bump into, in the
 * item's local unrotated frame (same as `draw`: origin = outer corner, mm).
 * See `BoxTypeDefinition.bearingAreas` and DESIGN.md §4.3.
 */
export interface BearingArea {
  x: number;
  y: number;
  width: number;
  depth: number;
  /** Local Z of the face (0 = the item's lowest point). */
  height: number;
  /**
   * 'bearing' (default): carries an item resting at its height.
   * 'lip': a locating lip / ridge: carries a flat base resting on it, and
   *   must otherwise lie under the recess of the item above.
   * 'low': solid, but carries nothing (e.g. a divider lower than the walls).
   * Every role counts for the fit check (nothing may reach into a base).
   */
  role?: 'bearing' | 'lip' | 'low';
  /** What it is, for messages: "wall", "lip", "divider", "plate", "top", … */
  name?: string;
}

/**
 * A feature of an item's base, in its local unrotated frame. The item's
 * lowest point is Z = 0; its main base is at Z = the tallest protrusion
 * (0 without protrusions).
 */
export interface BaseFeature {
  /** 'recess': the base is cut up by `height` (above the main base). 'protrusion': sticks out `height` below the main base. */
  kind: 'recess' | 'protrusion';
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  /** For messages: "recess", "plug", "corner stop", … */
  name: string;
}

/** Space above an item's top that must stay free (e.g. standing cards), local unrotated frame. */
export interface KeepOut {
  x: number;
  y: number;
  width: number;
  depth: number;
  /** How far above the item's outer top the space reaches. */
  height: number;
  /** For messages, plural noun: "standing cards". */
  name: string;
  /** Optional advice for messages, completed with "of <item>": e.g. "lower the exposed height". */
  fix?: string;
}

export interface BoxTypeDefinition {
  /** Stable id stored in project files, e.g. "tray". */
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  /**
   * Outer dimensions, unrotated. Must be cheap and pure. May depend on
   * `item.context` (see `usesItemsAbove`), but width and depth must not.
   */
  footprint(item: ResolvedItem): Footprint;
  /**
   * Full 3D solid in the item local frame (floor on Z=0, corner at origin).
   * May depend on `item.context`.
   */
  build(item: ResolvedItem, kernel: GeometryKernel): Solid;
  /** Top view decorations in the item local frame. May depend on `item.context`. */
  draw(item: ResolvedItem): TopViewFeature[];
  /**
   * Opt‑in to a build context: when this returns true for the resolved item
   * (without context), `resolveItem(item, settings, items)` attaches
   * `context.itemsAbove` — the items resting on it — and footprint / build /
   * draw may use it. Consumers that build or key geometry must pass the
   * project's items. Leave undefined for self‑contained boxes.
   */
  usesItemsAbove?(item: ResolvedItem): boolean;
  /**
   * How far below this item's outer top lies the surface that items stacked
   * on it rest on (e.g. a platform's locating ridges stand above its plate).
   * Added to the engagement of anything resting on it. 0 / undefined = the
   * top is the resting surface.
   */
  seatDepth?(item: ResolvedItem): number;
  /**
   * Optional note for the inspector about which other items this item's
   * geometry is based on (its build context). null / undefined = nothing to show.
   */
  describeContext?(item: ResolvedItem): { itemIds: string[]; note: string } | null;
  /**
   * Optional human‑readable problems with the current parameters
   * (e.g. notch wider than wall). Empty array = fine.
   */
  validate?(item: ResolvedItem): string[];
  /**
   * How many mm of this item's base sink into `below`, the item it is stacked
   * on (lip recess, floor plug, corner stops). 0 / undefined for flat bases.
   * The item rests at z = top of `below` − engagement. The result may depend
   * on `below` (a recess only engages a lipped tray); without `below` it is
   * the nominal engagement against a matching partner. The layout always
   * passes `below`.
   */
  stackEngagement?(item: ResolvedItem, below?: ResolvedItem): number;
  /**
   * Top faces items stacked on this one can bear on (stack fit check). An
   * open tray returns its wall ring (with a lip: the lip ring at the top and
   * the inner wall half at the wall top), a divided tray adds its dividers.
   * Undefined = the whole footprint at the outer height − seatDepth (a solid
   * top). May depend on `item.context`.
   */
  bearingAreas?(item: ResolvedItem): BearingArea[];
  /** Recesses and protrusions (plug, corner stops) of the base. Undefined = flat base. */
  baseFeatures?(item: ResolvedItem): BaseFeature[];
  /** Space above the outer top that must stay free (upright cards). Undefined = none. */
  keepOut?(item: ResolvedItem): KeepOut[];
  /**
   * Optional parameter values for items newly created from the UI (palette
   * click / drop), merged over the ParamSpec defaults by `newItemParams`.
   * Only affects creation: loaded projects, the sample and duplicates resolve
   * missing keys against the ParamSpec defaults, so changing these never
   * alters existing geometry. Keys must exist in `params`.
   */
  newItemParams?: ItemParams;
}

/** Stack engagement of an item (on `below`, if given), never negative or NaN. */
export function engagementOf(def: BoxTypeDefinition | undefined, item: ResolvedItem, below?: ResolvedItem): number {
  if (!def?.stackEngagement) return 0;
  const e = def.stackEngagement(item, below);
  return Number.isFinite(e) && e > 0 ? e : 0;
}

/** Seat depth of an item (see `seatDepth`), never negative or NaN. */
export function seatDepthOf(def: BoxTypeDefinition | undefined, item: ResolvedItem): number {
  if (!def?.seatDepth) return 0;
  const d = def.seatDepth(item);
  return Number.isFinite(d) && d > 0 ? d : 0;
}

const finiteRect = (r: { x: number; y: number; width: number; depth: number; height: number }) =>
  [r.x, r.y, r.width, r.depth, r.height].every(Number.isFinite) && r.width > 0 && r.depth > 0;

/**
 * Bearing areas of an item (see `bearingAreas`), invalid entries dropped.
 * Types without the hook: the whole footprint `fp` at `fp.height − seatDepth`.
 */
export function bearingAreasOf(
  def: BoxTypeDefinition,
  item: ResolvedItem,
  fp: Footprint,
): BearingArea[] {
  if (!def.bearingAreas) {
    return [{ x: 0, y: 0, width: fp.width, depth: fp.depth, height: fp.height - seatDepthOf(def, item), name: 'top' }];
  }
  return def.bearingAreas(item).filter(finiteRect);
}

/** Base features of an item (see `baseFeatures`), invalid / empty entries dropped. */
export function baseFeaturesOf(def: BoxTypeDefinition, item: ResolvedItem): BaseFeature[] {
  return (def.baseFeatures?.(item) ?? []).filter((f) => finiteRect(f) && f.height > 0);
}

/** Keep‑out spaces of an item (see `keepOut`), invalid / empty entries dropped. */
export function keepOutOf(def: BoxTypeDefinition, item: ResolvedItem): KeepOut[] {
  return (def.keepOut?.(item) ?? []).filter((k) => finiteRect(k) && k.height > 0);
}

export function defaultParams(def: BoxTypeDefinition): ItemParams {
  const out: ItemParams = {};
  for (const p of def.params) out[p.key] = p.default as ParamValue;
  return out;
}

/** Parameters for a newly created item: ParamSpec defaults + `def.newItemParams`. */
export function newItemParams(def: BoxTypeDefinition): ItemParams {
  return { ...defaultParams(def), ...def.newItemParams };
}
