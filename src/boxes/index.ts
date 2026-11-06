import { findBoxType, registerBoxType } from './registry';
import type { BoxTypeDefinition } from './types';
import { tray } from './definitions/tray';
import { dividedTray } from './definitions/divided-tray';
import { cardTray } from './definitions/card-tray';
import { spacer } from './definitions/spacer';
import { platform } from './definitions/platform';
import { itemTray } from './definitions/item-tray';
import { cardTrayFlat } from './definitions/card-tray-flat';
import { cardTrayUpright } from './definitions/card-tray-upright';
import { cardTrayTilted } from './definitions/card-tray-tilted';

export { itemTray, cardTrayFlat, cardTrayUpright, cardTrayTilted, tray, dividedTray, cardTray, spacer, platform };

/**
 * All standard box types, in palette order: the containers v2 set (built on
 * the tiling framework, docs-containers.md) first, then the v1 types.
 */
export const standardBoxTypes: readonly BoxTypeDefinition[] = [itemTray, cardTrayFlat, cardTrayUpright, cardTrayTilted, tray, dividedTray, cardTray, spacer, platform];

/** Register every standard box type. Idempotent: already registered ids are skipped. */
export function registerAllBoxTypes(): void {
  for (const def of standardBoxTypes) {
    if (!findBoxType(def.id)) registerBoxType(def);
  }
}
