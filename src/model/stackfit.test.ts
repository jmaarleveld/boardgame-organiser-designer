import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearRegistry, registerBoxType } from '../boxes/registry';
import { itemTray } from '../boxes/definitions/item-tray';
import { cardTrayFlat } from '../boxes/definitions/card-tray-flat';
import { cardTrayUpright } from '../boxes/definitions/card-tray-upright';
import { trayParams } from './fakeBox.testutil';
import { platform } from '../boxes/definitions/platform';
import { spacer } from '../boxes/definitions/spacer';
import type { ItemParams, PlacedItem, ProjectSettings, Rotation } from './types';
import { DEFAULT_SETTINGS } from './types';
import { effectiveTop, itemsTooTall, layoutSummary, restingElevation, settle, stackFit, TIP_MARGIN_FRACTION } from './layout';


// Test tray (TRAY, an item tray): 63.2 × 43.2 outer, 31.2 high; +2 with a lip. Wall 1.6.
const settings: ProjectSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  box: { width: 400, depth: 400, height: 150 },
  tolerance: { x: 2, y: 2 },
};

const LIP = { stackTop: 'lip' };
const RECESS = { stackBottom: 'recess' };

function it_(id: string, type: string, x: number, y: number, params: ItemParams = {}, rotation: Rotation = 0): PlacedItem {
  return { id, type, label: id.toUpperCase(), x, y, rotation, params: trayParams(type, params) };
}

/** Put every item after the first `base` ones on what is below it, in order (restingElevation). */
function stack(items: PlacedItem[], base: number): PlacedItem[] {
  const out = items.map((i) => ({ ...i }));
  for (let k = base; k < out.length; k++) out[k].z = restingElevation(out[k].id, out, settings);
  return out;
}

const issuesOf = (items: PlacedItem[]) => layoutSummary(items, settings).issues;
const fitOf = (items: PlacedItem[], id: string) => stackFit(items, settings).find((f) => f.itemId === id);

beforeEach(() => {
  clearRegistry();
  for (const d of [itemTray, cardTrayFlat, cardTrayUpright, platform, spacer]) registerBoxType(d);
});

