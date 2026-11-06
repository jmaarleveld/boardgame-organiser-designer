import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../state/store';
import { findBoxType } from '../boxes/registry';
import type { TopViewFeature } from '../boxes/types';
import { resolveItem } from '../model/resolve';
import type { LayoutSummary } from '../model/layout';
import { errorItemIds, safeItemRect, warningItemIds } from '../model/layout';
import type { ItemTint } from '../preview/assemblyScene';

/** Width of the map drawing in CSS px (height follows the box aspect ratio). */
const MAP_W = 220;
const PAD = 4;

export interface MiniMapProps {
  summary: LayoutSummary;
  /** Per‑item tint, same classification as the 3D view. */
  tints: ReadonlyMap<string, ItemTint>;
  /** Centre the 3D camera on game‑frame (x, y). */
  onFocus(x: number, y: number): void;
}

/**
 * Read‑only top‑down overview of the game box in a corner of the 3D editor.
 * Drawn y UP like the 3D view (x right, origin front‑left at the bottom).
 * Click: centres the 3D camera there; on an item it also selects the topmost
 * item under the cursor. No editing.
 */
export function MiniMap({ summary, tints, onFocus }: MiniMapProps) {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const [open, setOpen] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const { settings, items } = project;
  const W = Math.max(settings.box.width, 1);
  const D = Math.max(settings.box.depth, 1);
  const usable = summary.usable;

  const rects = useMemo(() => items.map((i) => safeItemRect(i, settings, items)), [items, settings]);
  /** Lowest first, so higher items are drawn over the ones they rest on. */
  const order = useMemo(() => items.map((_, i) => i).sort((a, b) => rects[a].z - rects[b].z || a - b), [items, rects]);
  const features = useMemo(
    () =>
      items.map((item, idx): TopViewFeature[] => {
        const def = findBoxType(item.type);
        if (!def || rects[idx].broken) return [];
        try {
          return def.draw(resolveItem(item, settings, items)).filter((f) => f.kind === 'rect');
        } catch {
          return [];
        }
      }),
    [items, settings, rects],
  );
  const errors = useMemo(() => errorItemIds(summary), [summary]);
  const warnings = useMemo(() => warningItemIds(summary), [summary]);

  /** Game‑frame point under the cursor (the drawing is flipped: svg y = D − game y). */
  const toGame = (e: ReactPointerEvent) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: D - p.y };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = toGame(e);
    if (!p) return;
    // Topmost item (highest, then latest in stack order) under the point.
    let hit = -1;
    for (const idx of order) {
      const r = rects[idx];
      if (p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.depth) hit = idx;
    }
    if (hit >= 0) select(items[hit].id);
    onFocus(Math.min(Math.max(p.x, 0), W), Math.min(Math.max(p.y, 0), D));
  };

  const H = Math.round((MAP_W * (D + 2 * PAD)) / (W + 2 * PAD));
  const sel = items.findIndex((i) => i.id === selectedId);

  return (
    <div className={`minimap ${open ? '' : 'collapsed'}`} onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="minimap-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Hide the map' : 'Show a top‑down map of the game box'}
      >
        {open ? '▾' : '▸'} Map
      </button>
      {open && (
        <svg
          ref={svgRef}
          role="img"
          aria-label="Top‑down map of the game box; click to centre the 3D view there"
          width={MAP_W}
          height={H}
          viewBox={`${-PAD} ${-PAD} ${W + 2 * PAD} ${D + 2 * PAD}`}
          onPointerDown={onPointerDown}
        >
          {/* y up: game (x, y) → svg (x, D − y) */}
          <g transform={`translate(0 ${D}) scale(1 -1)`}>
            <rect className="mm-box" x={0} y={0} width={W} height={D} />
            {usable.width > 0 && usable.depth > 0 && (
              <rect className="mm-usable" x={usable.x} y={usable.y} width={usable.width} height={usable.depth} />
            )}
            {order.map((idx) => {
              const item = items[idx];
              const r = rects[idx];
              const rotated = item.rotation === 90;
              const localD = rotated ? r.width : r.depth;
              const status = errors.has(item.id) ? 'error' : warnings.has(item.id) ? 'warning' : '';
              return (
                <g
                  key={item.id}
                  className={`mm-item tint-${tints.get(item.id) ?? 'normal'} ${status}`}
                  transform={`translate(${r.x} ${r.y})`}
                >
                  <title>{item.label}</title>
                  <rect className="mm-outer" x={0} y={0} width={r.width} height={r.depth} />
                  {/* Same local → placed mapping as placementMatrix: (u, v) → (d − v, u) at 90°. */}
                  <g transform={rotated ? `translate(${localD} 0) rotate(90)` : undefined}>
                    {features[idx].map((f, i) =>
                      f.kind === 'rect' ? (
                        <rect key={i} className={`mm-feat mm-${f.role}`} x={f.x} y={f.y} width={Math.max(0, f.w)} height={Math.max(0, f.h)} />
                      ) : null,
                    )}
                  </g>
                </g>
              );
            })}
            {sel >= 0 && (
              <rect className="mm-selection" x={rects[sel].x} y={rects[sel].y} width={rects[sel].width} height={rects[sel].depth} />
            )}
          </g>
        </svg>
      )}
    </div>
  );
}
