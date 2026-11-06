import { useEffect, useState } from 'react';
import type { MeshData } from '../geometry/types';
import { useServices } from '../integration';
import { useStore } from '../state/store';
import { downloadBlob as saveBlob, safeFileName } from '../services/download';
import { safeGeometryKey } from '../services/exporter';

/** 3D preview of the selected item (requires exporter + Preview3D services). */
export function PreviewPane() {
  const { exporter, Preview3D } = useServices();
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const kernelReady = useStore((s) => s.kernelReady);
  const [result, setResult] = useState<{ key: string; itemId: string; mesh: MeshData | null; error: string | null } | null>(null);

  const item = project.items.find((i) => i.id === selectedId);
  // Only geometry-relevant inputs should trigger a rebuild (not x/y/label):
  // the exporter's geometryKey, which includes the build context (e.g. the
  // items a platform's ridges are based on).
  const key = item ? JSON.stringify([item.id, safeGeometryKey(project, item), kernelReady]) : '';
  const enabled = !!(exporter && Preview3D && selectedId && key);

  useEffect(() => {
    if (!exporter || !Preview3D || !selectedId || !key) return;
    let cancelled = false;
    const t = setTimeout(() => {
      exporter
        .previewMesh(useStore.getState().project, selectedId)
        .then((mesh) => {
          if (!cancelled) setResult({ key, itemId: selectedId, mesh, error: null });
        })
        .catch((e: unknown) => {
          if (!cancelled) setResult({ key, itemId: selectedId, mesh: null, error: e instanceof Error ? e.message : String(e) });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [exporter, Preview3D, selectedId, key]);

  if (!Preview3D || !exporter) {
    return <div className="preview-placeholder" title="3D preview service not available">3D preview unavailable</div>;
  }
  const current = enabled && result?.key === key ? result : null;
  // Keep showing the previous mesh of the same item while rebuilding.
  const sameItem = result && item && result.itemId === item.id;
  const mesh = current?.mesh ?? (sameItem ? result.mesh : null);
  return (
    <div className="preview">
      <Preview3D mesh={mesh} loading={enabled && !current} className="preview3d" />
      {current?.error && <p className="error-text">Preview failed: {current.error}</p>}
    </div>
  );
}

/**
 * Preview area of the inspector: the 3D preview of the selected item. (The
 * whole assembly is the centre‑pane 3D editor now, so there is no Assembly
 * tab any more.)
 */
export function PreviewTabs() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const hasItem = project.items.some((i) => i.id === selectedId);
  if (!hasItem) return <div className="preview-placeholder muted">Select a box to preview it</div>;
  return <PreviewPane />;
}

/** Export buttons for the selected item. */
export function ItemExportButtons() {
  const { exporter } = useServices();
  const selectedId = useStore((s) => s.selectedId);
  const kernelReady = useStore((s) => s.kernelReady);
  const kernelError = useStore((s) => s.kernelError);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: 'stl' | 'scad') => {
    if (!exporter || !selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await exporter.exportItem(useStore.getState().project, selectedId);
      const stlName = entry.fileName || `${safeFileName('item')}.stl`;
      if (kind === 'stl') saveBlob(new Blob([entry.stl], { type: 'model/stl' }), stlName);
      else saveBlob(new Blob([entry.scad], { type: 'text/plain' }), stlName.replace(/\.stl$/, '.scad'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row">
      <button
        type="button"
        disabled={!exporter || !kernelReady || !selectedId || busy}
        title={!exporter ? 'Exporter not available' : !kernelReady ? 'Geometry engine not ready' : 'Download this box as STL'}
        onClick={() => void run('stl')}
      >
        {busy ? 'Exporting…' : exporter && !kernelReady && !kernelError ? 'Export STL (loading geometry…)' : 'Export STL'}
      </button>
      <button
        type="button"
        disabled={!exporter || !kernelReady || !selectedId || busy}
        title={!exporter ? 'Exporter not available' : !kernelReady ? 'Geometry engine not ready' : 'Download this box as OpenSCAD source'}
        onClick={() => void run('scad')}
      >
        Export .scad
      </button>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
