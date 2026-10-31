import type { BoxTypeDefinition, TopViewFeature } from '../types';
import type { ResolvedItem } from '../../model/types';
import { bool, EPS, num, requirePositive, round } from './common';

/**
 * Flat plate that bridges several trays and carries the next level.
 * Optional corner stops: four small blocks under the plate, inset by
 * `stopInset` (≈ wall + clearance of the trays below) so they drop just inside
 * the cavities underneath and keep the plate from sliding. Local frame: the
 * stops stand on Z = 0, the plate starts at Z = stopHeight (0 without stops).
 * Wall and floor thickness are ignored.
 */
function geom(item: ResolvedItem) {
  const stops = bool(item, 'cornerStops', true);
  const stopSize = num(item, 'stopSize');
  const stopHeight = num(item, 'stopHeight');
  return {
    w: num(item, 'width'),
    d: num(item, 'depth'),
    t: num(item, 'thickness'),
    stops,
    stopSize,
    stopHeight,
    stopInset: num(item, 'stopInset'),
    /** Height of the stops actually present. */
    sh: stops ? Math.max(0, stopHeight) : 0,
  };
}

/** Min corners (local XY) of the four stops. */
function stopCorners(g: ReturnType<typeof geom>): [number, number][] {
  const a = g.stopInset;
  const bx = g.w - g.stopInset - g.stopSize;
  const by = g.d - g.stopInset - g.stopSize;
  return [
    [a, a],
    [bx, a],
    [a, by],
    [bx, by],
  ];
}

export const platform: BoxTypeDefinition = {
  id: 'platform',
  name: 'Platform',
  description: 'Flat plate spanning several trays to carry the next level, with optional corner stops.',
  params: [
    { key: 'width', label: 'Width', kind: 'number', default: 100, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'depth', label: 'Depth', kind: 'number', default: 100, min: 1, step: 0.5, unit: 'mm', group: 'Size' },
    { key: 'thickness', label: 'Thickness', kind: 'number', default: 2, min: 0.4, step: 0.1, unit: 'mm', group: 'Size' },
    {
      key: 'cornerStops',
      label: 'Corner stops',
      kind: 'boolean',
      default: true,
      group: 'Corner stops',
      help: 'Small blocks under the corners that drop just inside the cavities below.',
    },
    {
      key: 'stopSize',
      label: 'Stop size',
      kind: 'number',
      default: 6,
      min: 0.5,
      step: 0.5,
      unit: 'mm',
      group: 'Corner stops',
      visibleIf: (p) => p.cornerStops !== false,
    },
    {
      key: 'stopHeight',
      label: 'Stop height',
      kind: 'number',
      default: 2,
      min: 0.2,
      step: 0.1,
      unit: 'mm',
      group: 'Corner stops',
      visibleIf: (p) => p.cornerStops !== false,
    },
    {
      key: 'stopInset',
      label: 'Stop inset',
      kind: 'number',
      default: 1.75,
      min: 0,
      step: 0.05,
      unit: 'mm',
      group: 'Corner stops',
      help: 'Distance from the plate edge: wall + clearance of the trays below.',
      visibleIf: (p) => p.cornerStops !== false,
    },
  ],

  footprint(item) {
    const g = geom(item);
    return { width: g.w, depth: g.d, height: g.t + g.sh };
  },

  build(item, kernel) {
    const g = geom(item);
    const plate = kernel.box(g.w, g.d, g.t, [0, 0, g.sh]);
    if (!(g.sh > 0) || !(g.stopSize > 0)) return plate;
    // Stops overlap the plate by EPS so the union is clean.
    const stops = stopCorners(g).map(([x, y]) => kernel.box(g.stopSize, g.stopSize, g.sh + EPS, [x, y, 0]));
    return kernel.union([plate, ...stops]);
  },

  draw(item) {
    const g = geom(item);
    const out: TopViewFeature[] = [{ kind: 'rect', role: 'solid', x: 0, y: 0, w: g.w, h: g.d }];
    if (g.sh > 0 && g.stopSize > 0) {
      for (const [x, y] of stopCorners(g)) out.push({ kind: 'rect', role: 'divider', x, y, w: g.stopSize, h: g.stopSize });
    }
    return out;
  },

  validate(item) {
    const g = geom(item);
    const problems: string[] = [];
    requirePositive(problems, 'Width', g.w);
    requirePositive(problems, 'Depth', g.d);
    requirePositive(problems, 'Thickness', g.t);
    if (g.stops) {
      requirePositive(problems, 'Stop size', g.stopSize);
      requirePositive(problems, 'Stop height', g.stopHeight);
      if (g.stopInset < 0) problems.push(`Stop inset must not be negative (is ${g.stopInset}).`);
      const need = 2 * (g.stopInset + g.stopSize);
      if (need > Math.min(g.w, g.d)) {
        problems.push(`Corner stops (2 × (${g.stopInset} + ${g.stopSize}) = ${round(need)} mm) do not fit on the plate.`);
      }
    }
    return problems;
  },

  stackEngagement(item) {
    return geom(item).sh;
  },
};
