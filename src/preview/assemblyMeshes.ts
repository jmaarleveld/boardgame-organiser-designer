/**
 * Mesh cache for the Assembly view: one MeshData per unique geometry key
 * (exporter's `geometryKey`: resolved type / wall / floor / params). Shared by
 * every mounted assembly view (inline + pop‑out). Moving, rotating or
 * relabelling items never changes a key, so it never triggers a build.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeshData } from '../geometry/types';
import type { PlacedItem, Project } from '../model/types';
import type { Exporter } from '../services/contracts';
import { geometryKey } from '../services/exporter';
import { LruCache, missingKeys } from './assemblyScene';

export const MESH_CACHE_CAPACITY = 64;
export const BUILD_DEBOUNCE_MS = 200;

const meshCache = new LruCache<MeshData>(MESH_CACHE_CAPACITY);
/** Keys whose build failed (error message). Not retried until the page reloads or the kernel is re‑initialised. */
const failures = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();

interface DebugHook {
  meshBuilds: number;
  meshCacheSize(): number;
}

declare global {
  interface Window {
    __bgid?: Partial<DebugHook> & Record<string, unknown>;
  }
}

/** Dev‑only counter of kernel mesh builds triggered by the assembly view. */
function countBuild(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const dbg = (window.__bgid ??= {});
  dbg.meshBuilds = (dbg.meshBuilds ?? 0) + 1;
  dbg.meshCacheSize = () => meshCache.size;
}

/** geometryKey that returns null instead of throwing (unknown box type …). */
export function safeGeometryKey(project: Project, item: PlacedItem): string | null {
  try {
    return geometryKey(project, item);
  } catch {
    return null;
  }
}

function buildKey(exporter: Exporter, project: Project, itemId: string, key: string, protect: ReadonlySet<string>): Promise<void> {
  let p = inflight.get(key);
  if (!p) {
    countBuild();
    p = exporter
      .previewMesh(project, itemId)
      .then(
        (mesh) => meshCache.set(key, mesh, protect),
        (e: unknown) => {
          failures.set(key, e instanceof Error ? e.message : String(e));
        },
      )
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

export interface AssemblyMeshes {
  /** item id → geometry key (null if the item's geometry cannot be resolved). */
  itemKeys: Map<string, string | null>;
  /** Snapshot of the cached meshes for the scene's keys; a new object whenever the cache gains entries. */
  meshes: { version: number; byKey: ReadonlyMap<string, MeshData> };
  /** Build error for a key, if any. */
  errorFor(key: string | null): string | null;
  /** Unique buildable keys in the scene and how many of them are ready. */
  total: number;
  done: number;
}

export function useAssemblyMeshes(project: Project, exporter: Exporter | undefined, kernelReady: boolean): AssemblyMeshes {
  const [version, setVersion] = useState(0);
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const { items, settings } = project;
  const itemKeys = useMemo(() => {
    const p = { version: 1 as const, settings, items };
    return new Map(items.map((i) => [i.id, safeGeometryKey(p, i)] as const));
  }, [items, settings]);

  // Stable signature of the unique keys: positions/rotations/labels don't change it.
  const signature = useMemo(
    () => [...new Set([...itemKeys.values()].filter((k): k is string => k !== null))].sort().join('\n'),
    [itemKeys],
  );

  useEffect(() => {
    if (!exporter || !kernelReady || !signature) return;
    const keys = signature.split('\n');
    const protect = new Set(keys);
    meshCache.touch(keys);
    const missing = missingKeys(keys, meshCache, failures);
    if (!missing.length) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        for (const key of missing) {
          if (cancelled) return;
          if (meshCache.has(key) || failures.has(key)) continue;
          const proj = projectRef.current;
          const item = proj.items.find((i) => safeGeometryKey(proj, i) === key);
          if (!item) continue;
          await buildKey(exporter, proj, item.id, key, protect);
          if (!cancelled) setVersion((v) => v + 1);
        }
      })();
    }, BUILD_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [exporter, kernelReady, signature]);

  const meshes = useMemo(() => {
    const byKey = new Map<string, MeshData>();
    for (const k of signature ? signature.split('\n') : []) {
      const m = meshCache.peek(k);
      if (m) byKey.set(k, m);
    }
    return { version, byKey };
  }, [signature, version]);

  const keys = signature ? signature.split('\n') : [];
  const buildable = keys.filter((k) => !failures.has(k));
  return {
    itemKeys,
    meshes,
    errorFor: (key) => (key === null ? null : (failures.get(key) ?? null)),
    total: buildable.length,
    done: buildable.filter((k) => meshes.byKey.has(k)).length,
  };
}

/** Test helper: reset the shared cache state. */
export function resetAssemblyMeshCache(): void {
  meshCache.clear();
  failures.clear();
  inflight.clear();
}
