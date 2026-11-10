import type { BoxTypeDefinition } from '../types';
import type { ResolvedItem } from '../../model/types';
import { num, requirePositive, roundEdit } from './common';

function size(item: ResolvedItem) {
  return { w: num(item, 'width'), d: num(item, 'depth'), h: num(item, 'height') };
}

/** Solid filler block. Wall and floor thickness are ignored. */
export const spacer: BoxTypeDefinition = {
  id: 'spacer',
  name: 'Spacer',
  description: 'Solid filler block to take up slack.',
  params: [
    { key: 'width', label: 'Width', kind: 'number', default: 20, min: 0.5, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'depth', label: 'Depth', kind: 'number', default: 40, min: 0.5, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'height', label: 'Height', kind: 'number', default: 30, min: 0.5, step: 0.5, unit: 'mm', group: 'Size' },
  ],

  footprint(item) {
    const s = size(item);
    return { width: s.w, depth: s.d, height: s.h };
  },

  build(item, kernel) {
    const s = size(item);
    return kernel.box(s.w, s.d, s.h);
  },

  draw(item) {
    const s = size(item);
    return [{ kind: 'rect', role: 'solid', x: 0, y: 0, w: s.w, h: s.d }];
  },

  /** Solid block: the whole top bears. */
  bearingAreas(item) {
    const s = size(item);
    return [{ x: 0, y: 0, width: s.w, depth: s.d, height: s.h, name: 'top' }];
  },

  raise: (item, by) => ({ params: { height: roundEdit(size(item).h + by) } }),

  validate(item) {
    const s = size(item);
    const problems: string[] = [];
    requirePositive(problems, 'Width', s.w);
    requirePositive(problems, 'Depth', s.d);
    requirePositive(problems, 'Height', s.h);
    return problems;
  },
};
