import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../geometry/kernel';
import type { GeometryKernel } from '../../geometry/types';
import type { ResolvedItem } from '../../model/types';
import { EPS, stacking } from './common';
import {
  cellFrames,
  dividerRects,
  tiledBaseFeatures,
  tiledBearingAreas,
  tiledBuild,
  tiledDraw,
  tiledFootprint,
  tiledLayout,
  tiledValidate,
  tilingOf,
  tilingParams,
  type TiledBoxSpec,
} from './tiling';

let k: GeometryKernel;
beforeAll(async () => {
  k = await createKernel();
});

const noStack = stacking({ id: 'x', type: 't', label: 't', wall: 2, floor: 1, params: {} } as ResolvedItem);
const lipRecess = stacking({ id: 'x', type: 't', label: 't', wall: 2, floor: 1, params: { stackTop: 'lip', stackBottom: 'recess' } } as ResolvedItem);

function spec(over: Partial<TiledBoxSpec> = {}): TiledBoxSpec {
  return {
    cols: 3,
    rows: 2,
    cell: { width: 20, depth: 10, height: 15 },
    wall: 2,
    floor: 1,
    divider: 1,
    stacking: noStack,
    cellCutters: (kernel, f) => [kernel.box(f.width, f.depth, f.height + f.lipH + EPS, [f.x, f.y, f.floorZ])],
    cellDraw: (f) => [{ kind: 'rect', role: 'cavity', x: f.x, y: f.y, w: f.width, h: f.depth }],
    ...over,
  };
}

describe('tiling layout', () => {
  it('outer size = 2·wall + (n − 1)·pitch + cell', () => {
    expect(tiledFootprint(spec())).toEqual({ width: 4 + 2 * 21 + 20, depth: 4 + 11 + 10, height: 16 });
    expect(tiledFootprint(spec({ cols: 1, rows: 1 }))).toEqual({ width: 24, depth: 14, height: 16 });
    const pitched = spec({ cell: { width: 20, depth: 10, height: 15, pitchX: 25, pitchY: 12 } });
    expect(tiledFootprint(pitched)).toMatchObject({ width: 4 + 50 + 20, depth: 4 + 12 + 10 });
    expect(tiledFootprint(spec({ stacking: lipRecess })).height).toBeCloseTo(1 + 15 + 2, 9);
  });

  it('frames: row-major, pitch, Z levels', () => {
    const fs = cellFrames(spec());
    expect(fs).toHaveLength(6);
    expect(fs.map((f) => [f.col, f.row])).toEqual([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]);
    expect(fs[1]).toMatchObject({ x: 2 + 21, y: 2, width: 20, depth: 10, height: 15, floorZ: 1, topZ: 16, lipH: 0, dividerTopZ: 16 });
    expect(fs[5]).toMatchObject({ x: 2 + 42, y: 2 + 11 });
    const lip = cellFrames(spec({ stacking: lipRecess }))[0];
    expect(lip.lipH).toBe(2);
  });

  it('sides / outer flags for edge and interior cells', () => {
    const fs = cellFrames(spec({ rows: 3 }));
    const corner = fs[0];
    expect(corner.outer).toEqual({ left: true, right: false, front: true, back: false });
    expect(corner.sides).toEqual({ left: 2, right: 1, front: 2, back: 1 });
    const middle = fs[4]; // col 1, row 1
    expect(middle.outer).toEqual({ left: false, right: false, front: false, back: false });
    expect(middle.sides).toEqual({ left: 1, right: 1, front: 1, back: 1 });
    const last = fs[8];
    expect(last.outer).toEqual({ left: false, right: true, front: false, back: true });
    const single = cellFrames(spec({ cols: 1, rows: 1 }))[0];
    expect(single.outer).toEqual({ left: true, right: true, front: true, back: true });
    // An explicit pitch sets the material between cells.
    const p = cellFrames(spec({ cell: { width: 20, depth: 10, height: 15, pitchX: 24 } }))[1];
    expect(p.sides).toMatchObject({ left: 4, right: 4 });
  });

  it('counts are rounded to whole numbers ≥ 1', () => {
    expect(tiledLayout(spec({ cols: 2.4, rows: 0 }))).toMatchObject({ cols: 2, rows: 1 });
    expect(cellFrames(spec({ cols: NaN, rows: -3 }))).toHaveLength(1);
  });
});

