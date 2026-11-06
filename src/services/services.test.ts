import { describe, expect, it, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { parseXml } from './xml';
import { createBggClient, parseSearch, parseVersions } from './bgg';
import { createPersistence, migrateLegacyItem, validateProject } from './persistence';
import { registerAllBoxTypes } from '../boxes/index';
import { placedFootprint } from '../model/resolve';
import { createExporter } from './exporter';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { createEmptyProject, type PlacedItem, type Project } from '../model/types';
import type { GeometryKernel } from '../geometry/types';

const SEARCH = `<?xml version="1.0" encoding="utf-8"?><items total="2" termsofuse="x">
<item type="boardgame" id="13"><name type="primary" value="CATAN &amp; Co"/><yearpublished value="1995" /></item>
<item type="boardgame" id="5"><name type="alternate" value="Foo"/></item></items>`;
const THING = `<?xml version="1.0"?><items><item type="boardgame" id="13"><name type="primary" value="Catan"/>
<versions><item type="boardgameversion" id="1"><name type="primary" value="English"/><width value="11.5"/><length value="11.5"/><depth value="2.5"/></item>
<item type="boardgameversion" id="2"><name type="primary" value="German"/><width value="0"/><length value="10"/></item></versions></item></items>`;

describe('xml/bgg parsing', () => {
  it('parses attributes and entities', () => {
    const r = parseXml(SEARCH);
    expect(r.children[0].name).toBe('items');
    expect(r.children[0].children[0].children[0].attrs.value).toBe('CATAN & Co');
  });
  it('parses search', () => {
    expect(parseSearch(SEARCH)).toEqual([
      { id: 13, name: 'CATAN & Co', yearPublished: 1995 },
      { id: 5, name: 'Foo' },
    ]);
  });
  it('parses versions with inch to mm conversion', () => {
    const v = parseVersions(THING);
    expect(v[0]).toEqual({ versionId: 1, name: 'Catan - English', widthMm: 292.1, depthMm: 292.1, heightMm: 63.5 });
    expect(v[1].widthMm).toBeUndefined();
    expect(v[1].depthMm).toBe(254);
    expect(v[1].heightMm).toBeUndefined();
  });
  it('retries on 202 and errors on 429', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls < 3 ? new Response('', { status: 202 }) : new Response(SEARCH, { status: 200 });
    }) as typeof fetch;
    const c = createBggClient('/x', { fetchImpl, retryDelayMs: 1 });
    expect((await c.search('catan')).length).toBe(2);
    expect(calls).toBe(3);
    const c2 = createBggClient('/x', { fetchImpl: (async () => new Response('', { status: 429 })) as typeof fetch });
    await expect(c2.search('a')).rejects.toThrow(/rate limit/);
  });
});

class MemStorage implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

function item(id: string, over: Partial<PlacedItem> = {}): PlacedItem {
  return { id, type: 'fake', label: id, x: 0, y: 0, rotation: 0, params: { w: 10 }, ...over };
}

