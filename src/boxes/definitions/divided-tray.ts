import type { BoxTypeDefinition, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { Solid } from '../../geometry/types';
import { bool, EPS, notchCutter, notchRect, num, openBox, requirePositive, validateNotch, type NotchSpec } from './common';

/**
 * Layout of a divided tray. Columns split along X (dividers parallel to Y),
 * rows split along Y (dividers parallel to X). All compartments are equal.
 */
function layout(item: ResolvedItem) {
  const iw = num(item, 'innerWidth');
  const id = num(item, 'innerDepth');
  const ih = num(item, 'innerHeight');
  const cols = Math.max(1, Math.round(num(item, 'columns', 1)));
  const rows = Math.max(1, Math.round(num(item, 'rows', 1)));
  const t = num(item, 'dividerThickness');
  const dhRaw = num(item, 'dividerHeight');
  // 0 (or unset) means full inner height.
  const dh = dhRaw > 0 ? Math.min(dhRaw, ih) : ih;
  const wall = item.wall;
  const floor = item.floor;
  const cw = (iw - (cols - 1) * t) / cols;
  const cd = (id - (rows - 1) * t) / rows;
  /** X of the min face of column divider i (1..cols-1). */
  const colX = (i: number) => wall + i * cw + (i - 1) * t;
  /** Y of the min face of row divider j (1..rows-1). */
  const rowY = (j: number) => wall + j * cd + (j - 1) * t;
  return {
    iw, id, ih, cols, rows, t, dh, dhRaw, wall, floor, cw, cd, colX, rowY,
    notch: bool(item, 'fingerNotch'),
    nw: num(item, 'notchWidth'),
    nd: num(item, 'notchDepth'),
  };
}

/**
 * Finger notches run along X: the two outer walls parallel to Y and every
 * column divider get one notch per row, centred on that row's compartment.
 * Notches in dividers are measured from the divider top.
 */
function notches(item: ResolvedItem): NotchSpec[] {
  const L = layout(item);
  if (!L.notch) return [];
  const out: NotchSpec[] = [];
  const wallTop = L.ih + L.floor;
  const divTop = L.floor + L.dh;
  for (let j = 0; j < L.rows; j++) {
    const center = L.wall + j * (L.cd + L.t) + L.cd / 2;
    const base = { axis: 'y' as const, center, width: L.nw };
    out.push({ ...base, wallPos: 0, thickness: L.wall, top: wallTop, depth: L.nd });
    out.push({ ...base, wallPos: L.wall + L.iw, thickness: L.wall, top: wallTop, depth: L.nd });
    for (let i = 1; i < L.cols; i++) {
      out.push({ ...base, wallPos: L.colX(i), thickness: L.t, top: divTop, depth: Math.min(L.nd, L.dh) });
    }
  }
  return out;
}

export const dividedTray: BoxTypeDefinition = {
  id: 'divided-tray',
  name: 'Divided tray',
  description: 'Tray with a grid of equal compartments.',
  params: [
    { key: 'innerWidth', label: 'Inner width', kind: 'number', default: 90, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'innerDepth', label: 'Inner depth', kind: 'number', default: 60, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'innerHeight', label: 'Inner height', kind: 'number', default: 25, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'columns', label: 'Columns', kind: 'number', default: 3, min: 1, max: 20, step: 1, unit: 'count', group: 'Compartments' },
    { key: 'rows', label: 'Rows', kind: 'number', default: 2, min: 1, max: 20, step: 1, unit: 'count', group: 'Compartments' },
    {
      key: 'dividerThickness',
      label: 'Divider thickness',
      kind: 'number',
      default: 1.2,
      min: 0.4,
      step: 0.1,
      unit: 'mm',
      group: 'Compartments',
    },
    {
      key: 'dividerHeight',
      label: 'Divider height',
      kind: 'number',
      default: 0,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Compartments',
      help: 'Height above the floor; 0 = full inner height.',
    },
    { key: 'fingerNotch', label: 'Finger notches', kind: 'boolean', default: false, group: 'Finger notch',
      help: 'One notch per row in the left/right walls and every column divider.' },
    {
      key: 'notchWidth',
      label: 'Notch width',
      kind: 'number',
      default: 18,
      min: 1,
      step: 0.5,
      unit: 'mm',
      group: 'Finger notch',
      visibleIf: (p) => p.fingerNotch === true,
    },
    {
      key: 'notchDepth',
      label: 'Notch depth',
      kind: 'number',
      default: 12,
      min: 1,
      step: 0.5,
      unit: 'mm',
      group: 'Finger notch',
      visibleIf: (p) => p.fingerNotch === true,
    },
  ],

  footprint(item) {
    const L = layout(item);
    return { width: L.iw + 2 * L.wall, depth: L.id + 2 * L.wall, height: L.ih + L.floor };
  },

  build(item, kernel) {
    const L = layout(item);
    const body = openBox(kernel, L.iw, L.id, L.ih, L.wall, L.floor);
    const dividers: Solid[] = [];
    // Dividers overlap the floor and walls by EPS so the union is clean.
    const z0 = L.floor - EPS;
    const h = L.dh + EPS;
    for (let i = 1; i < L.cols; i++) {
      dividers.push(kernel.box(L.t, L.id + 2 * EPS, h, [L.colX(i), L.wall - EPS, z0]));
    }
    for (let j = 1; j < L.rows; j++) {
      dividers.push(kernel.box(L.iw + 2 * EPS, L.t, h, [L.wall - EPS, L.rowY(j), z0]));
    }
    let solid = dividers.length ? kernel.union([body, ...dividers]) : body;
    const cutters = notches(item)
      .map((n) => notchCutter(kernel, n))
      .filter((s): s is Solid => s !== null);
    if (cutters.length) solid = kernel.difference(solid, cutters);
    return solid;
  },

  draw(item) {
    const L = layout(item);
    const out: TopViewFeature[] = [];
    for (let i = 0; i < L.cols; i++) {
      for (let j = 0; j < L.rows; j++) {
        out.push({
          kind: 'rect',
          role: 'cavity',
          x: L.wall + i * (L.cw + L.t),
          y: L.wall + j * (L.cd + L.t),
          w: L.cw,
          h: L.cd,
        });
      }
    }
    for (let i = 1; i < L.cols; i++) {
      out.push({ kind: 'rect', role: 'divider', x: L.colX(i), y: L.wall, w: L.t, h: L.id });
    }
    for (let j = 1; j < L.rows; j++) {
      out.push({ kind: 'rect', role: 'divider', x: L.wall, y: L.rowY(j), w: L.iw, h: L.t });
    }
    for (const n of notches(item)) out.push(notchRect(n));
    return out;
  },

  validate(item) {
    const L = layout(item);
    const problems: string[] = [];
    requirePositive(problems, 'Inner width', L.iw);
    requirePositive(problems, 'Inner depth', L.id);
    requirePositive(problems, 'Inner height', L.ih);
    requirePositive(problems, 'Wall thickness', L.wall);
    requirePositive(problems, 'Floor thickness', L.floor);
    const cols = num(item, 'columns', 1);
    const rows = num(item, 'rows', 1);
    if (!(cols >= 1) || !Number.isInteger(cols)) problems.push(`Columns must be a whole number ≥ 1 (is ${cols}).`);
    if (!(rows >= 1) || !Number.isInteger(rows)) problems.push(`Rows must be a whole number ≥ 1 (is ${rows}).`);
    if (L.cols > 1 || L.rows > 1) requirePositive(problems, 'Divider thickness', L.t);
    if (L.dhRaw < 0) problems.push(`Divider height must not be negative (is ${L.dhRaw}).`);
    if (L.dhRaw > L.ih) {
      problems.push(`Divider height (${L.dhRaw} mm) must not exceed the inner height (${L.ih} mm).`);
    }
    if (L.cw <= 0) {
      problems.push(`Dividers are too thick: ${L.cols} columns of ${L.t} mm dividers do not fit in ${L.iw} mm.`);
    }
    if (L.cd <= 0) {
      problems.push(`Dividers are too thick: ${L.rows} rows of ${L.t} mm dividers do not fit in ${L.id} mm.`);
    }
    if (L.cw > 0 && L.cd > 0 && ((L.cols > 1 && L.t > L.cw) || (L.rows > 1 && L.t > L.cd))) {
      problems.push(`Dividers (${L.t} mm) are thicker than the compartments they separate.`);
    }
    if (L.notch && L.cd > 0) {
      validateNotch(problems, L.nw, L.nd, L.cd, L.ih, 'compartment side');
    }
    return problems;
  },
};