describe('stack fit: bearing on open trays', () => {
  it('three strips side by side across a big lip tray, front to back wall: fine', () => {
    const big = it_('big', 'item-tray', 1, 1, { ...LIP, innerWidth: 186.4, innerDepth: 126.8 });
    const strip = { ...RECESS, innerWidth: 60, innerDepth: 126.8 };
    const items = stack([big, it_('s1', 'item-tray', 1, 1, strip), it_('s2', 'item-tray', 64.2, 1, strip), it_('s3', 'item-tray', 127.4, 1, strip)], 1);
    expect(items[2].z).toBeCloseTo(31.2, 9);
    expect(issuesOf(items)).toEqual([]);
    expect(fitOf(items, 's2')?.bearing).toBe('ok');
  });

  it('2 × 2 grid on a big lip tray: every tray may tip (warning)', () => {
    const big = it_('big', 'item-tray', 1, 1, { ...LIP, innerWidth: 123.2, innerDepth: 83.2 });
    const grid = [
      [1, 1],
      [64.2, 1],
      [1, 44.2],
      [64.2, 44.2],
    ].map(([x, y], k) => it_(`g${k}`, 'item-tray', x, y, RECESS));
    const s = layoutSummary(stack([big, ...grid], 1), settings);
    expect(s.errorCount).toBe(0);
    expect(s.issues).toHaveLength(4);
    for (const i of s.issues) {
      expect(i).toMatchObject({ severity: 'warning', kind: 'unstable' });
      expect(i.message).toMatch(/^G\d may tip: it bears only on the (walls and lips|lips and walls) of BIG/);
    }
  });

  it('3 × 3 grid on a big lip tray: the middle rests on nothing (error), the rest may tip', () => {
    const big = it_('big', 'item-tray', 1, 1, { ...LIP, innerWidth: 186.4, innerDepth: 126.4 });
    const grid: PlacedItem[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push(it_(`g${r}${c}`, 'item-tray', 1 + c * 63.2, 1 + r * 43.2, RECESS));
    const items = stack([big, ...grid], 1);
    const s = layoutSummary(items, settings);
    expect(s.errorCount).toBe(1);
    expect(s.warningCount).toBe(8);
    const err = s.issues.find((i) => i.severity === 'error')!;
    expect(err).toMatchObject({ kind: 'stack-fit', itemIds: ['g11'] });
    expect(err.message).toBe(
      'G11 rests on nothing: it hangs over the open cavity of BIG. Move it so it reaches the walls of BIG, or put a platform under it.',
    );
    // No duplicate "Floating" message for the same item.
    expect(s.issues.filter((i) => i.itemIds.includes('g11'))).toHaveLength(1);
    expect(fitOf(items, 'g11')).toMatchObject({ bearing: 'none', supporterIds: ['big'], contact: [] });
  });

  it('a divided tray with full-height dividers carries a box over its middle compartment', () => {
    // 3 × 3 cells of 60 × 40 with 1.6 mm dividers; the box covers the middle one and its dividers.
    const div = { columns: 3, rows: 3, dividerThickness: 1.6 };
    const items = stack([it_('div', 'item-tray', 1, 1, div), it_('box', 'item-tray', 62.6, 42.6)], 1);
    expect(items[1].z).toBeCloseTo(31.2, 9);
    expect(issuesOf(items)).toEqual([]);
    // Low dividers carry nothing (the upright card tray is the type that can lower its dividers).
    const low = stack(
      [
        // Three 58.4 × 40 slots along X; the box sits inside the middle slot's Y span and only over a low divider in X.
        it_('div', 'card-tray-upright', 1, 1, { columns: 3, dividerHeight: 20, stackHeight: 58.4, clearance: 0, cardWidth: 40, cardHeight: 30, exposedHeight: 0, wedges: false, dividerThickness: 1.6 }),
        it_('box', 'item-tray', 62.6, 10.6, { innerDepth: 20 }),
      ],
      1,
    );
    expect(issuesOf(low).map((i) => i.message)).toEqual([
      'BOX rests on nothing: it hangs over the open cavity of DIV. Move it so it reaches the walls of DIV, or put a platform under it.',
    ]);
  });

  it('an overhanging tray resting on one wall may tip; one that is fully carried but overhangs is floating', () => {
    const items = stack([it_('lo', 'item-tray', 1, 1), it_('hi', 'item-tray', 31, 1)], 1);
    const s = layoutSummary(items, settings);
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0]).toMatchObject({ severity: 'warning', kind: 'unstable', itemIds: ['hi'] });
    // Wider tray on a same-width platform: bears well, but not fully covered → floating.
    const p = stack([it_('lo', 'item-tray', 1, 1), it_('p', 'platform', 1, 1, { width: 63.2, depth: 43.2 }), it_('hi', 'item-tray', 1, 1, { innerWidth: 80 })], 1);
    const sp = layoutSummary(p, settings);
    expect(sp.issues).toHaveLength(1);
    expect(sp.issues[0]).toMatchObject({ severity: 'warning', kind: 'floating', itemIds: ['hi'] });
  });

  it('the tip margin is TIP_MARGIN_FRACTION of the smaller side', () => {
    expect(TIP_MARGIN_FRACTION).toBe(0.1);
    // Spacer 40 deep carries a 40 × 40 spacer: contact x ∈ [0, 20 + d], centre at 20.
    const at = (d: number) =>
      stackFit(stack([it_('lo', 'spacer', 1, 1, { width: 20 + d, depth: 40, height: 10 }), it_('hi', 'spacer', 1, 1, { width: 40, depth: 40, height: 10 })], 1), settings)[0]
        .bearing;
    expect(at(3.9)).toBe('tip');
    expect(at(4.1)).toBe('ok');
  });

  it('platforms and spacers are solid tops', () => {
    const p = stack([it_('lo', 'item-tray', 1, 1, { innerWidth: 120, innerDepth: 120 }), it_('p', 'platform', 1, 1, { width: 123.2, depth: 123.2 }), it_('box', 'item-tray', 30, 40)], 1);
    expect(issuesOf(p)).toEqual([]);
    expect(fitOf(p, 'box')?.contactNames).toEqual(['plate']);
    const sp = stack([it_('sp', 'spacer', 1, 1, { width: 120, depth: 120, height: 20 }), it_('box', 'item-tray', 30, 40)], 1);
    expect(issuesOf(sp)).toEqual([]);
    expect(fitOf(sp, 'box')?.contactNames).toEqual(['top']);
  });
});

