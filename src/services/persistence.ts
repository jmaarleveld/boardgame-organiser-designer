import type { Persistence } from './contracts';
import type { PlacedItem, Project } from '../model/types';

function fail(path: string, msg: string): never {
  throw new Error(`Invalid project file: ${path} ${msg}`);
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function obj(v: unknown, path: string): Record<string, unknown> {
  if (!isObj(v)) fail(path, 'must be an object');
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'must be a string');
  return v;
}
function num(v: unknown, path: string, opts: { positive?: boolean; nonNegative?: boolean } = {}): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'must be a finite number');
  if (opts.positive && v <= 0) fail(path, 'must be greater than 0');
  if (opts.nonNegative && v < 0) fail(path, 'must not be negative');
  return v;
}

type Params = PlacedItem['params'];

/** Parameter defaults of the deleted v1 types (an omitted param resolved to these). */
const V1_TRAY_DEFAULTS = { innerWidth: 60, innerDepth: 40, innerHeight: 30 };
const V1_DIVIDED_DEFAULTS = { innerWidth: 90, innerDepth: 60, innerHeight: 25, columns: 3, rows: 2, dividerThickness: 1.2 };
/** Defaults of the tilted tray before the front wall height became a percentage (frontHeight in mm). */
const V1_TILTED_DEFAULTS = { cardHeight: 88, exposedHeight: 20, tiltAngle: 15, frontHeight: 20, frontHeightPct: 50 };
/** v1 params with no v2 equivalent (finger notches, card tray orientation): dropped. */
const V1_DROPPED = ['fingerNotch', 'notchSides', 'notchWidth', 'notchDepth', 'orientation'];

function numParam(params: Params, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function without(params: Params, keys: readonly string[]): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) if (!keys.includes(k)) out[k] = v;
  return out;
}

/** Strip floating-point noise from a derived size (sub-nanometre). */
function clean(v: number): number {
  return Math.round(v * 1e9) / 1e9;
}

/**
 * Load-time migration of the v1 box types, deleted 2026-11-06, to the
 * containers v2 set (docs-containers.md). The outer footprint, the stacking
 * params and the wall / floor overrides stay the same; finger notches have no
 * equivalent and are dropped.
 *
 * - `tray` → `item-tray` 1 × 1, same inner size, flat floor.
 * - `divided-tray` (inner W × D, c columns, r rows, dividers t) → `item-tray`
 *   c × r with per-cell innerWidth (W − (c−1)·t)/c and innerDepth (D − (r−1)·t)/r;
 *   `dividerHeight` is dropped (item tray dividers are always full height).
 * - `card-tray` → `card-tray-flat` or `card-tray-upright` by its orientation
 *   (card params, clearance, stack height and, upright, exposed height carry
 *   over; gaps and wedges get their defaults, except that a flat tray gets
 *   gapFloorDepth 0: a groove would raise the floor and the outer height).
 * - `card-tray-tilted` of the earlier Y-repeat version (2026-11-06): `rows`
 *   becomes `columns` (the slots now step along X) and `dividerHeight` is
 *   dropped (the tilted dividers are always full height). And (2026-11-06)
 *   `frontHeight` (mm above the floor) becomes `frontHeightPct`
 *   = round(100 · frontHeight / H, 1 decimal), clamped to [0, 100], with
 *   H = (cardHeight − exposedHeight)·cos(tiltAngle) from the item's own params
 *   (defaults 88, 20, 15° for missing keys). See `migrateTiltedTray`.
 * - `card-tray-upright` with the earlier wedge params (2026-11-06): `wedges`
 *   and the `wedgeWalls` select become the two toggles `wedgeEnds` /
 *   `wedgeLong`. See `migrateUprightTray`.
 *
 * Every other item is returned unchanged.
 */
