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
    if (it.wall !== undefined) out.wall = num(it.wall, `${p}.wall`, { positive: true });
    if (it.floor !== undefined) out.floor = num(it.floor, `${p}.floor`, { positive: true });
    return out;
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
