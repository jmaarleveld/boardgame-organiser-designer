import type { BoxTypeDefinition } from './types';

const registry = new Map<string, BoxTypeDefinition>();

export function registerBoxType(def: BoxTypeDefinition): void {
  if (registry.has(def.id)) throw new Error(`Box type "${def.id}" already registered`);
  registry.set(def.id, def);
}

export function getBoxType(id: string): BoxTypeDefinition {
  const def = registry.get(id);
  if (!def) throw new Error(`Unknown box type "${id}"`);
  return def;
}

export function findBoxType(id: string): BoxTypeDefinition | undefined {
  return registry.get(id);
}

export function listBoxTypes(): BoxTypeDefinition[] {
  return [...registry.values()];
}

/** Test helper. */
export function clearRegistry(): void {
  registry.clear();
}
