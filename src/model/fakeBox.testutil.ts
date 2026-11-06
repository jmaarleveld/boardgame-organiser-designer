import type { BoxTypeDefinition } from '../boxes/types';
import type { Solid } from '../geometry/types';

/** Minimal box type for UI/layout tests: footprint = (w, d, h) params. */
export const fakeBox: BoxTypeDefinition = {
  id: 'fake',
  name: 'Tray',
  description: 'Test box',
  params: [
    { key: 'w', label: 'W', kind: 'number', default: 40 },
    { key: 'd', label: 'D', kind: 'number', default: 20 },
    { key: 'h', label: 'H', kind: 'number', default: 10 },
  ],
  footprint: (item) => ({ width: Number(item.params.w), depth: Number(item.params.d), height: Number(item.params.h) }),
  build: () => ({}) as Solid,
  draw: () => [],
  validate: (item) => (Number(item.params.w) < 5 ? ['too narrow'] : []),
  /** Optional `e` param (not in the spec, so it never appears in default params). */
  stackEngagement: (item) => (typeof item.params.e === 'number' ? item.params.e : 0),
};

/**
 * Params of the real tray the model tests use: a 1 × 1 item tray with a
 * 60 × 40 × 30 cavity, 63.2 × 43.2 × 31.2 outer with the default 1.6 mm wall
 * and 1.2 mm floor (+2 mm with a lip).
 */
export const TRAY = { innerWidth: 60, innerDepth: 40, innerHeight: 30 };

/** `params` with the TRAY size underneath when `type` is an item tray. */
export function trayParams<P extends Record<string, unknown>>(type: string, params: P): P {
  return type === 'item-tray' ? { ...TRAY, ...params } : params;
}