describe('stack fit: lip and recess alignment', () => {
  it('a recess whose edge sits on a wall without a lip is fine; lips inside the recess band are fine', () => {
    // Narrower recessed tray against the left wall of a lip tray: bears on three walls.
    const items = stack([it_('lo', 'item-tray', 1, 1, LIP), it_('hi', 'item-tray', 1, 1, { ...RECESS, innerWidth: 40 })], 1);
    expect(items[1].z).toBeCloseTo(31.2, 9);
    expect(issuesOf(items)).toEqual([]);
    // Recessed tray on a plain tray rests on top.
    const plain = stack([it_('lo', 'item-tray', 1, 1), it_('hi', 'item-tray', 1, 1, RECESS)], 1);
    expect(plain[1].z).toBeCloseTo(31.2, 9);
    expect(issuesOf(plain)).toEqual([]);
  });

  it('a lip under the floor of the tray above is an error', () => {
    // One wide recessed tray across two lip trays: the lips at the joint lie under its floor.
    const items = stack([it_('l', 'item-tray', 1, 1, LIP), it_('r', 'item-tray', 64.2, 1, LIP), it_('wide', 'item-tray', 1, 1, { ...RECESS, innerWidth: 123.2 })], 2);
    const s = layoutSummary(items, settings);
    expect(s.warningCount).toBe(0);
    expect(s.issues.map((i) => i.message)).toEqual([
      'WIDE collides with the lips of L: it lies under the floor of WIDE, not under its recess. Line up the edges of WIDE with the walls of L so the lips drop into the recess, or give WIDE a flat base.',
      'WIDE collides with the lips of R: it lies under the floor of WIDE, not under its recess. Line up the edges of WIDE with the walls of R so the lips drop into the recess, or give WIDE a flat base.',
    ]);
    expect(s.issues[0]).toMatchObject({ severity: 'error', kind: 'stack-fit', itemIds: ['wide', 'l'] });
    // A flat tray rests on the lips: fine.
    const flat = stack([items[0], items[1], it_('wide', 'item-tray', 1, 1, { innerWidth: 123.2 })], 2);
    expect(flat[2].z).toBeCloseTo(33.2, 9);
    expect(issuesOf(flat)).toEqual([]);
  });

  it('ridges of a platform lie inside the recesses of the items they locate', () => {
    const items = stack(
      [it_('a', 'item-tray', 1, 1, { innerWidth: 60, innerDepth: 80 }), it_('b', 'item-tray', 64.2, 1, { innerWidth: 60, innerDepth: 80 }),
        it_('p', 'platform', 1, 1, { width: 126.4, depth: 83.2 }), it_('t', 'item-tray', 2.2, 2.6, { ...RECESS, innerWidth: 56.8, innerDepth: 76.8 })],
      2,
    );
    expect(issuesOf(items)).toEqual([]);
  });
});

