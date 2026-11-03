import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../state/store';
import { findBoxType } from '../boxes/registry';
import type { TopViewFeature } from '../boxes/types';
import { resolveItem } from '../model/resolve';
import type { PlacedItem, ProjectSettings } from '../model/types';
import type { ItemRect, LayoutSummary, Rect, SnapGuide } from '../model/layout';
import { boundingBox, errorItemIds, safeItemRect, snapPosition, usableArea, warningItemIds } from '../model/layout';
import { BOX_TYPE_MIME } from './dnd';

/** View = centre (mm) + scale (mm per screen px). viewBox is derived from the element size. */
interface View {
  cx: number;
  cy: number;
  m: number;
}

interface Size {
  w: number;
  h: number;
}

interface DragState {
  id: string;
  pointerId: number;
  startClient: { x: number; y: number };
  startMm: { x: number; y: number };
  itemStart: { x: number; y: number };
  size: { width: number; depth: number };
  others: Rect[];
  moved: boolean;
}

interface PanState {
  pointerId: number;
  startClient: { x: number; y: number };
  view: View;
}

const PAD_PX = 28;
const MIN_M = 0.005;
const MAX_M = 20;
const DRAG_START_PX = 3;
const SNAP_PX = 8;

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
/** Elevation levels are grouped at 0.1 mm. */
const levelKey = (z: number) => Math.round(z * 10) / 10;

