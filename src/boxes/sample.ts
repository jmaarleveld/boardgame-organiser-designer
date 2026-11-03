import { createEmptyProject, type PlacedItem, type Project } from '../model/types';

/**
 * Demo project: one of each standard box type (card tray in both orientations)
 * in a 290 × 290 × 70 mm game box, non‑overlapping and inside the usable area
 * (tolerance 2 mm → usable area starts at 1 mm). Outer footprints with the
 * default 1.6 mm wall / 1.2 mm floor are noted per item.
 * It also demonstrates stacking: a lip tray with a recessed tray on top, and a
 * platform resting on two trays carrying a third tray.
 * Call registerAllBoxTypes() before resolving these items.
 */
export function sampleProject(): Project {
  const project = createEmptyProject();
  project.settings.name = 'Sample insert';
  project.settings.box = { width: 290, depth: 290, height: 70 };
  const items: PlacedItem[] = [
    // 63.2 × 43.2 × 31.2
    { id: 'sample-tray', type: 'tray', label: 'Tokens', x: 1, y: 1, rotation: 0, params: {} },
    // 93.2 × 63.2 × 26.2
    { id: 'sample-divided', type: 'divided-tray', label: 'Resources', x: 70, y: 1, rotation: 0, params: { columns: 3, rows: 2 } },
    // 68.7 × 93.2 × 31.2
    { id: 'sample-cards-flat', type: 'card-tray', label: 'Cards (flat)', x: 1, y: 70, rotation: 0, params: { orientation: 'flat' } },
    // Mini cards (41 × 63) standing: 34.2 × 46.2 × 49.2, the cards reach 64.2 (< 70).
    // Standard 88 mm cards cannot stand in a 70 mm box (the stack fit check flags them).
    {
      id: 'sample-cards-upright',
      type: 'card-tray',
      label: 'Mini cards (upright)',
      x: 80,
      y: 70,
      rotation: 0,
      params: { orientation: 'upright', cardWidth: 41, cardHeight: 63, exposedHeight: 15 },
    },
    // 20 × 40 × 30
    { id: 'sample-spacer', type: 'spacer', label: 'Spacer', x: 120, y: 70, rotation: 0, params: {} },
    // Lip / recess pair. 63.2 × 43.2 × 33.2 (31.2 + 2 mm lip)
    { id: 'sample-lip', type: 'tray', label: 'Dice', x: 170, y: 1, rotation: 0, params: { stackTop: 'lip' } },
    // 63.2 × 43.2 × 31.2, recessed base engages the 2 mm lip → z = 33.2 − 2
    {
      id: 'sample-recess',
      type: 'tray',
      label: 'Dice (level 2)',
      x: 170,
      y: 1,
      z: 31.2,
      rotation: 0,
      params: { stackBottom: 'recess' },
    },
    // Two plain trays bridged by a platform. 63.2 × 43.2 × 31.2 each
    { id: 'sample-base-a', type: 'tray', label: 'Meeples A', x: 1, y: 170, rotation: 0, params: {} },
    { id: 'sample-base-b', type: 'tray', label: 'Meeples B', x: 64.2, y: 170, rotation: 0, params: {} },
    // 126.4 × 43.2 × 4 (2 mm plate on 2 mm corner stops) → z = 31.2 − 2, top 33.2
    {
      id: 'sample-platform',
      type: 'platform',
      label: 'Platform',
      x: 1,
      y: 170,
      z: 29.2,
      rotation: 0,
      params: { width: 126.4, depth: 43.2 },
    },
    // 63.2 × 43.2 × 31.2 on the platform → top 64.4
    { id: 'sample-top', type: 'tray', label: 'Bits', x: 1, y: 170, z: 33.2, rotation: 0, params: {} },
  ];
  project.items = items;
  return project;
}
