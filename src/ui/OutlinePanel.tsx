import { useEffect, useMemo, useRef, useState } from 'react';
import { errorItemIds, layoutSummary, warningItemIds } from '../model/layout';
import { buildStackTree, dropBeforeIndex, flattenStackTree } from '../model/stackTree';
import { useStore } from '../state/store';

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function OutlinePanel() {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const reorderItem = useStore((s) => s.reorderItem);
  const [open, setOpen] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<string | null>(null);

  const { rows, errors, warnings } = useMemo(() => {
    const summary = layoutSummary(project.items, project.settings);
    return {
      rows: flattenStackTree(buildStackTree(project.items, project.settings)),
      errors: errorItemIds(summary),
      warnings: warningItemIds(summary),
    };
  }, [project]);

  useEffect(() => {
    if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  useEffect(() => {
    if (pendingFocus.current) {
      rowRefs.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [project.items]);

  const move = (id: string, delta: number) => {
    const from = project.items.findIndex((i) => i.id === id);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= project.items.length) return;
    pendingFocus.current = id;
    reorderItem(id, to);
  };

  const drop = (targetId: string) => {
    const from = project.items.findIndex((i) => i.id === dragId);
    const before = project.items.findIndex((i) => i.id === targetId);
    setDragId(null);
    setOverId(null);
    if (from < 0 || before < 0 || from === before) return;
    reorderItem(project.items[from].id, dropBeforeIndex(from, before));
  };

  return (
    <section className="panel outline-panel" aria-label="Stacks">
      <h2>
        <button type="button" className="outline-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} Stacks
        </button>
      </h2>
      {open && (
        <>
          <p className="muted outline-hint">Drag to change stack order (lower = earlier = underneath)</p>
          {rows.length === 0 ? (
            <p className="muted">No items.</p>
          ) : (
            <div className="outline-tree" role="tree">
              {rows.map((n) => {
                const id = n.item.id;
                const status = errors.has(id) ? 'error' : warnings.has(id) ? 'warning' : 'ok';
                return (
                  <div
                    key={id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(id, el);
                      else rowRefs.current.delete(id);
                    }}
                    role="treeitem"
                    aria-selected={id === selectedId}
                    aria-level={n.depth + 1}
                    tabIndex={0}
                    draggable
                    className={`outline-row${id === selectedId ? ' selected' : ''}${
                      dragId === id ? ' dragging' : ''
                    }${overId === id && dragId !== id ? ' drop-before' : ''}`}
                    style={{ paddingLeft: 6 + n.depth * 14 }}
                    onClick={() => select(id)}
                    onKeyDown={(e) => {
                      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                        e.preventDefault();
                        e.stopPropagation();
                        move(id, e.key === 'ArrowUp' ? -1 : 1);
                      } else if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(id);
                      }
                    }}
                    onDragStart={(e) => {
                      setDragId(id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', id);
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      setOverId(id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      drop(id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    title={`Stack position ${n.index + 1}. Drop another row here to place it before this one.`}
                  >
                    <span className={`outline-dot ${status}`} title={status} aria-label={status} />
                    <span className="outline-label">{n.item.label}</span>
                    <span className="muted outline-type">{n.item.type}</span>
                    <span className="muted outline-z">z {f1(n.z)} mm</span>
                    {n.alsoOn.length > 0 && <span className="muted outline-also">also on: {n.alsoOn.join(', ')}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