function fitView(bounds: Rect, size: Size): View {
  const w = Math.max(size.w - 2 * PAD_PX, 10);
  const h = Math.max(size.h - 2 * PAD_PX, 10);
  const m = Math.min(MAX_M, Math.max(MIN_M, Math.max(bounds.width / w, bounds.depth / h, 1e-3)));
  return { cx: bounds.x + bounds.width / 2, cy: bounds.y + bounds.depth / 2, m };
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function TopView({ summary }: { summary: LayoutSummary }) {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const moveItem = useStore((s) => s.moveItem);
  const beginDrag = useStore((s) => s.beginDrag);
  const endDrag = useStore((s) => s.endDrag);
  const addItem = useStore((s) => s.addItem);
  const { settings, items } = project;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<Size>({ w: 800, h: 600 });
  const [userView, setUserView] = useState<View | null>(null);
  const [frozenView, setFrozenView] = useState<View | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  /** Level filter: hide items with z above this value; null = show all. */
  const [maxLevel, setMaxLevel] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<PanState | null>(null);

  /* ---- size tracking ---- */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- geometry ---- */
  const rects = useMemo(() => items.map((i) => safeItemRect(i, settings, items)), [items, settings]);
  const usable = usableArea(settings);
  const boxRect: Rect = { x: 0, y: 0, width: settings.box.width, depth: settings.box.depth };
  const contentBounds = boundingBox([boxRect, ...rects])!;
  const fit = fitView(contentBounds, size);
  const view = userView ?? frozenView ?? fit;
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });
  const m = view.m;
  const vb = { x: view.cx - (size.w * m) / 2, y: view.cy - (size.h * m) / 2, w: size.w * m, h: size.h * m };
  const errors = useMemo(() => errorItemIds(summary), [summary]);
  const warnings = useMemo(() => warningItemIds(summary), [summary]);
  /** Distinct bottom elevations, ascending (always contains 0). */
  const levels = useMemo(() => [...new Set([0, ...rects.map((r) => levelKey(r.z))])].sort((a, b) => a - b), [rects]);
  const visible = (idx: number) => maxLevel === null || levelKey(rects[idx].z) <= maxLevel + 1e-9;
  /** Draw order: by elevation (higher later), stable; filtered by the level control. */
  const drawOrder = useMemo(
    () =>
      items
        .map((_, idx) => idx)
        .filter((idx) => maxLevel === null || levelKey(rects[idx].z) <= maxLevel + 1e-9)
        .sort((a, b) => rects[a].z - rects[b].z || a - b),
    [items, rects, maxLevel],
  );

  const toMm = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const v = viewRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return {
      x: v.cx + (clientX - r.left - r.width / 2) * v.m,
      y: v.cy + (clientY - r.top - r.height / 2) * v.m,
    };
  }, []);

  /* ---- wheel zoom (native listener: React's onWheel is passive) ---- */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const r = svg.getBoundingClientRect();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const nm = Math.min(MAX_M, Math.max(MIN_M, v.m * Math.exp(delta * 0.0015)));
      const ox = e.clientX - r.left - r.width / 2;
      const oy = e.clientY - r.top - r.height / 2;
      const px = v.cx + ox * v.m;
      const py = v.cy + oy * v.m;
      setUserView({ cx: px - ox * nm, cy: py - oy * nm, m: nm });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  /* ---- space for panning ---- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target)) return;
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      setSpaceDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    const blur = () => setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const zoomBy = (factor: number) => {
    const v = viewRef.current;
    setUserView({ ...v, m: Math.min(MAX_M, Math.max(MIN_M, v.m * factor)) });
  };

  /* ---- pointer handling ---- */
  const startPan = (e: ReactPointerEvent) => {
    panRef.current = { pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, view: viewRef.current };
    svgRef.current?.setPointerCapture(e.pointerId);
    setPanning(true);
  };

  const onBackgroundPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button === 0) select(null);
  };

  const onItemPointerDown = (e: ReactPointerEvent, item: PlacedItem, idx: number) => {
    if (e.button === 1 || (e.button === 0 && spaceDown)) return; // let it bubble to pan
    if (e.button !== 0) return;
    e.stopPropagation();
    select(item.id);
    const r = rects[idx];
    dragRef.current = {
      id: item.id,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startMm: toMm(e.clientX, e.clientY),
      itemStart: { x: item.x, y: item.y },
      size: { width: r.width, depth: r.depth },
      others: rects.filter((_, i) => i !== idx),
      moved: false,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (pan && pan.pointerId === e.pointerId) {
      setUserView({
        cx: pan.view.cx - (e.clientX - pan.startClient.x) * pan.view.m,
        cy: pan.view.cy - (e.clientY - pan.startClient.y) * pan.view.m,
        m: pan.view.m,
      });
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) < DRAG_START_PX) return;
      d.moved = true;
      beginDrag();
      setFrozenView(viewRef.current);
      setDraggingId(d.id);
    }
    const p = toMm(e.clientX, e.clientY);
    const proposed = { x: d.itemStart.x + p.x - d.startMm.x, y: d.itemStart.y + p.y - d.startMm.y };
    let x: number;
    let y: number;
    if (e.altKey) {
      x = Math.round(proposed.x * 10) / 10;
      y = Math.round(proposed.y * 10) / 10;
      setGuides([]);
    } else {
      const threshold = Math.min(10, Math.max(0.25, SNAP_PX * viewRef.current.m));
      const s = snapPosition(d.size, proposed, d.others, usable, settings.gridSnap, threshold);
      x = s.snapX ? s.x : Math.round(s.x * 10) / 10;
      y = s.snapY ? s.y : Math.round(s.y * 10) / 10;
      setGuides(s.guides);
    }
    // Never let an item leave the game box entirely: keep at least half of it inside.
    x = Math.min(Math.max(x, -d.size.width / 2), settings.box.width - d.size.width / 2);
    y = Math.min(Math.max(y, -d.size.depth / 2), settings.box.depth - d.size.depth / 2);
    moveItem(d.id, x, y);
  };

  const finishPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (panRef.current && panRef.current.pointerId === e.pointerId) {
      panRef.current = null;
      setPanning(false);
    }
    const d = dragRef.current;
    if (d && d.pointerId === e.pointerId) {
      dragRef.current = null;
      if (d.moved) endDrag();
      setGuides([]);
      setDraggingId(null);
      setFrozenView(null);
    }
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId);
  };

  /* ---- palette drop ---- */
  const onDragOver = (e: ReactDragEvent) => {
    if (!e.dataTransfer.types.includes(BOX_TYPE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropHover) setDropHover(true);
  };
  const onDrop = (e: ReactDragEvent) => {
    setDropHover(false);
    const type = e.dataTransfer.getData(BOX_TYPE_MIME);
    if (!type || !findBoxType(type)) return;
    e.preventDefault();
    addItem(type, toMm(e.clientX, e.clientY));
  };

  /* ---- render helpers ---- */
  const hatch = 8 * m;
  const gridPath = useMemo(() => {
    const usable = usableArea(settings);
    const g = settings.gridSnap;
    if (!(g >= 1) || usable.width <= 0 || usable.depth <= 0) return null;
    let step = g;
    while (step / m < 8) step *= 2;
    const nx = usable.width / step;
    const ny = usable.depth / step;
    if (nx + ny > 1500) return null;
    let d = '';
    for (let i = 1; i < nx; i++) {
      const x = usable.x + i * step;
      d += `M${x} ${usable.y}V${usable.y + usable.depth}`;
    }
    for (let j = 1; j < ny; j++) {
      const y = usable.y + j * step;
      d += `M${usable.x} ${y}H${usable.x + usable.width}`;
    }
    return d;
  }, [settings, m]);

  const selIdx = items.findIndex((i) => i.id === selectedId);
  const dragIdx = items.findIndex((i) => i.id === draggingId);
  const dragRect = dragIdx >= 0 ? rects[dragIdx] : null;

  return (
    <div
      ref={wrapRef}
      className={`topview ${panning ? 'panning' : spaceDown ? 'can-pan' : ''} ${dropHover ? 'drop-hover' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHover(false);
      }}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        role="application"
        aria-label="Top view of the game box"
        width={size.w}
        height={size.h}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onLostPointerCapture={finishPointer}
        onAuxClick={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="tv-hatch" patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
            <rect width={hatch} height={hatch} className="hatch-bg" />
            <line x1={0} y1={0} x2={0} y2={hatch} className="hatch-line" strokeWidth={hatch / 4} />
          </pattern>
        </defs>

        <rect className="box-band" x={0} y={0} width={settings.box.width} height={settings.box.depth} fill="url(#tv-hatch)" />
        {usable.width > 0 && usable.depth > 0 && (
          <rect className="usable" x={usable.x} y={usable.y} width={usable.width} height={usable.depth} />
        )}
        {gridPath && <path className="grid" d={gridPath} />}
        <rect className="box-outline" x={0} y={0} width={settings.box.width} height={settings.box.depth} />

        {drawOrder.map((idx) => {
          const item = items[idx];
          return (
            <ItemShape
              key={item.id}
              item={item}
              rect={rects[idx]}
              settings={settings}
              items={items}
              m={m}
              selected={item.id === selectedId}
              error={errors.has(item.id)}
              warning={warnings.has(item.id)}
              dragging={item.id === draggingId}
              onPointerDown={(e) => onItemPointerDown(e, item, idx)}
              onFocus={() => select(item.id)}
            />
          );
        })}

        {selIdx >= 0 && visible(selIdx) && (
          <rect
            className="selection"
            x={rects[selIdx].x}
            y={rects[selIdx].y}
            width={rects[selIdx].width}
            height={rects[selIdx].depth}
          />
        )}

        {guides.map((g, i) =>
          g.axis === 'x' ? (
            <line key={i} className={`guide ${g.kind}`} x1={g.pos} x2={g.pos} y1={g.from - 4 * m} y2={g.to + 4 * m} />
          ) : (
            <line key={i} className={`guide ${g.kind}`} y1={g.pos} y2={g.pos} x1={g.from - 4 * m} x2={g.to + 4 * m} />
          ),
        )}

        {dragRect && (
          <text
            className="drag-tag"
            x={dragRect.x}
            y={dragRect.y - 6 * m}
            fontSize={11 * m}
            strokeWidth={3 * m}
          >
            {f1(dragRect.x)}, {f1(dragRect.y)}
          </text>
        )}
      </svg>

      {dragRect && (
        <div className="readout" aria-live="polite">
          x {f1(dragRect.x)} · y {f1(dragRect.y)} · {f1(dragRect.width)} × {f1(dragRect.depth)} mm
          <span className="gaps">
            ← {f1(dragRect.x - usable.x)} → {f1(usable.x + usable.width - dragRect.x - dragRect.width)} ↑{' '}
            {f1(dragRect.y - usable.y)} ↓ {f1(usable.y + usable.depth - dragRect.y - dragRect.depth)}
          </span>
        </div>
      )}

      <div className="view-controls">
        {levels.length > 1 && (
          <label className="level-filter" title="Hide items stacked above this elevation so lower levels can be edited">
            <span>Show up to</span>
            <select
              aria-label="Level filter"
              value={maxLevel === null ? 'all' : String(maxLevel)}
              onChange={(e) => setMaxLevel(e.target.value === 'all' ? null : Number(e.target.value))}
            >
              <option value="all">all levels</option>
              {levels.map((z) => (
                <option key={z} value={String(z)}>
                  z = {f1(z)} mm
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => zoomBy(1 / 1.25)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1.25)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setUserView(null)} title="Fit to box" disabled={!userView}>
          Fit
        </button>
      </div>
      <div className="view-hint">Wheel: zoom · Middle / Space+drag: pan · Alt: no snap</div>
    </div>
  );
}

interface ItemShapeProps {
  item: PlacedItem;
  rect: ItemRect & { broken?: true };
  settings: ProjectSettings;
  /** All items of the project (build context, e.g. platform ridges). */
  items: PlacedItem[];
  m: number;
  selected: boolean;
  error: boolean;
  /** Warning-level issue (e.g. floating), shown when there is no error. */
  warning: boolean;
  dragging: boolean;
  onPointerDown(e: ReactPointerEvent): void;
  onFocus(): void;
}

function ItemShape({ item, rect, settings, items, m, selected, error, warning, dragging, onPointerDown, onFocus }: ItemShapeProps) {
  const def = findBoxType(item.type);
  let features: TopViewFeature[] = [];
  if (def && !rect.broken) {
    try {
      features = def.draw(resolveItem(item, settings, items));
    } catch {
      features = [];
    }
  }
  const rotated = item.rotation === 90;
  // Local frame (unrotated) size: at 90° the placed width is the local depth.
  const localD = rotated ? rect.width : rect.depth;
  // Rotation by 90° clockwise: (lx, ly) → (localD - ly, lx) relative to the item's top-left.
  const toPlaced = (lx: number, ly: number) => (rotated ? { x: localD - ly, y: lx } : { x: lx, y: ly });
  const localTransform = rotated ? `translate(${localD} 0) rotate(90)` : undefined;

  const minSide = Math.min(rect.width, rect.depth);
  const fs = Math.min(12 * m, minSide / 3.2);
  const showLabel = fs >= 6 * m;
  const dimFs = fs * 0.8;
  const showDims = showLabel && rect.depth > fs * 3.2 && rect.width > dimFs * 7;
  const cx = rect.width / 2;
  const cy = rect.depth / 2;
  const elevated = rect.z > 1e-6;
  const badgeFs = Math.min(10 * m, minSide / 4);

  return (
    <g
      className={`item ${selected ? 'selected' : ''} ${error ? 'error' : warning ? 'warning' : ''} ${elevated ? 'elevated' : ''} ${dragging ? 'dragging' : ''} ${rect.broken ? 'broken' : ''}`}
      transform={`translate(${rect.x} ${rect.y})`}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${item.label}, ${f1(rect.width)} by ${f1(rect.depth)} mm at ${f1(rect.x)}, ${f1(rect.y)}${elevated ? `, elevated ${f1(rect.z)} mm` : ''}`}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
    >
      <rect className="item-outer" x={0} y={0} width={rect.width} height={rect.depth} />
      <g transform={localTransform} className="features">
        {features.map((f, i) =>
          f.kind === 'rect' ? (
            <rect key={i} className={`feat feat-${f.role}`} x={f.x} y={f.y} width={Math.max(0, f.w)} height={Math.max(0, f.h)} />
          ) : null,
        )}
      </g>
      {features.map((f, i) => {
        if (f.kind !== 'text') return null;
        const p = toPlaced(f.x, f.y);
        return (
          <text key={`t${i}`} className="feat-text" x={p.x} y={p.y} fontSize={Math.max(dimFs * 0.9, 1)}>
            {f.text}
          </text>
        );
      })}
      {showLabel && (
        <text className="item-label" x={cx} y={showDims ? cy - fs * 0.15 : cy + fs * 0.35} fontSize={fs} strokeWidth={fs * 0.25}>
          {item.label}
        </text>
      )}
      {showDims && (
        <text className="item-dims" x={cx} y={cy + dimFs * 1.15} fontSize={dimFs} strokeWidth={dimFs * 0.25}>
          {f1(rect.width)} × {f1(rect.depth)} × {f1(rect.height)}
        </text>
      )}
      {elevated && badgeFs > 0 && (
        <g className="z-badge" aria-hidden="true">
          <rect
            x={badgeFs * 0.3}
            y={badgeFs * 0.3}
            width={badgeFs * (1.6 + 0.62 * f1(rect.z).length)}
            height={badgeFs * 1.35}
            rx={badgeFs * 0.3}
          />
          <text x={badgeFs * 0.6} y={badgeFs * 1.3} fontSize={badgeFs}>
            ↑ {f1(rect.z)}
          </text>
        </g>
      )}
      {rect.broken && (
        <text className="item-label" x={cx} y={cy + 3} fontSize={8}>
          ?
        </text>
      )}
    </g>
  );
}
