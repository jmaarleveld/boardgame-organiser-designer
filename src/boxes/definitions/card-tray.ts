import type { BoxTypeDefinition, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import type { Solid } from '../../geometry/types';
import {
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

const ORIENTATIONS = ['flat', 'upright'] as const;
type Orientation = (typeof ORIENTATIONS)[number];

/** Minimum finger notch depth. */
const MIN_NOTCH_DEPTH = 8;

/**
 * Geometry of a card tray.
 *
 * flat:    cards lie face up. Inner X = cardWidth + 2·clearance,
 *          inner Y = cardHeight + 2·clearance, inner Z = stackHeight.
 *          Notches in the two short walls (the walls parallel to X, at Y = 0
 *          and Y = max) so fingers reach the stack edges.
 * upright: cards stand portrait, faces pointing ±X, stacked along X.
 *          Inner X = stackHeight + clearance, inner Y = cardWidth + 2·clearance,
 *          inner Z = cardHeight − exposedHeight (the rest sticks out).
 *          Fingers pinch the stack front‑to‑back, so the notches go into the
 *          two walls the card faces look at: the walls parallel to Y (at X = 0
 *          and X = max), which are the long walls of this tray.
 *
 * Notch depth = max(innerHeight / 2, 8 mm), capped at innerHeight.
 */
function geom(item: ResolvedItem) {
  const cardW = num(item, 'cardWidth');
  const cardH = num(item, 'cardHeight');
  const c = num(item, 'clearance');
  const stack = num(item, 'stackHeight');
  const orientation = str<Orientation>(item, 'orientation', ORIENTATIONS, 'flat');
  const exposed = num(item, 'exposedHeight');
  const nw = num(item, 'notchWidth');
  const upright = orientation === 'upright';
  const iw = upright ? stack + c : cardW + 2 * c;
  const id = upright ? cardW + 2 * c : cardH + 2 * c;
  const ih = upright ? cardH - exposed : stack;
  const nd = Math.min(Math.max(ih / 2, MIN_NOTCH_DEPTH), ih);
  const notchAxis: 'x' | 'y' = upright ? 'y' : 'x';
  return { cardW, cardH, c, stack, orientation, upright, exposed, nw, iw, id, ih, nd, notchAxis, wall: item.wall, floor: item.floor, stacking: stacking(item) };
}

function notches(item: ResolvedItem): NotchSpec[] {
  const g = geom(item);
  if (!(g.nw > 0)) return [];
  return stackNotches(wallPairNotches(g.notchAxis, g.iw, g.id, g.ih, g.wall, g.floor, g.nw, g.nd), g.stacking);
}

export const cardTray: BoxTypeDefinition = {
  id: 'card-tray',
  name: 'Card tray',
  description: 'Holder for a stack of cards, lying flat or standing upright.',
  params: [
    { key: 'cardWidth', label: 'Card width', kind: 'number', default: 63.5, min: 1, step: 0.5, unit: 'mm', group: 'Cards' },
    { key: 'cardHeight', label: 'Card height', kind: 'number', default: 88, min: 1, step: 0.5, unit: 'mm', group: 'Cards' },
    {
      key: 'clearance',
      label: 'Clearance',
      kind: 'number',
      default: 1,
      min: 0,
      step: 0.1,
      unit: 'mm',
      group: 'Cards',
      help: 'Extra space on each side of the cards.',
    },
    {
      key: 'stackHeight',
      label: 'Stack thickness',
      kind: 'number',
      default: 30,
      min: 1,
      step: 0.5,
      unit: 'mm',
      group: 'Cards',
      help: 'Thickness of the card stack (sleeved cards are ~0.5 mm each).',
    },
    {
      key: 'orientation',
      label: 'Orientation',
      kind: 'select',
      default: 'flat',
      options: [
        { value: 'flat', label: 'Flat (face up)' },
        { value: 'upright', label: 'Upright (standing)' },
      ],
      group: 'Layout',
    },
    {
      key: 'exposedHeight',
      label: 'Exposed height',
      kind: 'number',
      default: 20,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Layout',
      help: 'How far the standing cards stick out above the walls.',
      visibleIf: (p) => p.orientation === 'upright',
    },
    {
      key: 'notchWidth',
      label: 'Notch width',
      kind: 'number',
      default: 25,
      min: 0,
      step: 0.5,
      unit: 'mm',
      group: 'Layout',
      help: '0 = no finger notches.',
    },
    ...stackingParams,
  ],
  newItemParams: { ...stackingNewItemParams },

  footprint(item) {
    const g = geom(item);
    return { width: g.iw + 2 * g.wall, depth: g.id + 2 * g.wall, height: stackedHeight(g.ih, g.floor, g.stacking) };
  },

  build(item, kernel) {
    const g = geom(item);
    const body = stackedOpenBox(kernel, g.iw, g.id, g.ih, g.wall, g.floor, g.stacking);
    const cutters = notches(item)
      .map((n) => notchCutter(kernel, n))
      .filter((s): s is Solid => s !== null);
    return cutters.length ? kernel.difference(body, cutters) : body;
  },

  draw(item) {
    const g = geom(item);
    const out: TopViewFeature[] = [{ kind: 'rect', role: 'cavity', x: g.wall, y: g.wall, w: g.iw, h: g.id }];
    for (const n of notches(item)) out.push(notchRect(n));
    return out;
  },

  validate(item) {
    const g = geom(item);
    const problems: string[] = [];
    requirePositive(problems, 'Card width', g.cardW);
    requirePositive(problems, 'Card height', g.cardH);
    requirePositive(problems, 'Stack thickness', g.stack);
    requirePositive(problems, 'Wall thickness', g.wall);
    requirePositive(problems, 'Floor thickness', g.floor);
    if (g.c < 0) problems.push(`Clearance must not be negative (is ${g.c}).`);
    if (g.upright) {
      if (g.exposed < 0) problems.push(`Exposed height must not be negative (is ${g.exposed}).`);
      if (g.ih <= 0) {
        problems.push(`Exposed height (${g.exposed} mm) must be smaller than the card height (${g.cardH} mm).`);
      }
    }
    if (g.nw < 0) problems.push(`Notch width must not be negative (is ${g.nw}).`);
    if (g.nw > 0 && g.ih > 0) {
      const span = g.notchAxis === 'x' ? g.iw : g.id;
      validateNotch(problems, g.nw, g.nd, span, g.ih, 'wall');
    }
    validateStacking(problems, g.stacking, g.wall, g.floor, g.iw, g.id, g.ih);
    return problems;
  },

  stackEngagement,

  bearingAreas(item) {
    const g = geom(item);
    return cavityBearingAreas(g.iw + 2 * g.wall, g.id + 2 * g.wall, g.wall, g.floor, g.ih, g.stacking);
  },

  baseFeatures(item) {
    const g = geom(item);
    return cavityBaseFeatures(g.iw + 2 * g.wall, g.id + 2 * g.wall, g.wall, g.stacking);
  },

  /**
   * Upright cards stand on the floor and stick out exposedHeight above the
   * wall top, i.e. exposedHeight − lipHeight above the outer top: the cavity
   * above the tray must stay free up to there.
   */
  keepOut(item) {
    const g = geom(item);
    if (!g.upright || !(g.ih > 0)) return [];
    const above = g.exposed - g.stacking.lipH;
    if (!(above > 0)) return [];
    return [{ x: g.wall, y: g.wall, width: g.iw, depth: g.id, height: above, name: 'standing cards', fix: 'lower the exposed height' }];
  },
};
