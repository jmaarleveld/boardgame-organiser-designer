/**
 * Contracts for the services layer and preview component so the UI can
 * integrate against them before they are implemented.
 */
import type { MeshData } from '../geometry/types';
import type { Project } from '../model/types';

/* ---------- BoardGameGeek ---------- */

export interface BggSearchResult {
  id: number;
  name: string;
  yearPublished?: number;
}

export interface BggBoxVersion {
  versionId: number;
  name: string;
  /** Outer box dimensions in mm (converted from BGG's inches). Undefined if BGG has none. */
  widthMm?: number;
  depthMm?: number;
  heightMm?: number;
}

export interface BggClient {
  search(query: string, signal?: AbortSignal): Promise<BggSearchResult[]>;
  versions(gameId: number, signal?: AbortSignal): Promise<BggBoxVersion[]>;
}

/* ---------- Persistence ---------- */

export interface Persistence {
  save(project: Project): void;
  load(): Project | null;
  clear(): void;
  toJson(project: Project): string;
  /** Throws a descriptive Error on invalid input. */
  fromJson(text: string): Project;
}

/* ---------- Export ---------- */

export interface ExportEntry {
  fileName: string;
  /** Item ids sharing this identical geometry. */
  itemIds: string[];
  /** How many copies to print. */
  count: number;
  stl: ArrayBuffer;
  /** OpenSCAD source for the same geometry (parameters baked in as literals). */
  scad: string;
}

export interface ExportProgress {
  done: number;
  total: number;
  currentLabel: string;
}

export interface Exporter {
  /** Build a single item's STL. */
  exportItem(project: Project, itemId: string): Promise<ExportEntry>;
  /** Build all items (deduplicated) and return the zip blob. */
  exportAll(project: Project, onProgress?: (p: ExportProgress) => void): Promise<Blob>;
  /** Mesh for the 3D preview of a single item. */
  previewMesh(project: Project, itemId: string): Promise<MeshData>;
}

/* ---------- Preview component props ---------- */

export interface Preview3DProps {
  mesh: MeshData | null;
  /** Shown while the mesh is being computed. */
  loading?: boolean;
  className?: string;
}
