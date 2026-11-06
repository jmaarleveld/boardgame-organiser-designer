/**
 * Every standard box type, built over the edges of its parameter ranges.
 *
 * Invariant: a build never yields a silently empty / invalid solid. It
 * succeeds with a valid solid whenever the item's own `validate` reports no
 * problems; only an item that `validate` flags may throw (the kernel rejects
 * non-positive sizes, see src/geometry/guards.ts). Cutters that can become
 * empty for in-range parameters must be skipped by the definition, not passed
 * to the kernel with a zero / negative size.
 *
 * Each numeric parameter takes min / default / max (a value well above the
 * default when the spec has no max), one at a time, crossed with every
 * single boolean toggle and select option.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../geometry/kernel';
import type { GeometryKernel } from '../geometry/types';
import type { ItemParams, ParamValue, ResolvedItem } from '../model/types';
import { newItemParams, type BoxTypeDefinition, type ParamSpec } from './types';
import { standardBoxTypes } from './index';

let k: GeometryKernel;
beforeAll(async () => {
  k = await createKernel();
});

type NumberSpec = Extract<ParamSpec, { kind: 'number' }>;

function numberValues(p: NumberSpec): number[] {
  const lo = p.min ?? 0;
  const hi = p.max ?? (p.unit === 'count' ? lo + 3 : Math.max(p.default * 3, lo + 10));
  return [...new Set([lo, p.default, hi])];
}

/** The defaults, then each boolean flipped and each select option, one at a time. */
function variants(def: BoxTypeDefinition, base: ItemParams): ItemParams[] {
  const out: ItemParams[] = [base];
  for (const p of def.params) {
    if (p.kind === 'boolean') out.push({ ...base, [p.key]: !base[p.key] });
    if (p.kind === 'select') {
      for (const o of p.options) if (o.value !== base[p.key]) out.push({ ...base, [p.key]: o.value });
    }
  }
  return out;
}

function item(def: BoxTypeDefinition, params: ItemParams, wall = 1.6, floor = 1.2): ResolvedItem {
  return { id: 'x', type: def.id, label: def.name, wall, floor, params };
}

/** Problem string for a build that breaks the invariant, or null. */
function check(def: BoxTypeDefinition, it: ResolvedItem): string | null {
  const flagged = (def.validate?.(it) ?? []).length > 0;
  try {
    const s = def.build(it, k);
    if (!k.isValid(s)) return `invalid or empty solid for ${JSON.stringify(it.params)} (wall ${it.wall}, floor ${it.floor})`;
  } catch (e) {
    if (!flagged) return `threw "${(e as Error).message}" for ${JSON.stringify(it.params)} (wall ${it.wall}, floor ${it.floor})`;
  }
  return null;
}

describe('parameter sweep', () => {
  for (const def of standardBoxTypes) {
    it(`${def.id}: every parameter at min / default / max builds`, () => {
      const problems: string[] = [];
      const base = newItemParams(def);
      for (const variant of variants(def, base)) {
        for (const p of def.params) {
          if (p.kind !== 'number') continue;
          for (const v of numberValues(p)) {
            const msg = check(def, item(def, { ...variant, [p.key]: v as ParamValue }));
            if (msg) problems.push(`${p.key}=${v}: ${msg}`);
          }
        }
      }
      for (const [wall, floor] of [[0.4, 0.4], [4, 4], [0.4, 4], [4, 0.4]]) {
        for (const variant of variants(def, base)) {
          const msg = check(def, item(def, variant, wall, floor));
          if (msg) problems.push(msg);
        }
      }
      expect(problems.slice(0, 5)).toEqual([]);
    });
  }
});