describe('persistence', () => {
  it('round-trips and validates', () => {
    const p = createPersistence(new MemStorage());
    const proj = createEmptyProject();
    proj.items.push(item('a', { type: 'unknown-type', wall: 2 }));
    expect(p.load()).toBeNull();
    p.save(proj);
    expect(p.load()).toEqual(proj);
    expect(p.toJson(proj)).toContain('\n  "version"');
    p.clear();
    expect(p.load()).toBeNull();
  });
  it('rejects bad input', () => {
    const p = createPersistence(new MemStorage());
    const good = createEmptyProject();
    const bad = (mut: (j: any) => void, re: RegExp) => {
      const j = JSON.parse(p.toJson(good));
      mut(j);
      expect(() => p.fromJson(JSON.stringify(j))).toThrow(re);
    };
    expect(() => p.fromJson('{nope')).toThrow(/not valid JSON/);
    bad((j) => (j.version = 2), /version/);
    bad((j) => (j.settings.box.width = -1), /settings\.box\.width/);
    bad((j) => (j.settings.defaults.wall = 0), /wall/);
    bad((j) => (j.items = {}), /items/);
    bad((j) => (j.items = [{ id: 'a', type: 't', label: 'l', x: 0, y: 0, rotation: 45, params: {} }]), /rotation/);
    bad((j) => (j.items = [{ id: 'a', type: 't', label: 'l', x: 0, y: 0, rotation: 0, params: [] }]), /params/);
    bad((j) => (j.items = [{ id: 'a', type: 't', label: 'l', x: 0, y: 0, z: -1, rotation: 0, params: {} }]), /items\[0\]\.z must not be negative/);
    bad((j) => (j.items = [{ id: 'a', type: 't', label: 'l', x: 0, y: 0, z: 'high', rotation: 0, params: {} }]), /items\[0\]\.z/);
  });
  it('accepts a missing or non-negative finite z', () => {
    const p = createPersistence(new MemStorage());
    const proj = createEmptyProject();
    proj.items.push(item('a'), item('b', { z: 0 }), item('c', { z: 31.2 }));
    const back = p.fromJson(p.toJson(proj));
    expect(back.items.map((i) => i.z)).toEqual([undefined, 0, 31.2]);
    expect('z' in back.items[0]).toBe(false);
    // Infinity serialises as null, which is rejected.
    expect(() => p.fromJson(p.toJson({ ...proj, items: [item('d', { z: Infinity })] }))).toThrow(/z/);
  });
  it('migrates the deleted v1 tray, divided-tray and card-tray on load, keeping the footprint', () => {
    clearRegistry();
    registerAllBoxTypes();
    const p = createPersistence(new MemStorage());
    const proj = createEmptyProject();
    const v1 = (id: string, type: string, params: PlacedItem['params'], extra: Partial<PlacedItem> = {}) =>
      ({ ...item(id, { type, ...extra }), params }) as PlacedItem;
    proj.items.push(
      v1('t', 'tray', { stackTop: 'lip', fingerNotch: true, notchSides: 'both', notchWidth: 18, notchDepth: 10 }),
      v1('tw', 'tray', { innerWidth: 50 }, { wall: 2 }),
      v1('d', 'divided-tray', { innerWidth: 60, innerDepth: 40, dividerHeight: 10, fingerNotch: true, stackBottom: 'recess' }),
      v1('dd', 'divided-tray', {}),
      v1('cf', 'card-tray', { notchWidth: 20, exposedHeight: 12 }),
      v1('cu', 'card-tray', { orientation: 'upright', exposedHeight: 15, cardWidth: 41, stackBottom: 'plug' }),
      v1('x', 'spacer', { width: 10 }),
    );
    const back = p.fromJson(p.toJson(proj));
    const byId = new Map(back.items.map((i) => [i.id, i]));
    expect(byId.get('t')).toMatchObject({ type: 'item-tray', x: 0, y: 0, label: 't' });
    expect(byId.get('t')!.params).toEqual({ stackTop: 'lip', innerWidth: 60, innerDepth: 40, innerHeight: 30, floorShape: 'flat' });
    expect(byId.get('tw')).toMatchObject({ type: 'item-tray', wall: 2, params: { innerWidth: 50, innerDepth: 40, innerHeight: 30 } });
    expect(byId.get('d')!.params).toEqual({
      innerWidth: 19.2, innerDepth: 19.4, innerHeight: 25, columns: 3, rows: 2, dividerThickness: 1.2,
      floorShape: 'flat', stackBottom: 'recess',
    });
    expect(byId.get('dd')!.params).toMatchObject({ innerWidth: 29.2, innerDepth: 29.4, columns: 3, rows: 2 });
    expect(byId.get('cf')).toMatchObject({ type: 'card-tray-flat', params: { gapFloorDepth: 0 } });
    expect(byId.get('cu')).toMatchObject({ type: 'card-tray-upright', params: { exposedHeight: 15, cardWidth: 41, stackBottom: 'plug' } });
    expect(byId.get('cu')!.params).not.toHaveProperty('orientation');
    expect(byId.get('x')).toEqual(proj.items[6]);
    // Outer footprints as the v1 types had them (default wall 1.6, floor 1.2).
    const fp = (id: string) => placedFootprint(byId.get(id)!, back.settings);
    const close = (id: string, w: number, d: number, h: number) => {
      const f = fp(id);
      expect([f.width, f.depth, f.height].map((v) => Math.round(v * 1e6) / 1e6), id).toEqual([w, d, h]);
    };
    close('t', 63.2, 43.2, 33.2);
    close('tw', 54, 44, 31.2);
    close('d', 63.2, 43.2, 26.2);
    close('dd', 93.2, 63.2, 26.2);
    close('cf', 68.7, 93.2, 31.2);
    close('cu', 34.2, 46.2, 76.2); // plug 2 + floor 1.2 + 88 − 15
    // Already migrated items are left alone.
    const again = back.items.map(migrateLegacyItem);
    again.forEach((i, n) => expect(i).toBe(back.items[n]));
  });

  it('migrates the earlier tilted card tray: rows → columns, dividerHeight dropped', () => {
    const tilted = (params: PlacedItem['params']): PlacedItem => ({ id: 'a', type: 'card-tray-tilted', label: 'a', x: 0, y: 0, rotation: 0, params });
    expect(migrateLegacyItem(tilted({ rows: 3, tiltAngle: 20, dividerHeight: 30 })).params).toEqual({ columns: 3, tiltAngle: 20 });
    expect(migrateLegacyItem(tilted({ rows: 1, columns: 2 })).params).toEqual({ columns: 2 });
    expect(migrateLegacyItem(tilted({ dividerHeight: 0, stackTop: 'lip' })).params).toEqual({ stackTop: 'lip' });
    const clean = tilted({ columns: 3, tiltAngle: 15 });
    expect(migrateLegacyItem(clean)).toBe(clean);
    // Other types keep their rows and dividerHeight.
    const upright: PlacedItem = { ...tilted({ dividerHeight: 30, rows: 2 }), type: 'card-tray-upright' };
    expect(migrateLegacyItem(upright)).toBe(upright);
    // Through validateProject (the load path) too.
    const proj = { version: 1, settings: createEmptyProject().settings, items: [tilted({ rows: 2, dividerHeight: 20 })] };
    expect(validateProject(proj).items[0].params).toEqual({ columns: 2 });
  });
});

