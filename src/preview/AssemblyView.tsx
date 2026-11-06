import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { BoxDimensions } from '../model/types';
import type { Rect, SnapGuide } from '../model/layout';
import { layoutSummary, safeItemRect } from '../model/layout';
import type { DragPlane, DragSession } from '../model/drag';
import { chooseDragPlane, dragDelta, dragPlanePoint, dragStep, gapLabels, startDragSession } from '../model/drag';
import { explodeOffsets, fadedItemIds } from '../model/stackView';
import { findBoxType } from '../boxes/registry';
import { BOX_TYPE_MIME } from '../ui/dnd';
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
  /** Content height the camera fit must include besides the box (exploded view); 0 = box only. */
  fitHeight?: number;
  /** Camera preset; changing it re‑frames the game box. */
  preset?: CameraPreset;
  /** Built‑in click picking; omit when the caller handles the pointer itself (editor). */
  onPick?(id: string): void;
  /** Receives the imperative scene API once created (null on unmount / WebGL failure). */
  onReady?(api: AssemblySceneApi | null): void;
}

/** three.js viewer for a whole assembly (on‑demand rendering). */
export function AssemblyCanvas({ entries, box, usable, fitToken, fitHeight = 0, preset = 'iso', onPick, onReady }: AssemblyCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AssemblySceneApi | null>(null);
  const latest = useRef({ entries, box, usable, preset, fitHeight, onPick, onReady });
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    latest.current = { entries, box, usable, preset, fitHeight, onPick, onReady };
  });

  useEffect(() => {
    sceneRef.current?.setFitHeight(fitHeight);
  }, [fitHeight]);

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
      s = createAssemblyScene(host, {
        onPick: latest.current.onPick ? (id) => latest.current.onPick?.(id) : undefined,
        preset: latest.current.preset,
      });
    } catch (e) {
      // WebGL unavailable: this runs once per mount, so no render loop.
      setWebglError(e instanceof Error ? e.message : 'WebGL is not available');
      return;
    }
    sceneRef.current = s;
    const resize = () => s.resize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const { box: b, usable: u, entries: en, fitHeight: fh } = latest.current;
    s.setFitHeight(fh);
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

const DRAG_START_PX = 3;
const SNAP_PX = 8;
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

interface EditorDrag {
  pointerId: number;
  startClient: { x: number; y: number };
  session: DragSession;
  /** Game‑frame grab point; the drag plane passes through it. */
  grab: { x: number; y: number; z: number };
  plane: DragPlane;
  moved: boolean;
}

/**
 * Whole game box with every placed item (data from the store; meshes cached
 * per geometry). With `editable` it is the main editor: left‑drag moves an
 * item (Alt at drag start leaves its stack behind, Shift disables snapping),
 * a click selects, a click on empty space deselects, palette drops add items.
 */
