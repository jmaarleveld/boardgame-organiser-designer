import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel, Solid } from '../geometry/types';
import type { ItemParams, PlacedItem, ProjectSettings, ResolvedItem } from '../model/types';
import { DEFAULT_SETTINGS } from '../model/types';
import { effectiveTop } from '../model/layout';
import { defaultParams, keepOutOf, newItemParams, type BoxTypeDefinition } from './types';
import { cardTrayTilted, pocketProfile, tiltedGeom, tiltedPitch } from './definitions/card-tray-tilted';
import { findBoxType, registerBoxType } from './registry';

let k: GeometryKernel;
beforeAll(async () => {
  k = await createKernel();
});

const WALL = 1.6;
const FLOOR = 1.2;
const def: BoxTypeDefinition = cardTrayTilted;

function item(params: ItemParams = {}, wall = WALL, floor = FLOOR): ResolvedItem {
  return { id: 'x', type: def.id, label: def.name, wall, floor, params: { ...defaultParams(def), ...params } };
}

function build(it: ResolvedItem): Solid {
  const fp = def.footprint(it);
  const s = def.build(it, k);
  expect(k.isValid(s)).toBe(true);
  const b = k.bounds(s);
  for (let i = 0; i < 3; i++) expect(Math.abs(b.min[i])).toBeLessThan(1e-6);
  expect(Math.abs(b.max[0] - fp.width)).toBeLessThan(1e-6);
  expect(Math.abs(b.max[1] - fp.depth)).toBeLessThan(1e-6);
  expect(Math.abs(b.max[2] - fp.height)).toBeLessThan(1e-6);
  return s;
}

/** Material inside a 0.2 mm cube centred at (x, y, z). */
function material(s: Solid, x: number, y: number, z: number): number {
  const h = 0.1;
  return k.volume(k.intersection([s, k.box(2 * h, 2 * h, 2 * h, [x - h, y - h, z - h])]));
}
const FULL = 0.2 ** 3;

const rad = (d: number) => (d * Math.PI) / 180;

