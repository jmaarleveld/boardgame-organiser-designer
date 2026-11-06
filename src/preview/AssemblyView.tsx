import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoxDimensions } from '../model/types';
import type { Rect } from '../model/layout';
import { layoutSummary } from '../model/layout';
import type { AssemblyViewProps } from '../services/contracts';
import { useServices } from '../integration';
import { useStore } from '../state/store';
import { classifyItems, localSize, placementMatrix } from './assemblyScene';
import { CAMERA_PRESETS, type CameraPreset } from './assemblyCamera';
import { createAssemblyScene, type AssemblyEntry, type AssemblySceneApi } from './assemblyRenderer';
import { useAssemblyMeshes } from './assemblyMeshes';
import './preview.css';

export type { AssemblyEntry, AssemblySceneApi } from './assemblyRenderer';

const PRESET_LABELS: Record<CameraPreset, { label: string; title: string }> = {
  top: { label: 'Top', title: 'Straight down, orthographic' },
  front: { label: 'Front', title: 'From the front' },
  side: { label: 'Side', title: 'From the right side' },
  iso: { label: 'Iso', title: 'Isometric‑style overview' },
};

interface AssemblyCanvasProps {
  entries: AssemblyEntry[];
  box: BoxDimensions;
  usable: Rect;
  /** Increment to re‑fit the camera to the box. */
  fitToken: number;
  /** Camera preset; changing it re‑frames the game box. */
  preset?: CameraPreset;
  onPick(id: string): void;
  /** Receives the imperative scene API once created (null on unmount / WebGL failure). */
  onReady?(api: AssemblySceneApi | null): void;
}

/** three.js viewer for a whole assembly (on‑demand rendering). */
export function AssemblyCanvas({ entries, box, usable, fitToken, preset = 'iso', onPick, onReady }: AssemblyCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AssemblySceneApi | null>(null);
  const latest = useRef({ entries, box, usable, preset, onPick, onReady });
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    latest.current = { entries, box, usable, preset, onPick, onReady };
  });

  useEffect(() => {
    sceneRef.current?.setEntries(entries);
  }, [entries]);

  const { width, depth, height } = box;
  useEffect(() => {
    sceneRef.current?.setBox({ width, depth, height }, usable);
  }, [width, depth, height, usable]);

  useEffect(() => {
    if (fitToken) sceneRef.current?.fit();
  }, [fitToken]);

  useEffect(() => {
    const s = sceneRef.current;
    if (s && s.getPreset() !== preset) s.setPreset(preset);
  }, [preset]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let s: AssemblySceneApi;
    try {
      s = createAssemblyScene(host, { onPick: (id) => latest.current.onPick(id), preset: latest.current.preset });
    } catch (e) {
      // WebGL unavailable: this runs once per mount, so no render loop.
      setWebglError(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    sceneRef.current = s;
    const resize = () => s.resize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const { box: b, usable: u, entries: en } = latest.current;
    resize();
    s.setBox(b, u);
    s.setEntries(en);
    latest.current.onReady?.(s);
    return () => {
      latest.current.onReady?.(null);
      ro.disconnect();
      s.dispose();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div className="preview3d assembly-canvas">
      <div ref={hostRef} className="preview3d-canvas" />
      {webglError && <div className="preview3d-msg">3D view unavailable: WebGL could not be started.</div>}
    </div>
  );
}

/** Whole game box with every placed item (data from the store; meshes cached per geometry). */
export default function AssemblyView({ className, onPopOut, onClose }: AssemblyViewProps) {
  const { exporter } = useServices();
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const kernelReady = useStore((s) => s.kernelReady);
  const kernelError = useStore((s) => s.kernelError);
  const select = useStore((s) => s.select);
  const [fitToken, setFitToken] = useState(0);
  const [preset, setPreset] = useState<CameraPreset>('iso');
  const { items, settings } = project;

  const meshes = useAssemblyMeshes(project, exporter, kernelReady);
  const summary = useMemo(() => layoutSummary(items, settings), [items, settings]);
  const tints = useMemo(() => classifyItems(items, settings, summary), [items, settings, summary]);
  const { itemKeys, meshes: cached } = meshes;
  const entries = useMemo<AssemblyEntry[]>(
    () =>
      items.map((item) => {
        const size = localSize(item, settings, items);
        const key = itemKeys.get(item.id) ?? null;
        return {
          id: item.id,
          mesh: (key !== null && cached.byKey.get(key)) || null,
          matrix: placementMatrix(item, size.depth),
          size,
          tint: tints.get(item.id) ?? 'normal',
          selected: item.id === selectedId,
        };
      }),
    [items, settings, tints, selectedId, itemKeys, cached],
  );

  const failed = items.filter((i) => meshes.errorFor(itemKeys.get(i.id) ?? null)).length;
  let status: string | null = null;
  if (items.length) {
    if (!exporter) status = 'Geometry unavailable — showing footprints';
    else if (kernelError) status = 'Geometry engine failed — showing footprints';
    else if (!kernelReady) status = 'Loading geometry engine…';
    else if (meshes.done < meshes.total) status = `Generating ${meshes.done + 1}/${meshes.total}…`;
  }

  return (
    <div className={`assembly ${className ?? ''}`.trim()}>
      <AssemblyCanvas entries={entries} box={settings.box} usable={summary.usable} fitToken={fitToken} preset={preset} onPick={select} />
      <div className="assembly-controls">
        <div className="assembly-presets" role="group" aria-label="Camera">
          {CAMERA_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === preset ? 'active' : undefined}
              aria-pressed={p === preset}
              title={`${PRESET_LABELS[p].title} (right‑drag ${p === 'top' ? 'pans' : 'orbits'}, middle‑drag pans, wheel zooms)`}
              onClick={() => (p === preset ? setFitToken((t) => t + 1) : setPreset(p))}
            >
              {PRESET_LABELS[p].label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setFitToken((t) => t + 1)} title="Fit the camera to the game box">
          Fit
        </button>
        {onPopOut && (
          <button type="button" onClick={onPopOut} title="Open the assembly in a larger view">
            Pop out
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close assembly view">
            ×
          </button>
        )}
      </div>
      {status && (
        <div className="preview3d-loading assembly-status" role="status">
          {status}
        </div>
      )}
      {failed > 0 && <div className="assembly-failed error-text">{failed} item{failed > 1 ? 's' : ''} could not be generated</div>}
      {!items.length && <div className="preview3d-msg">The game box is empty. Add boxes from the palette.</div>}
    </div>
  );
}
