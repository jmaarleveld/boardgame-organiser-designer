import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppServices } from './integration';
import { ServicesProvider } from './integration';
import { useStore } from './state/store';
import { layoutSummary } from './model/layout';
import { Palette } from './ui/Palette';
import { SettingsPanel } from './ui/SettingsPanel';
import { TopView } from './ui/TopView';
import { Inspector } from './ui/Inspector';
import { ValidationPanel } from './ui/ValidationPanel';
import { StatusBar } from './ui/StatusBar';
import { BggLookup } from './ui/BggLookup';
import { ItemExportButtons, PreviewPane } from './ui/PreviewPane';
import { saveBlob, safeFileName } from './ui/download';
import './ui/app.css';

export interface AppProps {
  services: AppServices;
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function App({ services }: AppProps) {
  const { persistence, exporter } = services;
  const project = useStore((s) => s.project);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const summary = useMemo(() => layoutSummary(project.items, project.settings), [project]);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);

  /* ---- autosave / restore ---- */
  useEffect(() => {
    if (!persistence || loadedRef.current) return;
    loadedRef.current = true;
    try {
      const saved = persistence.load();
      if (saved) {
        useStore.getState().loadProject(saved);
        useStore.setState({ past: [], future: [] });
      }
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not restore autosave: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [persistence]);

  useEffect(() => {
    if (!persistence || !loadedRef.current) return;
    const t = setTimeout(() => {
      try {
        persistence.save(project);
      } catch {
        /* storage full / unavailable: ignore */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [persistence, project]);

  /* ---- keyboard shortcuts ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      const sel = s.project.items.find((i) => i.id === s.selectedId);
      if (!sel) {
        if (e.key === 'Escape') s.select(null);
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        s.duplicateItem(sel.id);
        return;
      }
      if (mod || e.altKey) return;
      if (key === 'r') {
        e.preventDefault();
        s.rotateItem(sel.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.removeItem(sel.id);
      } else if (e.key === 'Escape') {
        s.select(null);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = (s.project.settings.gridSnap > 0 ? s.project.settings.gridSnap : 1) * (e.shiftKey ? 10 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.moveItem(sel.id, sel.x + dx, sel.y + dy);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- toolbar actions ---- */
  const onNew = () => {
    if (project.items.length && !window.confirm('Start a new project? Unsaved changes can be undone with Ctrl+Z.')) return;
    useStore.getState().newProject();
  };

  const onOpenFile = async (file: File) => {
    if (!persistence) return;
    try {
      const text = await file.text();
      useStore.getState().loadProject(persistence.fromJson(text));
      setNotice({ kind: 'info', text: `Opened ${file.name}` });
    } catch (e) {
      setNotice({ kind: 'error', text: `Could not open ${file.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const onSave = () => {
    if (!persistence) return;
    const json = persistence.toJson(project);
    saveBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(project.settings.name)}.json`);
  };

  const onExportAll = async () => {
    if (!exporter || exporting) return;
    setExporting('Starting…');
    setNotice(null);
    try {
      const blob = await exporter.exportAll(project, (p) =>
        setExporting(`${p.done}/${p.total}${p.currentLabel ? ` · ${p.currentLabel}` : ''}`),
      );
      saveBlob(blob, `${safeFileName(project.settings.name)}.zip`);
    } catch (e) {
      setNotice({ kind: 'error', text: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setExporting(null);
    }
  };

  const missing = (what: string) => `${what} is not available`;
  const s = useStore.getState();

  return (
    <ServicesProvider services={services}>
      <div className="app">
        <header className="toolbar" role="toolbar" aria-label="Main toolbar">
          <span className="brand">Insert Designer</span>
          <button type="button" onClick={onNew}>
            New
          </button>
          <button
            type="button"
            disabled={!persistence}
            title={persistence ? 'Open a project JSON file' : missing('Persistence')}
            onClick={() => fileRef.current?.click()}
          >
            Open
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onOpenFile(f);
            }}
          />
          <button
            type="button"
            disabled={!persistence}
            title={persistence ? 'Save the project as JSON' : missing('Persistence')}
            onClick={onSave}
          >
            Save
          </button>
          <span className="sep" />
          <button
            type="button"
            disabled={!exporter || !project.items.length || !!exporting}
            title={exporter ? 'Export every box as STL (zip)' : missing('Exporter')}
            onClick={() => void onExportAll()}
          >
            {exporting ? `Exporting ${exporting}` : 'Export all STL'}
          </button>
          <span className="sep" />
          <button type="button" disabled={!canUndo} onClick={s.undo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" disabled={!canRedo} onClick={s.redo} title="Redo (Ctrl+Y)">
            Redo
          </button>
          {notice && (
            <span className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
              <button type="button" className="link" onClick={() => setNotice(null)} aria-label="Dismiss">
                ×
              </button>
            </span>
          )}
        </header>

        <aside className="left">
          <SettingsPanel bggSlot={<BggLookup />} />
          <Palette />
        </aside>

        <main className="centre">
          <TopView summary={summary} />
        </main>

        <aside className="right">
          <Inspector previewSlot={<PreviewPane />} exportSlot={<ItemExportButtons />} />
          <ValidationPanel summary={summary} />
        </aside>

        <StatusBar summary={summary} />
      </div>
    </ServicesProvider>
  );
}
