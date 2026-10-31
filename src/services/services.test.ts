import { describe, expect, it, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { parseXml } from './xml';
import { createBggClient, parseSearch, parseVersions } from './bgg';
import { createPersistence } from './persistence';
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
