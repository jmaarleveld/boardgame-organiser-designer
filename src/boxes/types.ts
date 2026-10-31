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

export interface BoxTypeDefinition {
  /** Stable id stored in project files, e.g. "tray". */
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  /** Outer dimensions, unrotated. Must be cheap and pure. */
  footprint(item: ResolvedItem): Footprint;
  /** Full 3D solid in the item local frame (floor on Z=0, corner at origin). */
  build(item: ResolvedItem, kernel: GeometryKernel): Solid;
  /** Top view decorations in the item local frame. */
  draw(item: ResolvedItem): TopViewFeature[];
  /**
   * Optional human‑readable problems with the current parameters
   * (e.g. notch wider than wall). Empty array = fine.
   */
  validate?(item: ResolvedItem): string[];
}

export function defaultParams(def: BoxTypeDefinition): ItemParams {
  const out: ItemParams = {};
  for (const p of def.params) out[p.key] = p.default as ParamValue;
  return out;
}
