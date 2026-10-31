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
};
