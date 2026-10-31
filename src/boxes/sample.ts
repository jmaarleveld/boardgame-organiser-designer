import { createEmptyProject, type PlacedItem, type Project } from '../model/types';

/**
 * Demo project: one of each standard box type (card tray in both orientations)
 * in a 290 × 290 × 70 mm game box, non‑overlapping and inside the usable area
 * (tolerance 2 mm → usable area starts at 1 mm). Outer footprints with the
 * default 1.6 mm wall / 1.2 mm floor are noted per item.
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
    // 34.2 × 68.7 × 69.2
    { id: 'sample-cards-upright', type: 'card-tray', label: 'Cards (upright)', x: 80, y: 70, rotation: 0, params: { orientation: 'upright' } },
    // 20 × 40 × 30
    { id: 'sample-spacer', type: 'spacer', label: 'Spacer', x: 120, y: 70, rotation: 0, params: {} },
  ];
  project.items = items;
  return project;
}
