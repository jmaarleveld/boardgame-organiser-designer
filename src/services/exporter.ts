import JSZip from 'jszip';
import type { ExportEntry, ExportProgress, Exporter } from './contracts';
import type { GeometryKernel, MeshData, Solid } from '../geometry/types';
import type { PlacedItem, Project } from '../model/types';
import { resolveItem } from '../model/resolve';
import { getBoxType } from '../boxes/registry';

export function sanitizeLabel(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[^\w\- .]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Key identifying identical geometry: resolved type/wall/floor/params. */
function geometryKey(project: Project, item: PlacedItem): string {
  const r = resolveItem(item, project.settings);
  return stableStringify({ type: r.type, wall: r.wall, floor: r.floor, params: r.params });
}

function fileLabel(item: PlacedItem): string {
  return sanitizeLabel(item.label) || sanitizeLabel(`${item.type}_${item.id}`) || 'item';
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function createExporter(getKernel: () => Promise<GeometryKernel>): Exporter {
  function buildSolid(kernel: GeometryKernel, project: Project, itemId: string): Solid {
    const item = project.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`Item "${itemId}" not found`);
    const def = getBoxType(item.type);
    return def.build(resolveItem(item, project.settings), kernel);
  }

  return {
    async exportItem(project, itemId): Promise<ExportEntry> {
      const kernel = await getKernel();
      const item = project.items.find((i) => i.id === itemId);
      if (!item) throw new Error(`Item "${itemId}" not found`);
      const solid = buildSolid(kernel, project, itemId);
      return { fileName: `${fileLabel(item)}.stl`, itemIds: [itemId], count: 1, stl: kernel.toSTL(solid, item.label) };
    },

    async exportAll(project, onProgress?: (p: ExportProgress) => void): Promise<Blob> {
      const kernel = await getKernel();
      const groups = new Map<string, PlacedItem[]>();
      for (const item of project.items) {
        const key = geometryKey(project, item);
        const g = groups.get(key);
        if (g) g.push(item); else groups.set(key, [item]);
      }
      const list = [...groups.values()];
      const zip = new JSZip();
      const lines: string[] = [];
      const s = project.settings;
      const pad = Math.max(2, String(list.length).length);
      onProgress?.({ done: 0, total: list.length, currentLabel: '' });
      for (let i = 0; i < list.length; i++) {
        const items = list[i];
        const first = items[0];
        onProgress?.({ done: i, total: list.length, currentLabel: first.label });
        await new Promise((r) => setTimeout(r, 0));
        const solid = buildSolid(kernel, project, first.id);
        const stl = kernel.toSTL(solid, first.label);
        const fileName = `${String(i + 1).padStart(pad, '0')}_${fileLabel(first)}_x${items.length}.stl`;
        zip.file(fileName, stl);
        const fp = getBoxType(first.type).footprint(resolveItem(first, s));
        lines.push(
          `${fileName}: count ${items.length}; items ${items.map((it) => it.label || it.id).join(', ')}; outer ${fmt(fp.width)} x ${fmt(fp.depth)} x ${fmt(fp.height)} mm`,
        );
        onProgress?.({ done: i + 1, total: list.length, currentLabel: first.label });
      }
      const manifest = [
        `Project: ${s.name}`,
        `Game box (inner): ${fmt(s.box.width)} x ${fmt(s.box.depth)} x ${fmt(s.box.height)} mm (W x D x H)`,
        `Tolerance: x ${fmt(s.tolerance.x)} mm, y ${fmt(s.tolerance.y)} mm`,
        `Files: ${list.length}, total items: ${project.items.length}`,
        '',
        ...lines,
        '',
      ].join('\n');
      zip.file('manifest.txt', manifest);
      return zip.generateAsync({ type: 'blob' });
    },

    async previewMesh(project, itemId): Promise<MeshData> {
      const kernel = await getKernel();
      return kernel.toMesh(buildSolid(kernel, project, itemId));
    },
  };
}
