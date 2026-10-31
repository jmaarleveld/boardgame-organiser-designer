/**
 * End-to-end export with the REAL manifold kernel and the real box types:
 * sampleProject() → zip → one valid binary STL per distinct item + manifest.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createKernel } from '../geometry/kernel';
import { registerAllBoxTypes } from '../boxes';
import { sampleProject } from '../boxes/sample';
import { createExporter } from './exporter';

registerAllBoxTypes();

function checkBinaryStl(buf: ArrayBuffer | Uint8Array): number {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytes.byteLength).toBeGreaterThanOrEqual(84);
  const n = view.getUint32(80, true);
  expect(n).toBeGreaterThan(0);
  expect(bytes.byteLength).toBe(84 + 50 * n);
  // Every vertex is finite and lies in the positive octant (item local frame).
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let k = 0; k < 9; k++) {
      const v = view.getFloat32(o + k * 4, true);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-1e-3);
    }
  }
  return n;
}

describe('exporter with real kernel', () => {
  const exporter = createExporter(createKernel);

  it('exports the sample project as a zip of valid binary STLs', async () => {
    const project = sampleProject();
    const progress: number[] = [];
    const blob = await exporter.exportAll(project, (p) => progress.push(p.done));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    const stls = names.filter((n) => n.endsWith('.stl'));
    expect(names).toContain('manifest.txt');
    expect(stls).toHaveLength(project.items.length); // all sample items are distinct
    for (const name of stls) {
      checkBinaryStl(await zip.file(name)!.async('uint8array'));
    }
    const manifest = await zip.file('manifest.txt')!.async('string');
    expect(manifest).toContain('Sample insert');
    for (const item of project.items) expect(manifest).toContain(item.label);
    expect(progress.at(-1)).toBe(stls.length);
  }, 60_000);

  it('dedupes identical items and builds single items / preview meshes', async () => {
    const project = sampleProject();
    const copy = { ...project.items[0], id: 'copy', label: 'Tokens copy', x: 200, y: 200 };
    project.items.push(copy);
    const zip = await JSZip.loadAsync(await (await exporter.exportAll(project)).arrayBuffer());
    const stls = Object.keys(zip.files).filter((n) => n.endsWith('.stl'));
    expect(stls).toHaveLength(project.items.length - 1);
    expect(stls.some((n) => /_x2\.stl$/.test(n))).toBe(true);

    const entry = await exporter.exportItem(project, 'sample-divided');
    checkBinaryStl(entry.stl);
    const mesh = await exporter.previewMesh(project, 'sample-divided');
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
  }, 60_000);
});
