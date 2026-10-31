import { findBoxType, registerBoxType } from './registry';
import type { BoxTypeDefinition } from './types';
import { tray } from './definitions/tray';
import { dividedTray } from './definitions/divided-tray';
import { cardTray } from './definitions/card-tray';
import { spacer } from './definitions/spacer';

export { tray, dividedTray, cardTray, spacer };

/** All standard box types, in palette order. */
export const standardBoxTypes: readonly BoxTypeDefinition[] = [tray, dividedTray, cardTray, spacer];

/** Register every standard box type. Idempotent: already registered ids are skipped. */
export function registerAllBoxTypes(): void {
  for (const def of standardBoxTypes) {
    if (!findBoxType(def.id)) registerBoxType(def);
  }
}