describe('stack fit: plugs and corner stops', () => {
  const PLUG = { stackBottom: 'plug' };

  it('a plug on a plain tray drops into its cavity: fine', () => {
    const items = stack([it_('lo', 'item-tray', 1, 1), it_('hi', 'item-tray', 1, 1, PLUG)], 1);
    expect(items[1].z).toBeCloseTo(29.2, 9);
    expect(issuesOf(items)).toEqual([]);
  });

  it('a plug on a divided tray hits the dividers (error)', () => {
    // 3 × 2 cells of 19.2 × 19.4 with 1.2 mm dividers: the same 63.2 × 43.2 outer as the tray above.
    const cells = { innerWidth: 19.2, innerDepth: 19.4, innerHeight: 25, columns: 3, rows: 2 };
    const items = stack([it_('lo', 'item-tray', 1, 1, cells), it_('hi', 'item-tray', 1, 1, PLUG)], 1);
    const s = layoutSummary(items, settings);
    expect(s.issues.map((i) => i.message)).toEqual([
      'HI: its plug does not fit into LO: it hits the dividers of LO. A plug needs an empty cavity below. Move HI so its plug drops into an open cavity, or give HI a base without plugs.',
    ]);
    expect(s.issues[0]).toMatchObject({ severity: 'error', kind: 'stack-fit', itemIds: ['hi', 'lo'] });
  });

  it('a plug on a spacer or a flat platform has no cavity (error); so do corner stops', () => {
    const sp = stack([it_('lo', 'spacer', 1, 1, { width: 63.2, depth: 43.2 }), it_('hi', 'item-tray', 1, 1, PLUG)], 1);
    expect(issuesOf(sp).map((i) => i.message)).toEqual([expect.stringMatching(/^HI: its plug does not fit into LO: it hits the top of LO\./)]);
    const pl = stack([it_('lo', 'platform', 1, 1, { width: 63.2, depth: 43.2, thickness: 5, cornerStops: false }), it_('hi', 'item-tray', 1, 1, PLUG)], 1);
    expect(issuesOf(pl).map((i) => i.message)).toEqual([expect.stringMatching(/^HI: its plug does not fit into LO: it hits the plate of LO\./)]);
    const stops = stack([it_('lo', 'spacer', 1, 1, { width: 100, depth: 100 }), it_('p', 'platform', 1, 1)], 1);
    expect(issuesOf(stops).map((i) => i.message)).toEqual([expect.stringMatching(/^P: its corner stop does not fit into LO/)]);
    // Corner stops inside the cavities of the trays below: fine.
    const ok = stack([it_('a', 'item-tray', 1, 1, { innerWidth: 40 }), it_('b', 'item-tray', 44.2, 1, { innerWidth: 40 }), it_('p', 'platform', 1, 1, { width: 86.4, depth: 43.2 })], 2);
    expect(issuesOf(ok)).toEqual([]);
  });
});

describe('stack fit: upright card trays keep the space above free', () => {

  it('an item on an upright card tray whose cards stick out is an error', () => {
    // 34.2 × 68.7 × 69.2, cards reach 20 mm higher.
    const items = stack([it_('cards', 'card-tray-upright', 1, 1), it_('lid', 'spacer', 1, 1, { width: 34.2, depth: 68.7, height: 5 })], 1);
    expect(items[1].z).toBeCloseTo(69.2, 9);
    const s = layoutSummary(items, settings);
    expect(s.issues.map((i) => i.message)).toEqual([
      'LID is in the way of the standing cards of CARDS, which stick out 20 mm above it. Move LID off CARDS, or lower the exposed height of CARDS.',
    ]);
    expect(s.issues[0]).toMatchObject({ severity: 'error', kind: 'stack-fit', itemIds: ['lid', 'cards'] });
    // High enough above the cards: fine (as far as the keep-out goes).
    const high = [items[0], { ...items[1], z: 89.2 }];
    expect(layoutSummary(high, settings).issues.some((i) => /in the way/.test(i.message))).toBe(false);
    // With a lip the cards stick out 2 mm less above the outer top.
    const lip = stack([it_('cards', 'card-tray-upright', 1, 1, LIP), it_('lid', 'spacer', 1, 1, { width: 34.2, depth: 68.7, height: 5 })], 1);
    expect(issuesOf(lip)[0].message).toMatch(/stick out 18 mm above it/);
  });

  it('exposed cards count for "too tall"', () => {
    const cards = it_('cards', 'card-tray-upright', 1, 1);
    const low = { ...settings, box: { ...settings.box, height: 80 } };
    expect(effectiveTop(cards, low, [cards])).toBeCloseTo(89.2, 9);
    expect(itemsTooTall([cards], low)).toEqual(['cards']);
    expect(layoutSummary([cards], low).issues.map((i) => i.message)).toEqual([
      'CARDS is too tall: its standing cards reach 89.2 mm > box 80 mm (the tray itself only 69.2 mm). Lower the exposed height of CARDS or use a taller game box.',
    ]);
    expect(itemsTooTall([cards], { ...settings, box: { ...settings.box, height: 90 } })).toEqual([]);
    // Flat card trays have no keep-out.
    const flat = it_('flat', 'card-tray-flat', 1, 1);
    expect(effectiveTop(flat, low, [flat])).toBeCloseTo(33.2, 9); // 1.2 floor + 2 groove + 30 stack
  });
});

