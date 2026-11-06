import { findBoxType, registerBoxType } from './registry';
import type { BoxTypeDefinition } from './types';
import { spacer } from './definitions/spacer';
import { platform } from './definitions/platform';
import { itemTray } from './definitions/item-tray';
import { cardTrayFlat } from './definitions/card-tray-flat';
import { cardTrayUpright } from './definitions/card-tray-upright';
import { cardTrayTilted } from './definitions/card-tray-tilted';

export { itemTray, cardTrayFlat, cardTrayUpright, cardTrayTilted, spacer, platform };

/**
 * All standard box types, in palette order: the containers set (built on the
 * tiling framework, docs-containers.md), then spacer and platform. The v1
 * `tray`, `divided-tray` and `card-tray` were deleted on 2026-11-06; saved
 * projects are migrated on load (`migrateLegacyItem` in services/persistence).
 */
export const standardBoxTypes: readonly BoxTypeDefinition[] = [itemTray, cardTrayFlat, cardTrayUpright, cardTrayTilted, spacer, platform];

/** Register every standard box type. Idempotent: already registered ids are skipped. */
export function registerAllBoxTypes(): void {
  for (const def of standardBoxTypes) {
    if (!findBoxType(def.id)) registerBoxType(def);
  }
}