export function migrateLegacyItem(item: PlacedItem): PlacedItem {
  const params = item.params;
  switch (item.type) {
    case 'tray':
      return {
        ...item,
        type: 'item-tray',
        params: {
          ...without(params, V1_DROPPED),
          innerWidth: numParam(params, 'innerWidth', V1_TRAY_DEFAULTS.innerWidth),
          innerDepth: numParam(params, 'innerDepth', V1_TRAY_DEFAULTS.innerDepth),
          innerHeight: numParam(params, 'innerHeight', V1_TRAY_DEFAULTS.innerHeight),
          floorShape: 'flat',
        },
      };
    case 'divided-tray': {
      const d = V1_DIVIDED_DEFAULTS;
      const w = numParam(params, 'innerWidth', d.innerWidth);
      const dp = numParam(params, 'innerDepth', d.innerDepth);
      const cols = Math.max(1, Math.round(numParam(params, 'columns', d.columns)));
      const rows = Math.max(1, Math.round(numParam(params, 'rows', d.rows)));
      const t = numParam(params, 'dividerThickness', d.dividerThickness);
      return {
        ...item,
        type: 'item-tray',
        params: {
          ...without(params, [...V1_DROPPED, 'dividerHeight']),
          innerWidth: clean((w - (cols - 1) * t) / cols),
          innerDepth: clean((dp - (rows - 1) * t) / rows),
          innerHeight: numParam(params, 'innerHeight', d.innerHeight),
          columns: cols,
          rows,
          dividerThickness: t,
          floorShape: 'flat',
        },
      };
    }
    case 'card-tray': {
      const upright = params.orientation === 'upright';
      return {
        ...item,
        type: upright ? 'card-tray-upright' : 'card-tray-flat',
        // Flat: no floor groove, so the floor is not raised and the footprint stays the same.
        params: upright ? without(params, V1_DROPPED) : { ...without(params, [...V1_DROPPED, 'exposedHeight']), gapFloorDepth: 0 },
      };
    }
    case 'card-tray-tilted':
      return migrateTiltedTray(item);
    case 'card-tray-upright':
      return migrateUprightTray(item);
    default:
      return item;
  }
}

/**
 * A tilted tray saved by the version that repeated the slots along Y: `rows`
 * (≥ 2) becomes `columns`; `rows` and `dividerHeight` are dropped. Returns the
 * item itself when there is nothing to migrate.
 */
function migrateTiltedTray(item: PlacedItem): PlacedItem {
  const params = item.params;
  if (!('rows' in params) && !('dividerHeight' in params) && !('frontHeight' in params)) return item;
  const out = without(params, ['rows', 'dividerHeight', 'frontHeight']);
  if ('rows' in params) {
    const rows = Math.round(numParam(params, 'rows', 1));
    if (rows >= 2) out.columns = rows;
  }
  if ('frontHeight' in params) {
    const d = V1_TILTED_DEFAULTS;
    const cardHeight = numParam(params, 'cardHeight', d.cardHeight);
    const exposed = numParam(params, 'exposedHeight', d.exposedHeight);
    const tilt = numParam(params, 'tiltAngle', d.tiltAngle);
    const H = (cardHeight - exposed) * Math.cos((tilt * Math.PI) / 180);
    const mm = numParam(params, 'frontHeight', d.frontHeight);
    const pct = H > 0 ? Math.round((1000 * mm) / H) / 10 : d.frontHeightPct;
    out.frontHeightPct = Math.min(100, Math.max(0, pct));
  }
  return { ...item, params: out };
}

/**
 * An upright tray saved with `wedges` (boolean) and `wedgeWalls`
 * ('ends' | 'long' | 'both'): `wedges: false` turns both toggles off,
 * otherwise `wedgeWalls` maps to `wedgeEnds` / `wedgeLong` (ends → ends only,
 * long → long only, both → both; absent → the defaults, ends only). The old
 * keys are dropped. Returns the item itself when there is nothing to migrate.
 */