export default function AssemblyView({ className, onPopOut, onClose, editable = false }: AssemblyViewProps) {
  const { exporter } = useServices();
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const kernelReady = useStore((s) => s.kernelReady);
  const kernelError = useStore((s) => s.kernelError);
  const select = useStore((s) => s.select);
  const [fitToken, setFitToken] = useState(0);
  const [preset, setPreset] = useState<CameraPreset>('iso');
  const [api, setApi] = useState<AssemblySceneApi | null>(null);
  const [dragging, setDragging] = useState<{ session: DragSession; guides: SnapGuide[] } | null>(null);
  const [dropHover, setDropHover] = useState(false);
  /** Items stacked over the selection turn see‑through and click‑through. */
  const [fadeAbove, setFadeAbove] = useState(true);
  /** Display‑only: lift each item by its stack level × EXPLODE_GAP. */
  const [exploded, setExploded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<EditorDrag | null>(null);
  const { items, settings } = project;

  const meshes = useAssemblyMeshes(project, exporter, kernelReady);
  const summary = useMemo(() => layoutSummary(items, settings), [items, settings]);
  const tints = useMemo(() => classifyItems(items, settings, summary), [items, settings, summary]);
  const { itemKeys, meshes: cached } = meshes;
  const faded = useMemo(
    () => (editable && fadeAbove ? fadedItemIds(items, settings, selectedId) : new Set<string>()),
    [editable, fadeAbove, items, settings, selectedId],
  );
  const offsets = useMemo(() => (exploded ? explodeOffsets(items, settings) : null), [exploded, items, settings]);
  /** Displayed (exploded) bottom z of an item; model z when not exploded. */
  const displayZ = (id: string, z: number) => z + (offsets?.get(id) ?? 0);
  const fitHeight = useMemo(() => {
    if (!offsets) return 0;
    let top = 0;
    for (const item of items) top = Math.max(top, safeItemRect(item, settings, items).top + (offsets.get(item.id) ?? 0));
    return top;
  }, [offsets, items, settings]);
  const entries = useMemo<AssemblyEntry[]>(
    () =>
      items.map((item) => {
        const size = localSize(item, settings, items);
        const key = itemKeys.get(item.id) ?? null;
        const off = offsets?.get(item.id) ?? 0;
        return {
          id: item.id,
          mesh: (key !== null && cached.byKey.get(key)) || null,
          matrix: placementMatrix(off ? { ...item, z: (item.z ?? 0) + off } : item, size.depth),
          size,
          tint: tints.get(item.id) ?? 'normal',
          selected: item.id === selectedId,
          faded: faded.has(item.id),
        };
      }),
    [items, settings, tints, selectedId, itemKeys, cached, faded, offsets],
  );

  const failed = items.filter((i) => meshes.errorFor(itemKeys.get(i.id) ?? null)).length;
  let status: string | null = null;
  if (items.length) {
    if (!exporter) status = 'Geometry unavailable — showing footprints';
    else if (kernelError) status = 'Geometry engine failed — showing footprints';
    else if (!kernelReady) status = 'Loading geometry engine…';
    else if (meshes.done < meshes.total) status = `Generating ${meshes.done + 1}/${meshes.total}…`;
  }

  /* ---- editing: pointer ---- */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || !api || e.button !== 0 || e.target !== api.domElement) return;
    wrapRef.current?.focus({ preventScroll: true });
    const hit = api.pickItemAt(e.clientX, e.clientY);
    if (!hit) {
      select(null);
      return;
    }
    select(hit.id);
    const { project: p } = useStore.getState();
    // Alt at drag start: pull the item out from under its stack.
    const session = startDragSession(p.items, p.settings, hit.id, hit.point, !e.altKey);
    if (!session) return;
    const plane = chooseDragPlane(api.screenRay(e.clientX, e.clientY).dir);
    dragRef.current = { pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, session, grab: hit.point, plane, moved: false };
    api.domElement.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !api || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < DRAG_START_PX) return;
      d.moved = true;
      useStore.getState().beginDrag();
    }
    const toPlane = (cx: number, cy: number) => {
      const ray = api.screenRay(cx, cy);
      return dragPlanePoint(d.plane, ray.origin, ray.dir, d.grab);
    };
    const p = toPlane(e.clientX, e.clientY);
    if (!p) return;
    // Snap threshold: SNAP_PX screen pixels expressed in mm on the drag plane.
    const q = toPlane(e.clientX + SNAP_PX, e.clientY);
    const threshold = q ? Math.min(10, Math.max(0.25, Math.hypot(q.x - p.x, q.y - p.y))) : 3;
    const s = useStore.getState();
    const step = dragStep(d.session, p, s.project.settings, { snap: !e.shiftKey, threshold });
    const cur = s.project.items.find((i) => i.id === d.session.id);
    if (cur) {
      const { dx, dy } = dragDelta(cur, step);
      s.moveStack(d.session.id, dx, dy, { carry: d.session.carry });
    }
    setDragging({ session: d.session, guides: step.guides });
  };

  const finishPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (d.moved) useStore.getState().endDrag();
    setDragging(null);
    const dom = api?.domElement;
    if (dom?.hasPointerCapture(e.pointerId)) dom.releasePointerCapture(e.pointerId);
  };

  /* ---- editing: palette drop ---- */
  const onDragOver = (e: ReactDragEvent) => {
    if (!editable || !e.dataTransfer.types.includes(BOX_TYPE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropHover) setDropHover(true);
  };
  const onDrop = (e: ReactDragEvent) => {
    setDropHover(false);
    if (!editable || !api) return;
    const type = e.dataTransfer.getData(BOX_TYPE_MIME);
    if (!type || !findBoxType(type)) return;
    e.preventDefault();
    // On an item: at the hit point (the new item is appended, so it settles on top); else on the floor.
    const hit = api.pickItemAt(e.clientX, e.clientY);
    const at = hit ? { x: hit.point.x, y: hit.point.y } : api.screenToPlane(e.clientX, e.clientY, 0);
    useStore.getState().addItem(type, at ?? undefined);
    wrapRef.current?.focus({ preventScroll: true });
  };

  /* ---- editing: live distance labels & snap guides ---- */
  let overlay: ReactNode = null;
  let readout: ReactNode = null;
  const dragItem = dragging ? items.find((i) => i.id === dragging.session.id) : undefined;
  if (dragging && dragItem && api) {
    const r = safeItemRect(dragItem, settings, items);
    const moving = new Set(dragging.session.movingIds);
    const others = items.filter((i) => !moving.has(i.id)).map((i) => safeItemRect(i, settings, items));
    const gaps = gapLabels(r, others, summary.usable).filter((g) => Math.abs(g.distance) >= 0.05);
    // Labels sit at the item's displayed height (exploded or not).
    const z = displayZ(dragItem.id, r.z);
    const proj = (x: number, y: number) => api.projectToCanvas(x, y, z);
    const lines: ReactNode[] = [];
    const labels: ReactNode[] = [];
    dragging.guides.forEach((g, i) => {
      const a = g.axis === 'x' ? proj(g.pos, g.from) : proj(g.from, g.pos);
      const b = g.axis === 'x' ? proj(g.pos, g.to) : proj(g.to, g.pos);
      if (a && b) lines.push(<line key={`g${i}`} className={`guide ${g.kind}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
    });
    for (const g of gaps) {
      const a = proj(g.from.x, g.from.y);
      const b = proj(g.to.x, g.to.y);
      if (!a || !b) continue;
      lines.push(<line key={`d${g.side}`} className={`gap ${g.kind}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
      labels.push(
        <div key={g.side} className={`gap-label ${g.kind}`} style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}>
          {f1(g.distance)}
        </div>,
      );
    }
    overlay = (
      <div className="editor-overlay" aria-hidden="true">
        <svg>{lines}</svg>
        {labels}
      </div>
    );
    readout = (
      <div className="editor-readout" aria-live="polite">
        x {f1(r.x)} · y {f1(r.y)} · z {f1(r.z)} · {f1(r.width)} × {f1(r.depth)} × {f1(r.height)} mm
        {!dragging.session.carry && ' · pulling out'}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className={`assembly ${editable ? 'assembly-editor' : ''} ${dropHover ? 'drop-hover' : ''} ${className ?? ''}`.trim()}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? '3D editor of the game box' : undefined}
      onPointerDown={editable ? onPointerDown : undefined}
      onPointerMove={editable ? onPointerMove : undefined}
      onPointerUp={editable ? finishPointer : undefined}
      onPointerCancel={editable ? finishPointer : undefined}
      onLostPointerCapture={editable ? finishPointer : undefined}
      onDragOver={editable ? onDragOver : undefined}
      onDragLeave={
        editable
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false);
            }
          : undefined
      }
      onDrop={editable ? onDrop : undefined}
    >
      <AssemblyCanvas
        entries={entries}
        box={settings.box}
        usable={summary.usable}
        fitToken={fitToken}
        fitHeight={fitHeight}
        preset={preset}
        onPick={editable ? undefined : select}
        onReady={setApi}
      />
      {overlay}
      {readout}
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
        {editable && (
          <>
            <button
              type="button"
              className={fadeAbove ? 'active' : undefined}
              aria-pressed={fadeAbove}
              onClick={() => setFadeAbove((v) => !v)}
              title="Make the items stacked over the selected item see‑through and click‑through"
            >
              Fade above
            </button>
            <button
              type="button"
              className={exploded ? 'active' : undefined}
              aria-pressed={exploded}
              onClick={() => setExploded((v) => !v)}
              title="Lift every stack level apart (display only; dragging still works)"
            >
              Exploded
            </button>
          </>
        )}
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
      {editable && (
        <div className="editor-hint">
          Drag: move · Alt+drag: leave the stack behind · Shift: no snap · Arrows: nudge · Right‑drag: orbit · Middle: pan · Wheel: zoom
        </div>
      )}
    </div>
  );
}