describe('card-tray-tilted', () => {
  it('cell width, pitch and footprint', () => {
    for (const tiltAngle of [5, 15, 30]) {
      for (const columns of [1, 2, 3]) {
        const it = item({ tiltAngle, columns });
        const th = rad(tiltAngle);
        const H = (88 - 20) * Math.cos(th);
        const s = 31 / Math.cos(th);
        const pitch = s + 1.2 / Math.cos(th);
        const back = 20 * Math.sin(th) + 2;
        const g = tiltedGeom(it);
        expect(g.H).toBeCloseTo(H, 9);
        expect(g.s).toBeCloseTo(s, 9);
        expect(g.overhang).toBeCloseTo(20 * Math.sin(th), 9);
        expect(g.back).toBeCloseTo(back, 9);
        expect(g.width).toBeCloseTo(back + H * Math.tan(th) + s, 9);
        expect(tiltedPitch(it)).toBeCloseTo(pitch, 9);
        expect(pitch).toBeLessThan(g.width);
        const fp = def.footprint(it);
        expect(fp.width).toBeCloseTo(2 * WALL + back + (columns - 1) * pitch + H * Math.tan(th) + s, 9);
        expect(fp.depth).toBeCloseTo(2 * WALL + 65.5, 9);
        expect(fp.height).toBeCloseTo(FLOOR + H, 9);
      }
    }
    // Rows are not a parameter any more: an old `rows` value is ignored.
    expect(def.params.some((p) => p.key === 'rows')).toBe(false);
    expect(def.footprint(item({ rows: 3 })).depth).toBeCloseTo(2 * WALL + 65.5, 9);
    // Dividers are always full height: no dividerHeight param.
    expect(def.params.some((p) => p.key === 'dividerHeight')).toBe(false);
    // The clearance behind the cards adds 1:1 to the width; 0 leaves just the overhang.
    const w0 = def.footprint(item({ overhangClearance: 0 })).width;
    expect(def.footprint(item({ overhangClearance: 5 })).width - w0).toBeCloseTo(5, 9);
    expect(w0).toBeCloseTo(2 * WALL + 20 * Math.sin(rad(15)) + 68 * Math.sin(rad(15)) + 31 / Math.cos(rad(15)), 9);
  });

  it('valid manifold, bounds = footprint for columns, angles and stacking variants', () => {
    for (const columns of [1, 2, 3]) {
      for (const tiltAngle of [5, 15, 30]) {
        const it = item({ columns, tiltAngle });
        build(it);
        expect(def.validate!(it)).toEqual([]);
      }
    }
    for (const p of [
      { stackTop: 'lip', stackBottom: 'recess' },
      { stackTop: 'lip', stackBottom: 'plug' },
      { stackBottom: 'plug' },
      { stackTop: 'lip', tiltAngle: 40, columns: 2 },
      { stackTop: 'lip', tiltAngle: 40, exposedHeight: 0, overhangClearance: 0 },
      { stackTop: 'lip', stackBottom: 'recess', columns: 3 },
      { stackTop: 'lip', stackBottom: 'plug', columns: 3, tiltAngle: 30 },
      { columns: 3, tiltAngle: 5, overhangClearance: 0 },
      { frontHeightPct: 20, columns: 2, overhangClearance: 6 },
      { hollowFront: false, columns: 2 },
      { frontHeightPct: 100, stackTop: 'lip', stackBottom: 'recess' },
    ] as ItemParams[]) {
      const it = item(p);
      build(it);
      expect(def.validate!(it)).toEqual([]);
    }
  });

  it('new items get lip and recess', () => {
    expect(newItemParams(def)).toMatchObject({ stackTop: 'lip', stackBottom: 'recess' });
  });

  it('the slot is tilted: material behind it at the bottom, none at the top', () => {
    for (const tiltAngle of [5, 15, 30]) {
      for (const p of [{}, { stackTop: 'lip', stackBottom: 'plug' }] as ItemParams[]) {
        // Solid back, no wedges: the slot geometry alone.
        const it = item({ tiltAngle, hollowBack: false, wedgePlates: false, ...p });
        const s = build(it);
        const g = tiltedGeom(it);
        const plug = p.stackBottom === 'plug' ? 2 : 0;
        const floorZ = plug + FLOOR;
        const y = WALL + g.depth / 2;
        const x = WALL + g.back + 0.3;
        expect(material(s, x, y, floorZ + 0.3)).toBeCloseTo(FULL, 9);
        expect(material(s, x, y, floorZ + g.H - 0.15)).toBeLessThan(1e-9);
        // The back wall is wall + back thick at the top: material up to there, empty just beyond.
        for (const xm of [WALL + 0.2, WALL + g.back / 2, WALL + g.back - 0.2]) {
          expect(material(s, xm, y, floorZ + g.H - 1)).toBeCloseTo(FULL, 9);
        }
        expect(material(s, WALL + g.back + 1 * g.tan + 0.2, y, floorZ + g.H - 1)).toBeLessThan(1e-9);
        // The back face at mid height is at x_back(z) = wall + back + (H − z)·tan θ.
        const zm = g.H / 2;
        const xb = WALL + g.back + (g.H - zm) * g.tan;
        expect(material(s, xb - 0.2, y, floorZ + zm)).toBeCloseTo(FULL, 9);
        expect(material(s, xb + 0.2, y, floorZ + zm)).toBeLessThan(1e-9);
        // The slot floor is tilted: just above the floor at the slot's front‑bottom corner there is material.
        const xf = WALL + g.back + g.H * g.tan + g.T * g.cos;
        expect(material(s, xf - 0.5, y, floorZ + 0.15)).toBeCloseTo(FULL, 9);
      }
    }
  });

  it('tilted dividers between the slots: full height, bottom to top', () => {
    for (const tiltAngle of [5, 15, 30]) {
      const it = item({ tiltAngle, columns: 3, stackTop: 'lip', wedgePlates: false });
      const s = build(it);
      const g = tiltedGeom(it);
      const pitch = tiltedPitch(it);
      const W = def.footprint(it).width;
      const y = WALL + g.depth / 2;
      // Divider i (between slot i and i + 1) at height z: x_back_i(z) + s … + pitch.
      const mid = (i: number, z: number) => WALL + g.back + i * pitch + (g.H - z) * g.tan + g.s + (pitch - g.s) / 2;
      for (const i of [0, 1]) {
        for (const z of [3, 15, 29, 31, 45, g.H - 0.3]) expect(material(s, mid(i, z), y, FLOOR + z)).toBeCloseTo(FULL, 9);
        // Just inside the slots on both sides: empty.
        expect(material(s, mid(i, 25) - (pitch - g.s) / 2 - 0.3, y, FLOOR + 25)).toBeLessThan(1e-9);
        expect(material(s, mid(i, 25) + (pitch - g.s) / 2 + 0.3, y, FLOOR + 25)).toBeLessThan(1e-9);
        // The side walls and their lip keep their full height next to the divider.
        expect(material(s, mid(i, g.H - 0.3), WALL / 4, FLOOR + g.H + 1.5)).toBeCloseTo(FULL, 9);
        expect(material(s, mid(i, g.H - 0.3), WALL - 0.2, FLOOR + g.H - 0.15)).toBeCloseTo(FULL, 9);
      }
      // Front access opening only at the front block (lane centre): open above frontHeight (50 % of H), closed below.
      expect(g.frontHeight).toBeCloseTo(0.5 * g.H, 9);
      expect(material(s, W - WALL / 2, y, FLOOR + g.frontHeight + 2)).toBeLessThan(1e-9);
      expect(material(s, W - WALL / 2, y, FLOOR + g.frontHeight - 2)).toBeCloseTo(FULL, 9);
      const z = g.frontHeight + 8; // above the front wall, below the wall top
      const xf = WALL + g.back + 2 * pitch + g.H * g.tan + g.s - z * g.tan;
      expect(material(s, xf + 0.5, y, FLOOR + z)).toBeLessThan(1e-9);
      // The outer side wall at the front stays full height.
      expect(material(s, W - WALL / 2, WALL / 2, FLOOR + g.H - 0.5)).toBeCloseTo(FULL, 9);
    }
  });

  it('draw: slot openings, tilted dividers and the front opening notch inside the footprint', () => {
    const it = item({ columns: 3, wedgePlates: false });
    const g = tiltedGeom(it);
    const pitch = tiltedPitch(it);
    const fp = def.footprint(it);
    const feats = def.draw(it);
    const roles = (r: string) => feats.filter((f) => f.kind === 'rect' && f.role === r);
    expect(roles('cavity')).toHaveLength(3);
    expect(roles('solid')).toHaveLength(0);
    expect(roles('notch')).toHaveLength(1);
    const dividers = roles('divider');
    expect(dividers).toHaveLength(2);
    dividers.forEach((d, i) => {
      if (d.kind !== 'rect') return;
      expect(d.x).toBeCloseTo(WALL + g.back + i * pitch + g.s, 9);
      expect(d.w).toBeCloseTo(1.2 / g.cos, 9);
      expect(d.y).toBeCloseTo(WALL, 9);
      expect(d.h).toBeCloseTo(g.depth, 9);
    });
    const cav = roles('cavity');
    for (const i of [0, 1]) {
      const c = cav[i];
      if (c.kind !== 'rect') continue;
      expect(c.x).toBeCloseTo(WALL + g.back + i * pitch, 9);
      expect(c.w).toBeCloseTo(g.s, 9);
    }
    // The notch spans the front block (slot front face at the wall top to the outer face), opening top wide.
    const n = roles('notch')[0];
    if (n.kind === 'rect') {
      expect(n.x).toBeCloseTo(WALL + g.back + 2 * pitch + g.s, 9);
      expect(n.x + n.w).toBeCloseTo(fp.width, 9);
      expect(n.h).toBeCloseTo(g.plateWedge.top, 9);
      expect(n.y + n.h / 2).toBeCloseTo(WALL + g.depth / 2, 9);
    }
    for (const f of feats) {
      if (f.kind !== 'rect') continue;
      expect(f.x).toBeGreaterThanOrEqual(-1e-9);
      expect(f.y).toBeGreaterThanOrEqual(-1e-9);
      expect(f.x + f.w).toBeLessThanOrEqual(fp.width + 1e-9);
      expect(f.y + f.h).toBeLessThanOrEqual(fp.depth + 1e-9);
    }
  });

  it('bearing areas: the front opening carries nothing, it is low at its bottom', () => {
    const it = item({ stackTop: 'lip', stackBottom: 'recess', columns: 2 });
    const g = tiltedGeom(it);
    const fp = def.footprint(it);
    const areas = def.bearingAreas!(it);
    const y = WALL + g.depth / 2;
    const at = (x: number) => areas.filter((a) => x > a.x && x < a.x + a.width && y > a.y && y < a.y + a.depth);
    const front = at(fp.width - 0.2);
    expect(front).toHaveLength(1);
    expect(front[0]).toMatchObject({ role: 'low', name: 'front opening' });
    expect(front[0].height).toBeCloseTo(FLOOR + 0.5 * g.H, 9);
    // The slot clears the back lip: still a lip; the extra back wall strip bears at the wall top.
    expect(at(0.2)).toEqual([expect.objectContaining({ role: 'lip' })]);
    expect(at(WALL + g.back / 2)).toEqual([expect.objectContaining({ role: 'bearing', name: 'back wall', height: FLOOR + g.H })]);
    expect(at(WALL + g.back / 2)[0].width).toBeCloseTo(g.back, 9);
    // At 40° the lip is notched only without the extra back wall (no exposed cards, no clearance).
    expect(def.bearingAreas!(item({ stackTop: 'lip', tiltAngle: 40 })).filter((a) => a.role === 'low' && a.x < 0.2 && a.name !== 'front wall')).toEqual([]);
    const steep = item({ stackTop: 'lip', tiltAngle: 40, exposedHeight: 0, overhangClearance: 0 });
    const sa = def.bearingAreas!(steep);
    const back = sa.filter((a) => 0.2 > a.x && 0.2 < a.x + a.width && y > a.y && y < a.y + a.depth);
    expect(back).toEqual([expect.objectContaining({ role: 'low' })]);
    // And the solid really is notched there.
    const s = build(steep);
    const fz = def.footprint(steep).height;
    expect(material(s, WALL / 2 - 0.15, y, fz - 0.15)).toBeLessThan(1e-9);
  });

  it('bearing areas: tilted divider tops bear at full height', () => {
    const it = item({ stackTop: 'lip', stackBottom: 'recess', columns: 3 });
    const g = tiltedGeom(it);
    const pitch = tiltedPitch(it);
    const areas = def.bearingAreas!(it).filter((a) => a.name === 'divider');
    expect(areas).toHaveLength(2);
    areas.forEach((a, i) => {
      expect(a.role).toBe('bearing');
      expect(a.height).toBeCloseTo(FLOOR + g.H, 9);
      expect(a.x).toBeCloseTo(WALL + g.back + i * pitch + g.s, 9);
      expect(a.width).toBeCloseTo(1.2 / g.cos, 9);
    });
    // The front block top (last cell, split by the opening) and one back wall strip (first cell).
    expect(def.bearingAreas!(it).filter((a) => a.name === 'front wall')).toHaveLength(2);
    expect(def.bearingAreas!(it).filter((a) => a.name === 'front opening')).toHaveLength(1);
    expect(def.bearingAreas!(it).filter((a) => a.name === 'back wall')).toHaveLength(1);
  });

  it('front wall height as a percentage of the wall: footprint unchanged, valid for every stacking variant', () => {
    const fp = def.footprint(item());
    for (const frontHeightPct of [0, 30, 50, 99, 100]) {
      const f = def.footprint(item({ frontHeightPct }));
      expect(f.width).toBeCloseTo(fp.width, 9);
      expect(f.depth).toBeCloseTo(fp.depth, 9);
      expect(f.height).toBeCloseTo(fp.height, 9);
      expect(tiltedGeom(item({ frontHeightPct })).frontHeight).toBeCloseTo((frontHeightPct / 100) * tiltedGeom(item()).H, 9);
      for (const columns of [1, 2, 3]) {
        for (const st of [{ stackTop: 'lip', stackBottom: 'recess' }, { stackTop: 'lip', stackBottom: 'plug' }] as ItemParams[]) {
          for (const hollowFront of [true, false]) {
            const it = item({ frontHeightPct, columns, hollowFront, ...st });
            build(it);
            // 0 % reaches the slot floor's front corner: reported, but still a valid solid.
            expect(def.validate!(it)).toHaveLength(frontHeightPct === 0 ? 1 : 0);
          }
        }
      }
    }
  });

  /** Probe helpers for the front block of a 2-column tray with lip and recess. */
  function front(frontHeightPct: number, extra: ItemParams = {}) {
    const it = item({ frontHeightPct, stackTop: 'lip', stackBottom: 'recess', columns: 2, ...extra });
    const s = build(it);
    const g = tiltedGeom(it);
    const fp = def.footprint(it);
    const pitch = tiltedPitch(it);
    const topZ = FLOOR + g.H;
    const zb = FLOOR + g.frontHeight; // opening bottom
    const d = g.frontOpeningDepth;
    const tw = g.plateWedge.top / 2;
    const bw = g.plateWedge.bottom / 2;
    const half = (z: number) => bw + ((z - zb) / d) * (tw - bw);
    /** Slot 1's front face at z (absolute). */
    const xFront = (z: number) => WALL + g.back + pitch + (g.H - (z - FLOOR)) * g.tan + g.s;
    return { it, s, g, fp, W: fp.width, yc: WALL + g.depth / 2, topZ, lipH: fp.height - topZ, zb, half, xFront, pitch };
  }

  it('front block: full height, outer wall, hollow pocket open through the side walls, slot floor intact', () => {
    for (const pct of [50, 100]) {
      const { s, g, fp, W, yc, topZ, lipH, xFront, pitch } = front(pct);
      // The outer front wall away from the opening, at mid height; and its lip.
      expect(material(s, W - 0.8, WALL + 2, FLOOR + g.H / 2)).toBeCloseTo(FULL, 9);
      expect(material(s, W - WALL / 4, WALL + 2, topZ + lipH / 2)).toBeCloseTo(FULL, 9);
      // The leaning plate in front of the slot: wall / cos θ thick horizontally.
      for (const z of [FLOOR + 12, FLOOR + 20]) {
        expect(material(s, xFront(z) + 0.3, WALL + 2, z)).toBeCloseTo(FULL, 9);
        expect(material(s, xFront(z) + WALL / g.cos - 0.3, WALL + 2, z)).toBeCloseTo(FULL, 9);
        expect(material(s, xFront(z) + WALL / g.cos + 0.3, WALL + 2, z)).toBeLessThan(1e-9);
      }
      // The pocket near the top (widest there), through both side walls; the roof above it.
      const z = topZ - WALL - 0.5;
      for (const y of [WALL + 2, 0.1, fp.depth - 0.1]) expect(material(s, W - WALL - 1, y, z)).toBeLessThan(1e-9);
      expect(material(s, W - WALL - 1, WALL + 2, topZ - 0.5)).toBeCloseTo(FULL, 9);
      // The structural floor under the pocket; the slot floor wedge at its front corner.
      expect(material(s, W - WALL - 0.3, WALL + 2, FLOOR - 0.3)).toBeCloseTo(FULL, 9);
      const xCorner = WALL + g.back + pitch + g.H * g.tan + g.T * g.cos;
      expect(material(s, xCorner - 0.5, yc, FLOOR + 0.15)).toBeCloseTo(FULL, 9);
      expect(material(s, xCorner - 0.5, yc, FLOOR + g.T * g.sin - 1)).toBeCloseTo(FULL, 9);
    }
    // Without hollowFront the pocket is solid; the pocket saves material.
    const solid = front(50, { hollowFront: false });
    expect(material(solid.s, solid.W - WALL - 1, WALL + 2, solid.topZ - WALL - 0.5)).toBeCloseTo(FULL, 9);
    expect(k.volume(solid.s) - k.volume(front(50).s)).toBeGreaterThan(1000);
  });

  it('front at 100 %: no opening, the front wall and lip intact, bearing areas like any tray', () => {
    const { it, s, g, fp, W, yc, topZ, lipH } = front(100);
    expect(g.frontClosed).toBe(true);
    expect(lipH).toBeCloseTo(2, 9);
    expect(material(s, W - 0.8, yc, topZ - 0.5)).toBeCloseTo(FULL, 9);
    expect(material(s, W - WALL / 4, yc, topZ + lipH / 2)).toBeCloseTo(FULL, 9);
    // No lining at the lane centre: the pocket is open there.
    expect(material(s, W - WALL - 1, yc, topZ - WALL - 0.5)).toBeLessThan(1e-9);
    const areas = def.bearingAreas!(it);
    expect(areas.filter((a) => a.role === 'low')).toEqual([]);
    const lip = areas.filter((a) => a.role === 'lip');
    const t = WALL / 2;
    expect(lip.reduce((sum, a) => sum + a.width * a.depth, 0)).toBeCloseTo(fp.width * fp.depth - (fp.width - 2 * t) * (fp.depth - 2 * t), 9);
    const fw = areas.filter((a) => a.name === 'front wall');
    expect(fw).toHaveLength(1);
    expect(fw[0]).toMatchObject({ role: 'bearing' });
    expect(fw[0].height).toBeCloseTo(topZ, 9);
    expect(fw[0].x + fw[0].width).toBeCloseTo(W - WALL, 9);
    const feats = def.draw(item({ frontHeightPct: 100, columns: 2, wedgePlates: false }));
    expect(feats.filter((f) => f.kind === 'rect' && (f.role === 'solid' || f.role === 'notch'))).toEqual([]);
    expect(feats.filter((f) => f.kind === 'rect' && f.role === 'cavity')).toHaveLength(2);
  });

  it('front access opening below 100 %: open at the lane centre down to pct · H, lined pocket, low at its bottom', () => {
    for (const pct of [30, 50, 99]) {
      const { it, s, g, W, yc, topZ, lipH, zb, half, xFront } = front(pct);
      expect(g.frontClosed).toBe(false);
      expect(g.frontOpeningDepth).toBeCloseTo((1 - pct / 100) * g.H, 9);
      // Open at the lane centre through the outer wall, the plate and the lip, from the top down to zb.
      for (const z of [zb + 0.15, (zb + topZ) / 2, topZ - 0.15]) {
        expect(material(s, W - 0.8, yc, z)).toBeLessThan(1e-9);
        expect(material(s, xFront(z) + 0.3, yc, z)).toBeLessThan(1e-9);
      }
      expect(material(s, W - WALL / 4, yc, topZ + lipH / 2)).toBeLessThan(1e-9);
      expect(material(s, W - 0.8, yc, zb - 0.15)).toBeCloseTo(FULL, 9);
      // Beside the opening the outer wall and the lip stay.
      expect(material(s, W - 0.8, WALL + 1, topZ - 0.5)).toBeCloseTo(FULL, 9);
      expect(material(s, W - WALL / 4, WALL / 4, topZ + lipH / 2)).toBeCloseTo(FULL, 9);
      // The lining in the pocket: just beside and just below the opening; the pocket beyond it.
      const x = W - WALL - 1;
      const z = topZ - WALL - 0.5;
      if (z > zb + 0.5) {
        expect(material(s, x, yc + half(z) + WALL / 2, z)).toBeCloseTo(FULL, 9);
        expect(material(s, x, yc + half(z) + WALL + 0.5, z)).toBeLessThan(1e-9);
        expect(material(s, x, yc - half(z) - WALL / 2, z)).toBeCloseTo(FULL, 9);
      }
      if (zb - WALL - 0.5 > FLOOR + (WALL / g.cos + 2) / g.tan) {
        expect(material(s, x, yc, zb - WALL / 2)).toBeCloseTo(FULL, 9);
        expect(material(s, x, yc, zb - WALL - 0.5)).toBeLessThan(1e-9);
      }
      // Bearing areas: the opening is low at its bottom, the rest of the front top bears.
      const areas = def.bearingAreas!(it);
      const at = (px: number, py: number) => areas.filter((a) => px > a.x && px < a.x + a.width && py > a.y && py < a.y + a.depth);
      expect(at(W - 0.2, yc)).toEqual([expect.objectContaining({ role: 'low', name: 'front opening' })]);
      expect(at(W - 0.2, yc)[0].height).toBeCloseTo(zb, 9);
      expect(at(W - 0.2, WALL + 1)).toEqual([expect.objectContaining({ role: 'lip' })]);
      expect(at(W - WALL - 1, WALL + 1)).toEqual([expect.objectContaining({ role: 'bearing', name: 'front wall' })]);
      expect(areas.filter((a) => a.role === 'low')).toHaveLength(1);
      const feats = def.draw(item({ frontHeightPct: pct, columns: 2, wedgePlates: false }));
      expect(feats.filter((f) => f.kind === 'rect' && f.role === 'solid')).toHaveLength(0);
      expect(feats.filter((f) => f.kind === 'rect' && f.role === 'notch')).toHaveLength(1);
    }
  });

  it('keepOut: leaning cards above the top, inside the footprint', () => {
    for (const tiltAngle of [5, 15, 30, 40]) {
      for (const overhangClearance of [0, 2]) {
        const it = item({ tiltAngle, columns: 3, stackTop: 'lip', overhangClearance });
        const g = tiltedGeom(it);
        const pitch = tiltedPitch(it);
        const fp = def.footprint(it);
        const ko = keepOutOf(def, it);
        expect(ko).toHaveLength(3);
        const th = rad(tiltAngle);
        for (const [i, r] of ko.entries()) {
          expect(r.x).toBeCloseTo(WALL + overhangClearance + i * pitch, 9);
          expect(r.x).toBeGreaterThanOrEqual(overhangClearance);
          expect(r.x + r.width).toBeLessThanOrEqual(fp.width + 1e-9);
          expect(r.y).toBeCloseTo(WALL, 9);
          expect(r.width).toBeCloseTo(g.s + 20 * Math.sin(th), 9);
          expect(r.depth).toBeCloseTo(g.depth, 9);
          expect(r.height).toBeCloseTo(20 * Math.cos(th) + 30 * Math.sin(th) - 2, 9);
        }
      }
    }
    expect(keepOutOf(def, item({ exposedHeight: 0, tiltAngle: 5, stackHeight: 1, stackTop: 'lip' }))).toEqual([]);
  });

  it('keepOut is seen by the layout: the cards raise the effective top', () => {
    if (!findBoxType(def.id)) registerBoxType(def);
    const settings: ProjectSettings = { ...structuredClone(DEFAULT_SETTINGS), box: { width: 300, depth: 300, height: 200 } };
    const tray: PlacedItem = { id: 't', type: def.id, label: 'T', x: 50, y: 50, rotation: 0, params: { tiltAngle: 30 } };
    const top = effectiveTop(tray, settings, [tray]);
    expect(top).toBeGreaterThan(def.footprint(item({ tiltAngle: 30 }, settings.defaults.wall, settings.defaults.floor)).height);
  });

  it('validation messages', () => {
    const v = (p: ItemParams) => def.validate!(item(p));
    expect(v({})).toEqual([]);
    expect(v({ tiltAngle: 4 })).toEqual(['Tilt angle must be between 5° and 40° (is 4°).']);
    expect(v({ tiltAngle: 41 })).toEqual(['Tilt angle must be between 5° and 40° (is 41°).']);
    expect(v({ exposedHeight: -1 })).toContain('Exposed height must not be negative (is -1).');
    expect(v({ exposedHeight: 88 })).toContain('Exposed height (88 mm) must be smaller than the card height (88 mm).');
    expect(v({ frontHeightPct: -1 })).toEqual(['Front wall height must be between 0 % and 100 % of the wall (is -1 %).']);
    // The opening must stay 1 mm above the slot floor's front corner (T·sin θ = 31·sin 15° = 8.02 mm).
    expect(v({ frontHeightPct: 0 })).toEqual([
      "Front wall height (0 % = 0 mm) must be at least 9.02 mm (13.74 %): the front access opening must stay 1 mm above the slot floor's front corner (8.02 mm above the floor).",
    ]);
    expect(v({ frontHeightPct: 13 })).toHaveLength(1);
    expect(v({ frontHeightPct: 14 })).toEqual([]);
    expect(v({ frontHeightPct: 101 })).toEqual(['Front wall height must be between 0 % and 100 % of the wall (is 101 %).']);
    for (const frontHeightPct of [20, 99, 100]) expect(v({ frontHeightPct })).toEqual([]);
    expect(v({ overhangClearance: -0.5 })).toEqual(['Clearance behind the cards must not be negative (is -0.5).']);
    expect(v({ overhangClearance: 0 })).toEqual([]);
    // The old mm param is ignored; no "lower than the inner height" check any more.
    expect(v({ frontHeight: 70 })).toEqual([]);
    expect(v({ frontHeightPct: 100 }).some((m) => m.includes('inner height'))).toBe(false);
    expect(v({ cardWidth: 0 })).toContain('Card width must be greater than 0 (is 0).');
    expect(v({ columns: 1.5 })).toContain('Columns must be a whole number ≥ 1 (is 1.5).');
    expect(v({ columns: 2, dividerThickness: 0 })).toEqual(['Divider thickness must be greater than 0 (is 0).']);
    expect(v({ columns: 1, dividerThickness: 0 })).toEqual([]);
  });
  it('valid manifold, bounds = footprint with the hollow back and every wedge combination', () => {
    for (const columns of [1, 2, 3]) {
      for (const tiltAngle of [5, 15, 30]) {
        for (const hollowBack of [true, false]) {
          for (const [wedgePlates, wedgeSides] of [
            [true, false],
            [false, false],
            [true, true],
            [false, true],
          ]) {
            const it = item({ columns, tiltAngle, hollowBack, wedgePlates, wedgeSides });
            build(it);
            expect(def.validate!(it)).toEqual([]);
          }
        }
      }
    }
    for (const st of [
      { stackTop: 'lip', stackBottom: 'recess' },
      { stackTop: 'lip', stackBottom: 'plug' },
      { stackBottom: 'recess' },
    ] as ItemParams[]) {
      for (const columns of [1, 3]) {
        for (const tiltAngle of [5, 15, 30, 40]) {
          const it = item({ columns, tiltAngle, wedgeSides: true, ...st });
          build(it);
          expect(def.validate!(it)).toEqual([]);
        }
      }
    }
  });

  it('hollow back: a pocket between the outer back wall and the leaning plate, open through the side walls', () => {
    const it = item({ wedgePlates: false });
    const s = build(it);
    const g = tiltedGeom(it);
    const fp = def.footprint(it);
    const yc = WALL + g.depth / 2;
    const z = FLOOR + g.H / 2;
    // Air in the pocket, also inside both side walls (the pocket runs through them).
    for (const y of [yc, 0.5, fp.depth - 0.5, 0.1]) expect(material(s, WALL + 1, y, z)).toBeLessThan(1e-9);
    // The outer back wall at x = 0.8 stays.
    expect(material(s, 0.8, yc, z)).toBeCloseTo(FULL, 9);
    expect(material(s, 0.8, 0.5, z)).toBeCloseTo(FULL, 9);
    // The leaning plate just behind the slot: wall / cos θ thick horizontally.
    const xb = (zz: number) => WALL + g.back + (g.H - zz) * g.tan;
    for (const zz of [3, g.H / 2, g.H - 3]) {
      expect(material(s, xb(zz) - 0.3, yc, FLOOR + zz)).toBeCloseTo(FULL, 9);
      expect(material(s, xb(zz) - WALL / g.cos + 0.3, yc, FLOOR + zz)).toBeCloseTo(FULL, 9);
      expect(material(s, xb(zz) - WALL / g.cos - 0.3, yc, FLOOR + zz)).toBeLessThan(1e-9);
    }
    // The roof: solid at topZ − 0.5 across the back, the pocket ends at topZ − wall.
    for (const x of [WALL + 0.5, WALL + g.back / 2]) {
      expect(material(s, x, yc, FLOOR + g.H - 0.5)).toBeCloseTo(FULL, 9);
      expect(material(s, x, 0.5, FLOOR + g.H - 0.5)).toBeCloseTo(FULL, 9);
      expect(material(s, x, yc, FLOOR + g.H - WALL - 0.2)).toBeLessThan(1e-9);
    }
    // The structural floor stays under the pocket.
    expect(material(s, WALL + 1, yc, FLOOR - 0.3)).toBeCloseTo(FULL, 9);
    expect(material(s, WALL + 1, yc, FLOOR + 0.2)).toBeLessThan(1e-9);
    // Only cell 0: with 3 columns the dividers are solid (no pocket in front of slot 0).
    const it3 = item({ columns: 3, wedgePlates: false });
    const s3 = build(it3);
    const pitch = tiltedPitch(it3);
    const mid = WALL + g.back + pitch + (g.H - g.H / 2) * g.tan - (pitch - g.s) / 2;
    expect(material(s3, mid, 0.5, z)).toBeCloseTo(FULL, 9);
  });

  it('hollow back: the pocket saves its trapezoid × the outer depth', () => {
    for (const tiltAngle of [5, 15, 30]) {
      for (const columns of [1, 3]) {
        const it = item({ tiltAngle, columns, wedgePlates: false });
        const g = tiltedGeom(it);
        const fp = def.footprint(it);
        const solid = k.volume(def.build(item({ tiltAngle, columns, wedgePlates: false, hollowBack: false }), k));
        const hollow = k.volume(build(it));
        const wTop = g.back + WALL * g.tan - WALL / g.cos;
        const wBot = g.back + g.H * g.tan - WALL / g.cos;
        const area = ((g.H - WALL) * (wTop + wBot)) / 2;
        expect(solid - hollow).toBeCloseTo(area * fp.depth, 2);
        expect(pocketProfile(g, WALL, FLOOR, FLOOR + g.H)).not.toBeNull();
      }
    }
    // Default 15° tray: report the saving.
    const it = item();
    const saved = k.volume(def.build(item({ hollowBack: false }), k)) - k.volume(def.build(it, k));
    expect(saved).toBeGreaterThan(5000);
  });

  it('hollow back with plate wedges: a wall-thick lining seals the pocket around the back wedge', () => {
    const it = item();
    const s = build(it);
    const g = tiltedGeom(it);
    const fp = def.footprint(it);
    const yc = WALL + g.depth / 2;
    const topZ = FLOOR + g.H;
    const zb = topZ - g.wedgeDepth;
    const tw = g.plateWedge.top / 2;
    const bw = g.plateWedge.bottom / 2;
    const half = (z: number) => bw + ((z - zb) / g.wedgeDepth) * (tw - bw);
    const x = WALL + 1;
    // Under the wedge bottom: the lining, then the pocket below it.
    expect(material(s, x, yc, zb - WALL / 2)).toBeCloseTo(FULL, 9);
    expect(material(s, x, yc, zb - WALL - 0.5)).toBeLessThan(1e-9);
    // The wedge itself cuts through the whole back: outer wall, lined pocket, leaning plate.
    const xPlate = WALL + g.back + (g.wedgeDepth - 1) * g.tan - 0.3; // just inside the leaning plate at zb + 1
    for (const xx of [0.5, x, xPlate]) expect(material(s, xx, yc, zb + 1)).toBeLessThan(1e-9);
    // Beside the wedge: the slanted lining, then the pocket.
    const z = topZ - 5;
    expect(material(s, x, yc + half(z) + WALL / 2, z)).toBeCloseTo(FULL, 9);
    expect(material(s, x, yc + half(z) + WALL + 0.5, z)).toBeLessThan(1e-9);
    expect(material(s, x, yc - half(z) - WALL / 2, z)).toBeCloseTo(FULL, 9);
    expect(material(s, x, yc - half(z) - WALL - 0.5, z)).toBeLessThan(1e-9);
    // Away from the wedge the pocket still runs through both side walls.
    for (const y of [0.1, fp.depth - 0.1]) expect(material(s, x, y, FLOOR + g.H / 2)).toBeLessThan(1e-9);
    // The lining costs some of the saving: still positive, smaller than without wedges.
    const savedOn = k.volume(def.build(item({ hollowBack: false }), k)) - k.volume(s);
    const savedOff = k.volume(def.build(item({ hollowBack: false, wedgePlates: false }), k)) - k.volume(def.build(item({ wedgePlates: false }), k));
    expect(savedOn).toBeGreaterThan(0);
    expect(savedOn).toBeLessThan(savedOff);
  });

  it('with a recessed base the pocket starts above the recess ring', () => {
    // Recess 2.15 deep; the pocket bottom is at 2.15 + 0.4, so the side-wall hole never opens into the ring.
    const s = build(item({ stackTop: 'lip', stackBottom: 'recess', wedgePlates: false }));
    const x = WALL + 1.5;
    const y = 10;
    expect(material(s, x, y, 2.15 + 0.2)).toBeCloseTo(FULL, 6); // below the pocket: solid
    expect(material(s, x, y, 2.15 + 0.4 + 0.3)).toBeCloseTo(0, 6); // inside the pocket: air
    expect(material(s, x, 0.1, 2.15 + 0.2)).toBeCloseTo(FULL, 6); // side wall above the recess, below the pocket: solid
    expect(material(s, x, 0.1, 2.15 + 0.4 + 0.3)).toBeCloseTo(0, 6); // the hole through the side wall
  });

  it('hollow back is skipped where the pocket would be thinner than 1 mm', () => {
    // 40°, no exposed cards, no clearance: back = 0, the pocket would have no width at the roof.
    const p = { tiltAngle: 40, exposedHeight: 0, overhangClearance: 0, wedgePlates: false };
    const g = tiltedGeom(item(p));
    expect(pocketProfile(g, WALL, FLOOR, FLOOR + g.H)).toBeNull();
    expect(k.volume(build(item(p)))).toBeCloseTo(k.volume(build(item({ ...p, hollowBack: false }))), 6);
    // 5° with a little exposed card: back + wall·tan θ − wall / cos θ < 1.
    const thin = { tiltAngle: 5, exposedHeight: 5, overhangClearance: 0.5, wedgePlates: false };
    expect(pocketProfile(tiltedGeom(item(thin)), WALL, FLOOR, FLOOR + tiltedGeom(item(thin)).H)).toBeNull();
    expect(k.volume(build(item(thin)))).toBeCloseTo(k.volume(build(item({ ...thin, hollowBack: false }))), 6);
  });

  it('plate wedges: cut at the lane centre from the top of the back plate and of every divider', () => {
    for (const tiltAngle of [5, 15, 30]) {
      const it = item({ tiltAngle, columns: 3, stackTop: 'lip' });
      const s = build(it);
      const g = tiltedGeom(it);
      const pitch = tiltedPitch(it);
      const fp = def.footprint(it);
      const yc = WALL + g.depth / 2;
      const yEdge = WALL + 1.5;
      const z = FLOOR + g.H - 0.5;
      const xb = (i: number, zz: number) => WALL + g.back + i * pitch + (g.H - zz) * g.tan;
      // Back plate (cell 0): the roof / back block and the back lip.
      expect(material(s, WALL + g.back - 0.5, yc, z)).toBeLessThan(1e-9);
      expect(material(s, WALL + g.back - 0.5, yEdge, z)).toBeCloseTo(FULL, 9);
      expect(material(s, WALL / 4, yc, fp.height - 0.3)).toBeLessThan(1e-9);
      expect(material(s, WALL / 4, yEdge, fp.height - 0.3)).toBeCloseTo(FULL, 9);
      // Dividers 1, 2 (behind slots 1, 2) at their top.
      for (const i of [1, 2]) {
        const x = xb(i, g.H - 0.5) - (pitch - g.s) / 2;
        expect(material(s, x, yc, z)).toBeLessThan(1e-9);
        expect(material(s, x, yEdge, z)).toBeCloseTo(FULL, 9);
        // Below the wedge bottom the divider is whole again.
        const zz = g.H - g.wedgeDepth - 1;
        expect(material(s, xb(i, zz) - (pitch - g.s) / 2, yc, FLOOR + zz)).toBeCloseTo(FULL, 9);
      }
      // The front block keeps its material below the opening.
      expect(material(s, fp.width - WALL / 2, yc, FLOOR + g.frontHeight - 2)).toBeCloseTo(FULL, 9);
      // The wedge depth is 60 % of H.
      expect(g.wedgeDepth).toBeCloseTo(0.6 * g.H, 9);
      expect(g.plateWedge.top).toBeCloseTo(0.6 * g.depth, 9);
      expect(g.plateWedge.bottom).toBeCloseTo(0.4 * 0.6 * g.depth, 9);
    }
    // Steep tilt with a thick stack: the auto depth is clamped 1 mm above the floor wedge under the slots.
    const steep = tiltedGeom(item({ tiltAngle: 40 }));
    expect(steep.wedgeDepth).toBeCloseTo(Math.min(0.6 * steep.H, steep.H - steep.T * steep.sin - 1), 9);
    expect(steep.wedgeDepth).toBeLessThan(0.6 * steep.H);
  });

  it('side wedges: a cut in both side walls at every slot, tilted with the cards', () => {
    for (const tiltAngle of [5, 15, 30]) {
      const it = item({ tiltAngle, columns: 2, stackTop: 'lip', wedgePlates: false, wedgeSides: true });
      const s = build(it);
      const g = tiltedGeom(it);
      const pitch = tiltedPitch(it);
      const fp = def.footprint(it);
      const plain = build(item({ tiltAngle, columns: 2, stackTop: 'lip', wedgePlates: false }));
      expect(g.sideWedge.top).toBeCloseTo(0.6 * g.T, 9);
      for (const i of [0, 1]) {
        const xc = WALL + g.back + i * pitch + g.s / 2; // slot centre at the wall top
        for (const y of [WALL / 2, fp.depth - WALL / 2]) {
          expect(material(s, xc, y, FLOOR + g.H - 0.5)).toBeLessThan(1e-9);
          expect(material(plain, xc, y, FLOOR + g.H - 0.5)).toBeCloseTo(FULL, 9);
          // Through the lip.
          expect(material(s, xc, WALL / 4, fp.height - 0.3)).toBeLessThan(1e-9);
          // Down along the cards: the trapezoid centre line leans back with the slot.
          const d = g.wedgeDepth - 2;
          const xd = xc + d * g.sin; // down along −u = (sin θ, 0, −cos θ)
          const zd = FLOOR + g.H - d * g.cos;
          expect(material(s, xd, y, zd)).toBeLessThan(1e-9);
          // Below the wedge: wall.
          const d2 = g.wedgeDepth + 2;
          expect(material(s, xc + d2 * g.sin, y, FLOOR + g.H - d2 * g.cos)).toBeCloseTo(FULL, 9);
        }
        // Beside the cut, at the slot's back face and the divider, the side wall stays.
        expect(material(s, WALL + g.back + i * pitch + 0.4, WALL / 2, FLOOR + g.H - 0.5)).toBeCloseTo(FULL, 9);
      }
      // The lane between the side walls is not touched beyond the slot.
      expect(material(s, WALL + g.back + g.s + (pitch - g.s) / 2, WALL + 1, FLOOR + g.H - 0.5)).toBeCloseTo(FULL, 9);
    }
  });

  it('wedge volumes: the side wedges remove the tilted trapezoid below the wall top, × wall, twice per slot', () => {
    for (const tiltAngle of [5, 15, 30]) {
      const base = { columns: 2, tiltAngle, wedgePlates: false };
      const it = item({ ...base, wedgeSides: true, wedgeDepth: 20 });
      const g = tiltedGeom(it);
      const cut = k.volume(def.build(item(base), k)) - k.volume(build(it));
      // The cutter profile in the slot frame (x across, z along the cards), continued along u above its
      // top edge, mapped to world XZ (relative to the slot corner) and clipped at the wall top z = H.
      const tw = g.sideWedge.top / 2;
      const bw = g.sideWedge.bottom / 2;
      const cx = g.T / 2;
      const zc = (g.H - cx * g.sin) / g.cos;
      const local: [number, number][] = [
        [cx - bw, zc - 20],
        [cx + bw, zc - 20],
        [cx + tw, zc],
        [cx + tw, zc + 50],
        [cx - tw, zc + 50],
        [cx - tw, zc],
      ];
      const world = local.map(([x, z]): [number, number] => [x * g.cos - z * g.sin, x * g.sin + z * g.cos]);
      const clipped: [number, number][] = [];
      for (let i = 0; i < world.length; i++) {
        const p = world[i];
        const q = world[(i + 1) % world.length];
        if (p[1] <= g.H) clipped.push(p);
        if (p[1] <= g.H !== q[1] <= g.H) {
          const t = (g.H - p[1]) / (q[1] - p[1]);
          clipped.push([p[0] + t * (q[0] - p[0]), g.H]);
        }
      }
      let area = 0;
      for (let i = 0; i < clipped.length; i++) {
        const [x0, z0] = clipped[i];
        const [x1, z1] = clipped[(i + 1) % clipped.length];
        area += (x0 * z1 - x1 * z0) / 2;
      }
      expect(cut).toBeCloseTo(2 * 2 * Math.abs(area) * WALL, 2);
      // Close to the plain trapezoid; the lean adds a sliver at the top.
      expect(cut).toBeGreaterThanOrEqual(2 * 2 * (tw + bw) * 20 * WALL - 1e-6);
    }
  });

  it('draw: wedge notches', () => {
    const it = item({ columns: 3, wedgeSides: true });
    const g = tiltedGeom(it);
    const pitch = tiltedPitch(it);
    const fp = def.footprint(it);
    const notches = def.draw(it).filter((f) => f.kind === 'rect' && f.role === 'notch');
    // Front opening + 3 plate wedges + 2 · 3 side wedges.
    expect(notches).toHaveLength(1 + 3 + 6);
    // The front opening notch has the same width; it is the one reaching the front face.
    const plate = notches.filter((n) => n.kind === 'rect' && Math.abs(n.h - g.plateWedge.top) < 1e-9 && n.x + n.w < fp.width - 1e-6);
    expect(plate).toHaveLength(3);
    plate.forEach((n, i) => {
      if (n.kind !== 'rect') return;
      expect(n.y + n.h / 2).toBeCloseTo(WALL + g.depth / 2, 9);
      const xTop = WALL + g.back + i * pitch;
      if (i === 0) {
        expect(n.x).toBeCloseTo(0, 9);
        expect(n.w).toBeCloseTo(WALL + g.back, 9);
      } else {
        expect(n.x).toBeCloseTo(xTop - (pitch - g.s), 9);
        expect(n.w).toBeCloseTo(pitch - g.s, 9);
      }
    });
    const side = notches.filter((n) => n.kind === 'rect' && Math.abs(n.h - WALL) < 1e-9);
    expect(side).toHaveLength(6);
    for (const n of side) {
      if (n.kind !== 'rect') continue;
      expect(n.w).toBeCloseTo(g.sideWedge.top / g.cos, 9);
      expect([0, fp.depth - WALL]).toContainEqual(expect.closeTo(n.y, 9));
      const i = Math.round((n.x + n.w / 2 - WALL - g.back - g.s / 2) / pitch);
      expect(n.x + n.w / 2).toBeCloseTo(WALL + g.back + i * pitch + g.s / 2, 9);
    }
    // No wedges: only the front notch.
    expect(def.draw(item({ columns: 3, wedgePlates: false })).filter((f) => f.kind === 'rect' && f.role === 'notch')).toHaveLength(1);
    for (const f of def.draw(it)) {
      if (f.kind !== 'rect') continue;
      expect(f.x).toBeGreaterThanOrEqual(-1e-9);
      expect(f.y).toBeGreaterThanOrEqual(-1e-9);
      expect(f.x + f.w).toBeLessThanOrEqual(fp.width + 1e-9);
      expect(f.y + f.h).toBeLessThanOrEqual(fp.depth + 1e-9);
    }
  });

  it('params: hollow back and the wedge toggles', () => {
    expect(def.params.find((p) => p.key === 'hollowBack')).toMatchObject({ kind: 'boolean', default: true, label: 'Hollow back', group: 'Dispenser' });
    expect(def.params.find((p) => p.key === 'hollowFront')).toMatchObject({ kind: 'boolean', default: true, label: 'Hollow front', group: 'Dispenser' });
    expect(def.params.find((p) => p.key === 'frontHeightPct')).toMatchObject({ kind: 'number', default: 50, min: 0, max: 100, step: 5, group: 'Dispenser' });
    expect(def.params.find((p) => p.key === 'wedgePlates')).toMatchObject({
      kind: 'boolean',
      default: true,
      label: 'Wedges in the leaning plates',
      group: 'Wedge',
    });
    expect(def.params.find((p) => p.key === 'wedgeSides')).toMatchObject({ kind: 'boolean', default: false, label: 'Wedges in the side walls', group: 'Wedge' });
    for (const key of ['wedgeTopWidth', 'wedgeBottomWidth', 'wedgeDepth']) {
      const p = def.params.find((x) => x.key === key)!;
      expect(p).toMatchObject({ default: 0, group: 'Wedge' });
      expect(p.visibleIf!({ wedgePlates: true, wedgeSides: false })).toBe(true);
      expect(p.visibleIf!({ wedgePlates: false, wedgeSides: true })).toBe(true);
      expect(p.visibleIf!({ wedgePlates: false, wedgeSides: false, frontHeightPct: 100 })).toBe(false);
      // The widths also size the front access opening: shown while it is open.
      expect(p.visibleIf!({ wedgePlates: false, wedgeSides: false })).toBe(key !== 'wedgeDepth');
    }
  });

  it('validation: wedge sizes and the recess next to the pocket', () => {
    const msg = (p: ItemParams, wall = WALL, floor = FLOOR) => def.validate!(item(p, wall, floor)).join(' ');
    const g = tiltedGeom(item());
    // Lane 65.5, wall 1.6: the plate wedge top must stay below 62.3; the slot (31) below 27.8 with side wedges.
    expect(msg({ wedgeTopWidth: 62.3 })).toMatch(/Wedge top width \(62\.3 mm\) must be smaller than 62\.3 mm \(the lane width 65\.5 mm/);
    expect(def.validate!(item({ wedgeTopWidth: 62 }))).toEqual([]);
    expect(msg({ wedgeTopWidth: 30, wedgeSides: true })).toMatch(/smaller than 27\.8 mm \(the slot thickness 31 mm/);
    expect(def.validate!(item({ wedgeTopWidth: 30, wedgePlates: false, wedgeSides: false }))).toEqual([]);
    expect(msg({ wedgeTopWidth: 20, wedgeBottomWidth: 21 })).toMatch(/Wedge bottom width \(21 mm\) must not exceed the top width \(20 mm\)/);
    // Auto tops: plates 39.3, sides 18.6.
    expect(def.validate!(item({ wedgeBottomWidth: 19 }))).toEqual([]);
    expect(msg({ wedgeBottomWidth: 19, wedgeSides: true })).toMatch(/must not exceed the top width \(18\.6 mm\)/);
    expect(msg({ wedgeTopWidth: -1 })).toMatch(/Wedge top width must not be negative/);
    expect(msg({ wedgeDepth: -1 })).toMatch(/Wedge depth must not be negative/);
    const max = g.H - g.T * g.sin - 1;
    expect(msg({ wedgeDepth: 60 })).toMatch(new RegExp(`Wedge depth \\(60 mm\\) must not exceed ${Math.round(max * 100) / 100} mm`));
    expect(def.validate!(item({ wedgeDepth: Math.floor(max) }))).toEqual([]);
    expect(def.validate!(item({ wedgeDepth: Math.floor(max), wedgeSides: true }))).toEqual([]);
    // Both toggles off and the front closed: the wedge checks are skipped.
    expect(def.validate!(item({ wedgePlates: false, frontHeightPct: 100, wedgeTopWidth: 80, wedgeBottomWidth: 90, wedgeDepth: 100 }))).toEqual([]);
    // With the front open the widths size the access opening (still checked), the depth is not used.
    expect(msg({ wedgePlates: false, wedgeTopWidth: 80, wedgeDepth: 100 })).toMatch(/Wedge top width \(80 mm\) must be smaller than 62\.3 mm/);
    expect(msg({ wedgePlates: false, wedgeDepth: 100 })).toBe('');
    expect(def.validate!(item({ stackTop: 'lip', stackBottom: 'recess' }))).toEqual([]);
  });
});