function migrateUprightTray(item: PlacedItem): PlacedItem {
  const params = item.params;
  if (!('wedges' in params) && !('wedgeWalls' in params)) return item;
  const out = without(params, ['wedges', 'wedgeWalls']);
  const walls = params.wedgeWalls;
  if (params.wedges === false || params.wedges === 'false') {
    out.wedgeEnds = false;
    out.wedgeLong = false;
  } else if (walls === 'ends' || walls === 'long' || walls === 'both') {
    out.wedgeEnds = walls !== 'long';
    out.wedgeLong = walls !== 'ends';
  }
  return { ...item, params: out };
}

export function validateProject(data: unknown): Project {
  const root = obj(data, 'root');
  if (root.version !== 1) fail('version', `must be 1 (got ${JSON.stringify(root.version)})`);
  const s = obj(root.settings, 'settings');
  const box = obj(s.box, 'settings.box');
  const tol = obj(s.tolerance, 'settings.tolerance');
  const def = obj(s.defaults, 'settings.defaults');
  const settings = {
    name: str(s.name, 'settings.name'),
    box: {
      width: num(box.width, 'settings.box.width', { positive: true }),
      depth: num(box.depth, 'settings.box.depth', { positive: true }),
      height: num(box.height, 'settings.box.height', { positive: true }),
    },
    tolerance: {
      x: num(tol.x, 'settings.tolerance.x', { nonNegative: true }),
      y: num(tol.y, 'settings.tolerance.y', { nonNegative: true }),
    },
    defaults: {
      wall: num(def.wall, 'settings.defaults.wall', { positive: true }),
      floor: num(def.floor, 'settings.defaults.floor', { positive: true }),
    },
    gridSnap: num(s.gridSnap, 'settings.gridSnap', { nonNegative: true }),
  };
  if (!Array.isArray(root.items)) fail('items', 'must be an array');
  const ids = new Set<string>();
  const items = root.items.map((raw: unknown, i: number): PlacedItem => {
    const p = `items[${i}]`;
    const it = obj(raw, p);
    const id = str(it.id, `${p}.id`);
    if (ids.has(id)) fail(`${p}.id`, `"${id}" is duplicated`);
    ids.add(id);
    if (it.rotation !== 0 && it.rotation !== 90) fail(`${p}.rotation`, 'must be 0 or 90');
    const params = obj(it.params, `${p}.params`);
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'boolean' && typeof v !== 'string') {
        fail(`${p}.params.${k}`, 'must be a finite number, boolean or string');
      }
    }
    const out: PlacedItem = {
      id,
      type: str(it.type, `${p}.type`),
      label: str(it.label, `${p}.label`),
      x: num(it.x, `${p}.x`),
      y: num(it.y, `${p}.y`),
      rotation: it.rotation,
      params: params as PlacedItem['params'],
    };
    if (it.z !== undefined) out.z = num(it.z, `${p}.z`, { nonNegative: true });
    if (it.wall !== undefined) out.wall = num(it.wall, `${p}.wall`, { positive: true });
    if (it.floor !== undefined) out.floor = num(it.floor, `${p}.floor`, { positive: true });
    return migrateLegacyItem(out);
  });
  return { version: 1, settings, items };
}

export function createPersistence(storage: Storage = localStorage, key = 'bgid:project'): Persistence {
  const api: Persistence = {
    save(project) {
      try {
        storage.setItem(key, api.toJson(project));
      } catch {
        /* quota or privacy mode: autosave is best effort */
      }
    },
    load() {
      let text: string | null;
      try {
        text = storage.getItem(key);
      } catch {
        return null;
      }
      if (text == null) return null;
      try {
        return api.fromJson(text);
      } catch {
        return null;
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    toJson: (project) => JSON.stringify(project, null, 2),
    fromJson(text) {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid project file: not valid JSON (${(e as Error).message})`);
      }
      return validateProject(data);
    },
  };
  return api;
}