describe('exporter', () => {
  let stlCalls = 0;
  const kernel = {
    toSTL: () => { const b = new ArrayBuffer(8); new DataView(b).setUint32(0, ++stlCalls); return b; },
    box: () => ({ __brand: 'Solid' }),
    toMesh: () => ({ positions: new Float32Array(3), indices: new Uint32Array(0) }),
  } as unknown as GeometryKernel;
  const exporter = createExporter(async () => kernel);

  beforeEach(() => {
    stlCalls = 0;
    clearRegistry();
    registerBoxType({
      id: 'fake', name: 'Fake', description: '', params: [{ key: 'w', label: 'W', kind: 'number', default: 10 }],
      footprint: (r) => ({ width: Number(r.params.w) + 2 * r.wall, depth: 20, height: 5 }),
      build: (_r, k) => k.box(1, 1, 1),
      draw: () => [],
    });
  });

  function proj(): Project {
    const p = createEmptyProject();
    p.settings.name = 'My Game';
    p.items = [
      item('a', { label: 'Cards / Tray', x: 5 }),
      item('b', { label: 'Other', params: { w: 30 } }),
      item('c', { label: 'Cards 2', x: 50, rotation: 90, params: {} }), // same as a after defaults
    ];
    return p;
  }

  it('exportItem names file from label', async () => {
    const e = await exporter.exportItem(proj(), 'a');
    expect(e.fileName).toBe('Cards_Tray.stl');
    expect(e.count).toBe(1);
    expect(e.itemIds).toEqual(['a']);
    expect(e.scad).toContain('cube([1, 1, 1]);');
    expect(e.scad).toContain('w = 10');
  });

  it('exportAll dedupes, names, reports progress and writes manifest', async () => {
    const prog: number[] = [];
    const blob = await exporter.exportAll(proj(), (p) => prog.push(p.done));
    expect(stlCalls).toBe(2);
    expect(prog[0]).toBe(0);
    expect(prog[prog.length - 1]).toBe(2);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['01_Cards_Tray_x2.scad', '01_Cards_Tray_x2.stl', '02_Other_x1.scad', '02_Other_x1.stl', 'manifest.txt']);
    const m = await zip.file('manifest.txt')!.async('string');
    expect(m).toContain('Project: My Game');
    expect(m).toContain('Tolerance: x 2 mm, y 2 mm');
    expect(m).toContain('01_Cards_Tray_x2.stl: count 2; items a, c'.replace('a, c', 'Cards / Tray, Cards 2'));
    expect(m).toContain('outer 13.2 x 20 x 5 mm');
  });

  it('previewMesh uses kernel.toMesh', async () => {
    const m = await exporter.previewMesh(proj(), 'a');
    expect(m.positions.length).toBe(3);
  });
});