describe('tiling dividers', () => {
  it('divider rects between the cells, spanning the inner size', () => {
    const ds = dividerRects(spec());
    expect(ds).toHaveLength(3);
    expect(ds[0]).toEqual({ axis: 'y', x: 22, y: 2, width: 1, depth: 21 });
    expect(ds[1]).toEqual({ axis: 'y', x: 43, y: 2, width: 1, depth: 21 });
    expect(ds[2]).toEqual({ axis: 'x', x: 2, y: 12, width: 62, depth: 1 });
    expect(dividerRects(spec({ straightDividers: false }))).toEqual([]);
    const draw = tiledDraw(spec());
    expect(draw.filter((f) => f.kind === 'rect' && f.role === 'cavity')).toHaveLength(6);
    expect(draw.filter((f) => f.kind === 'rect' && f.role === 'divider')).toHaveLength(3);
  });

  it('builds outer − cells; full-height dividers bear, lowered ones are low', () => {
    const s = spec();
    const fp = tiledFootprint(s);
    const solid = tiledBuild(k, s);
    expect(k.isValid(solid)).toBe(true);
    expect(k.volume(solid)).toBeCloseTo(fp.width * fp.depth * fp.height - 6 * 20 * 10 * 15, 3);
    const div = tiledBearingAreas(s).filter((a) => a.name === 'divider');
    expect(div).toHaveLength(3);
    for (const d of div) expect(d).toMatchObject({ height: 16, role: 'bearing' });
    const low = tiledBearingAreas(spec({ dividerHeight: 5 })).filter((a) => a.name === 'divider');
    for (const d of low) expect(d).toMatchObject({ height: 6, role: 'low' });
  });

  it('dividerHeight cuts only the strip above the dividers', () => {
    const full = k.volume(tiledBuild(k, spec()));
    const s = spec({ dividerHeight: 5 });
    const solid = tiledBuild(k, s);
    expect(k.isValid(solid)).toBe(true);
    const fp = tiledFootprint(s);
    const b = k.bounds(solid);
    expect(b.max[2]).toBeCloseTo(fp.height, 9); // outer walls keep their height
    // Removed: 2 column dividers (1 × 21 × 10) + the row divider (62 × 1 × 10) − 2 crossings counted twice (1 × 1 × 10).
    const removed = 2 * 21 * 10 + 62 * 10 - 2 * 10;
    expect(full - k.volume(solid)).toBeCloseTo(removed, 3);
    // Not lowered at 0 or ≥ the cell height.
    expect(k.volume(tiledBuild(k, spec({ dividerHeight: 0 })))).toBeCloseTo(full, 6);
    expect(k.volume(tiledBuild(k, spec({ dividerHeight: 15 })))).toBeCloseTo(full, 6);
    expect(cellFrames(spec({ dividerHeight: 5 }))[0].dividerTopZ).toBe(6);
  });

  it('with a lip and recess: valid, lip only on the outer walls', () => {
    const s = spec({ stacking: lipRecess, dividerHeight: 5 });
    const solid = tiledBuild(k, s);
    expect(k.isValid(solid)).toBe(true);
    const fp = tiledFootprint(s);
    const b = k.bounds(solid);
    expect(b.max).toEqual([fp.width, fp.depth, fp.height].map((v) => expect.closeTo(v, 6)));
    const lips = tiledBearingAreas(s).filter((a) => a.role === 'lip');
    expect(lips.length).toBe(4);
    expect(tiledBaseFeatures(s).every((f) => f.kind === 'recess')).toBe(true);
  });
});

describe('tiling validation', () => {
  const v = (over: Partial<TiledBoxSpec>) => {
    const p: string[] = [];
    tiledValidate(p, spec(over));
    return p.join(' ');
  };
  it('accepts good specs', () => {
    expect(v({})).toBe('');
    expect(v({ cols: 1, rows: 1, divider: 0 })).toBe('');
  });
  it('rejects bad counts, dividers, pitch and divider height', () => {
    expect(v({ cols: 0 })).toMatch(/Columns must be a whole number ≥ 1 \(is 0\)/);
    expect(v({ rows: 1.5 })).toMatch(/Rows must be a whole number ≥ 1 \(is 1.5\)/);
    expect(v({ divider: 0 })).toMatch(/Divider thickness must be greater than 0/);
    expect(v({ cell: { width: 20, depth: 10, height: 15, pitchX: 18 } })).toMatch(/Column pitch \(18 mm\) must not be smaller than the cell width \(20 mm\)/);
    // Non-straight (tilted) dividers: cells may overlap in bounding box.
    expect(v({ cell: { width: 20, depth: 10, height: 15, pitchX: 18 }, straightDividers: false })).toBe('');
    expect(v({ dividerHeight: -1 })).toMatch(/Divider height must not be negative/);
    expect(v({ dividerHeight: 20 })).toMatch(/Divider height \(20 mm\) must not exceed the inner height/);
    expect(v({ wall: 0 })).toMatch(/Wall thickness/);
    expect(v({ stacking: lipRecess, wall: 1 })).toMatch(/Recess leaves only/);
  });
});

describe('tiling params', () => {
  it('exposes only the supported counts', () => {
    expect(tilingParams('x').map((p) => p.key)).toEqual(['columns', 'dividerThickness']);
    expect(tilingParams('y').map((p) => p.key)).toEqual(['rows', 'dividerThickness']);
    expect(tilingParams('xy').map((p) => p.key)).toEqual(['columns', 'rows', 'dividerThickness']);
    for (const p of tilingParams('xy')) expect(p.group).toBe('Repeat');
  });
  it('tilingOf reads the counts, 1 along an unsupported axis', () => {
    const item = { id: 'x', type: 't', label: 't', wall: 2, floor: 1, params: { columns: 3, rows: 4, dividerThickness: 2 } } as ResolvedItem;
    expect(tilingOf(item, 'xy')).toEqual({ cols: 3, rows: 4, divider: 2 });
    expect(tilingOf(item, 'x')).toEqual({ cols: 3, rows: 1, divider: 2 });
    expect(tilingOf(item, 'y')).toEqual({ cols: 1, rows: 4, divider: 2 });
  });
});
