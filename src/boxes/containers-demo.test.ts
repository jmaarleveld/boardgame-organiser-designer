import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel } from '../geometry/types';
import { registerAllBoxTypes } from './index';
import { getBoxType } from './registry';
import { validateProject } from '../services/persistence';
import { resolveItem } from '../model/resolve';
import { findOverlaps, layoutSummary, settle } from '../model/layout';

let k: GeometryKernel;
beforeAll(async () => {
  registerAllBoxTypes();
  k = await createKernel();
});

describe('examples/containers-demo.json', () => {
  const project = validateProject(JSON.parse(readFileSync('examples/containers-demo.json', 'utf8')));

  it('holds one of each containers v2 type', () => {
    expect(new Set(project.items.map((i) => i.type))).toEqual(
      new Set(['item-tray', 'card-tray-flat', 'card-tray-upright', 'card-tray-tilted']),
    );
    expect(project.items).toHaveLength(5);
  });

  it('the tilted dispenser has 3 stepped slots along X', () => {
    const tilted = project.items.find((i) => i.type === 'card-tray-tilted')!;
    expect(tilted.params).toMatchObject({ columns: 3 });
    const r = resolveItem(tilted, project.settings, project.items);
    const def = getBoxType(tilted.type);
    const fp = def.footprint(r);
    // 2·wall + 2·pitch + cell width at 15°, one lane deep; the cell includes the
    // extra back wall (20·sin 15° overhang + 2 clearance = 7.18).
    expect(fp.width).toBeCloseTo(126.74, 1);
    expect(fp.depth).toBeCloseTo(68.7, 6);
    expect(def.draw(r).filter((f) => f.kind === 'rect' && f.role === 'divider')).toHaveLength(2);
  });

  it('every item validates clean and builds a valid solid', () => {
    for (const item of project.items) {
      const def = getBoxType(item.type);
      const r = resolveItem(item, project.settings, project.items);
      expect(def.validate?.(r) ?? [], item.label).toEqual([]);
      const solid = def.build(r, k);
      expect(k.isValid(solid), item.label).toBe(true);
      expect(k.volume(solid), item.label).toBeGreaterThan(0);
    }
  });

  it('lays out on the floor without overlaps or issues', () => {
    const settled = settle(project.items, project.settings);
    expect(settled.map((i) => i.z ?? 0)).toEqual(project.items.map(() => 0));
    expect(findOverlaps(project.items, project.settings)).toEqual([]);
    expect(layoutSummary(project.items, project.settings).issues).toEqual([]);
  });
});
