import type { BoxTypeDefinition, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { Solid } from '../../geometry/types';
import {
  bool,
  cavityBaseFeatures,
  cavityBearingAreas,
  notchCutter,
  notchRect,
  num,
  requirePositive,
  stackEngagement,
  stackedHeight,
  stackedOpenBox,
  stacking,
  stackingParams,
  stackingNewItemParams,
  stackNotches,
  str,
  validateNotch,
  validateStacking,
  wallPairNotches,
  type NotchSpec,
} from './common';

const SIDES = ['long', 'short', 'both'] as const;
type NotchSides = (typeof SIDES)[number];

function dims(item: ResolvedItem) {
  return {
    iw: num(item, 'innerWidth'),
    id: num(item, 'innerDepth'),
    ih: num(item, 'innerHeight'),
    wall: item.wall,
    floor: item.floor,
    notch: bool(item, 'fingerNotch'),
    nw: num(item, 'notchWidth'),
    nd: num(item, 'notchDepth'),
    sides: str<NotchSides>(item, 'notchSides', SIDES, 'long'),
    stack: stacking(item),
  };
}

/**
 * Notches for the chosen wall pairs. "Long" walls are the pair running along
 * the longer inner side (walls parallel to X when innerWidth >= innerDepth).
 */
function notches(item: ResolvedItem): NotchSpec[] {
  const d = dims(item);
  if (!d.notch) return [];
  const longAxis: 'x' | 'y' = d.iw >= d.id ? 'x' : 'y';
  const shortAxis: 'x' | 'y' = longAxis === 'x' ? 'y' : 'x';
  const axes: ('x' | 'y')[] =
    d.sides === 'long' ? [longAxis] : d.sides === 'short' ? [shortAxis] : [longAxis, shortAxis];
  return stackNotches(
    axes.flatMap((axis) => wallPairNotches(axis, d.iw, d.id, d.ih, d.wall, d.floor, d.nw, d.nd)),
    d.stack,
  );
}

export const tray: BoxTypeDefinition = {
  id: 'tray',
  name: 'Tray',
  description: 'Plain open‑top tray with optional finger notches.',
  params: [
    { key: 'innerWidth', label: 'Inner width', kind: 'number', default: 60, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'innerDepth', label: 'Inner depth', kind: 'number', default: 40, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'innerHeight', label: 'Inner height', kind: 'number', default: 30, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'fingerNotch', label: 'Finger notches', kind: 'boolean', default: true, group: 'Finger notch' },
    {
      key: 'notchSides',
      label: 'Notched walls',
      kind: 'select',
      default: 'long',
      options: [
        { value: 'long', label: 'Long walls' },
        { value: 'short', label: 'Short walls' },
        { value: 'both', label: 'All walls' },
      ],
      group: 'Finger notch',
      visibleIf: (p) => p.fingerNotch !== false,
    },
    {
      key: 'notchWidth',
      label: 'Notch width',
      kind: 'number',
      default: 20,
      min: 1,
      step: 0.5,
      unit: 'mm',
      group: 'Finger notch',
      visibleIf: (p) => p.fingerNotch !== false,
    },
    {
      key: 'notchDepth',
      label: 'Notch depth',
      kind: 'number',
      default: 15,
      min: 1,
      step: 0.5,
      unit: 'mm',
      group: 'Finger notch',
      help: 'Measured down from the top edge.',
      visibleIf: (p) => p.fingerNotch !== false,
    },
    ...stackingParams,
  ],
  newItemParams: { ...stackingNewItemParams },

  footprint(item) {
    const d = dims(item);
    return { width: d.iw + 2 * d.wall, depth: d.id + 2 * d.wall, height: stackedHeight(d.ih, d.floor, d.stack) };
  },

  build(item, kernel) {
    const d = dims(item);
    const body = stackedOpenBox(kernel, d.iw, d.id, d.ih, d.wall, d.floor, d.stack);
    const cutters = notches(item)
      .map((n) => notchCutter(kernel, n))
      .filter((s): s is Solid => s !== null);
    return cutters.length ? kernel.difference(body, cutters) : body;
  },

  draw(item) {
    const d = dims(item);
    const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: d.wall, y: d.wall, w: d.iw, h: d.id }];
    for (const n of notches(item)) out.push(notchRect(n));
    return out;
  },

  validate(item) {
    const d = dims(item);
    const problems: string[] = [];
    requirePositive(problems, 'Inner width', d.iw);
    requirePositive(problems, 'Inner depth', d.id);
    requirePositive(problems, 'Inner height', d.ih);
    requirePositive(problems, 'Wall thickness', d.wall);
    requirePositive(problems, 'Floor thickness', d.floor);
    if (d.notch) {
      const longSpan = Math.max(d.iw, d.id);
      const shortSpan = Math.min(d.iw, d.id);
      const span = d.sides === 'long' ? longSpan : shortSpan;
      validateNotch(problems, d.nw, d.nd, span, d.ih, d.sides === 'long' ? 'long wall' : 'short wall');
    }
    validateStacking(problems, d.stack, d.wall, d.floor, d.iw, d.id, d.ih);
    return problems;
  },

  stackEngagement,

  bearingAreas(item) {
    const d = dims(item);
    return cavityBearingAreas(d.iw + 2 * d.wall, d.id + 2 * d.wall, d.wall, d.floor, d.ih, d.stack);
  },

  baseFeatures(item) {
    const d = dims(item);
    return cavityBaseFeatures(d.iw + 2 * d.wall, d.id + 2 * d.wall, d.wall, d.stack);
  },
};