describe('stack fit: rotation', () => {
  it('rotated strips across a rotated big lip tray are fine; a rotated 3 × 3 middle rests on nothing', () => {
    // Rotated 90: the big tray is 130 wide (x) and 189.6 deep (y).
    const big = it_('big', 'item-tray', 1, 1, { ...LIP, innerWidth: 186.4, innerDepth: 126.8 }, 90);
    const strip = { ...RECESS, innerWidth: 60, innerDepth: 126.8 };
    const items = stack([big, it_('s1', 'item-tray', 1, 1, strip, 90), it_('s2', 'item-tray', 1, 64.2, strip, 90), it_('s3', 'item-tray', 1, 127.4, strip, 90)], 1);
    expect(items[2].z).toBeCloseTo(31.2, 9);
    expect(issuesOf(items)).toEqual([]);

    const big9 = it_('big', 'item-tray', 1, 1, { ...LIP, innerWidth: 186.4, innerDepth: 126.4 }, 90);
    const grid: PlacedItem[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push(it_(`g${r}${c}`, 'item-tray', 1 + c * 43.2, 1 + r * 63.2, RECESS, 90));
    const s = layoutSummary(stack([big9, ...grid], 1), settings);
    expect(s.errorCount).toBe(1);
    expect(s.issues.find((i) => i.severity === 'error')?.itemIds).toEqual(['g11']);
    expect(s.warningCount).toBe(8);
  });

  it('a rotated recessed tray on an unrotated lip tray of the same footprint fits', () => {
    // 43.2 × 63.2 unrotated lip tray vs a 63.2 × 43.2 tray turned 90°.
    const items = stack([it_('lo', 'item-tray', 1, 1, { ...LIP, innerWidth: 40, innerDepth: 60 }), it_('hi', 'item-tray', 1, 1, RECESS, 90)], 1);
    expect(issuesOf(items)).toEqual([]);
    // Shifted by 10 mm the lip runs under its floor.
    const off = stack([items[0], it_('hi', 'item-tray', 1, 11, RECESS, 90)], 1);
    expect(issuesOf(off).some((i) => i.kind === 'stack-fit' && /collides with the lips of LO/.test(i.message))).toBe(true);
  });

  it('a rotated upright card tray keeps its rotated cavity free', () => {
    const cards = it_('cards', 'card-tray-upright', 1, 1, {}, 90); // 68.7 wide, 34.2 deep
    const beside = { ...it_('lid', 'spacer', 1, 36, { width: 68.7, depth: 10, height: 5 }), z: 70 };
    expect(issuesOf([cards, beside]).some((i) => /in the way/.test(i.message))).toBe(false);
    const over = { ...it_('lid', 'spacer', 30, 10, { width: 10, depth: 10, height: 5 }), z: 70 };
    expect(issuesOf([cards, over]).some((i) => /LID is in the way of the standing cards of CARDS/.test(i.message))).toBe(true);
  });
});

describe('examples/stacking-demo.json', () => {
  it('every item behaves as its label says: (OK), (warning), (error) or (flagged with X), as stored and once settled', () => {
    const project = JSON.parse(readFileSync('examples/stacking-demo.json', 'utf8')) as { settings: ProjectSettings; items: PlacedItem[] };
    // The app settles items by gravity on load; the stored z must already be that.
    const settled = settle(project.items, project.settings);
    expect(settled.map((i) => i.z ?? 0)).toEqual(project.items.map((i) => i.z ?? 0));
    const s = layoutSummary(settled, project.settings);
    const verdicts = project.items.map((item) => {
      const mine = s.issues.filter((i) => i.itemIds[0] === item.id);
      const involved = s.issues.filter((i) => i.itemIds.includes(item.id));
      const actual = mine.some((i) => i.severity === 'error')
        ? 'error'
        : mine.some((i) => i.severity === 'warning')
          ? 'warning'
          : involved.length
            ? `flagged with ${[...new Set(involved.map((i) => i.itemIds[0].toUpperCase()))].join(',')}`
            : 'OK';
      return `${item.label} → ${actual}`;
    });
    for (const v of verdicts) {
      const [label, actual] = v.split(' → ');
      expect(`${label} → ${actual}`).toBe(`${label} → ${/\(([^)]*)\)$/.exec(label)?.[1]}`);
    }
    expect(project.items.length).toBeGreaterThan(60);
  });
});
