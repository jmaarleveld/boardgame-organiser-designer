import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppServices } from './integration';
import { ServicesProvider } from './integration';
import { useStore } from './state/store';
import { layoutSummary } from './model/layout';
import { nudgeDelta } from './model/drag';
import { Palette } from './ui/Palette';
import { OutlinePanel } from './ui/OutlinePanel';
import { SettingsPanel } from './ui/SettingsPanel';
import { FinishPanel } from './ui/FinishPanel';
import { Inspector } from './ui/Inspector';
import { ValidationPanel } from './ui/ValidationPanel';
import { StatusBar } from './ui/StatusBar';
import BggLookup from './services/BggLookup';
import { ItemExportButtons, PreviewTabs } from './ui/PreviewPane';
import { downloadBlob as saveBlob, safeFileName } from './services/download';
import { sampleProject } from './boxes/sample';
import './ui/app.css';

export interface AppProps {
  services: AppServices;
  /** Retry loading the geometry kernel (shown in the failure banner). */
  onRetryKernel?: () => void;
}

/** Collapsible BGG lookup; fills the game box inner size from the picked version. */
function BggSlot({ services }: { services: AppServices }) {
  const [open, setOpen] = useState(false);
  const setBoxSize = useStore((s) => s.setBoxSize);
  if (!services.bgg) {
    return (
      <button type="button" disabled title="BoardGameGeek lookup is not available">
        Fetch from BoardGameGeek
      </button>
    );
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Fetch from BoardGameGeek
      </button>
    );
  }
  return (
    <>
      <div className="row">
        <span className="muted">BoardGameGeek lookup</span>
        <button type="button" className="link" onClick={() => setOpen(false)} aria-label="Close BoardGameGeek lookup">
          ×
        </button>
      </div>
      <BggLookup
        client={services.bgg}
        onPick={(d) => {
          setBoxSize({ width: d.widthMm, depth: d.depthMm, height: d.heightMm });
          setOpen(false);
        }}
      />
    </>
  );
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function App({ services, onRetryKernel }: AppProps) {
  const { persistence, exporter } = services;
  const project = useStore((s) => s.project);
  const kernelReady = useStore((s) => s.kernelReady);
  const kernelError = useStore((s) => s.kernelError);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const summary = useMemo(() => layoutSummary(project.items, project.settings), [project]);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);
  const { AssemblyView } = services;

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
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Undo/redo also apply while a field has focus: every keystroke in a
      // field is already committed to the project, so the browser's own text
      // undo would re-commit the old text as a new change instead of undoing.
      if (mod && !e.altKey && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e.target)) return;
      const sel = s.project.items.find((i) => i.id === s.selectedId);
      if (!sel) {
        if (e.key === 'Escape') s.select(null);
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        if (e.shiftKey) s.duplicateItemStacked(sel.id);
        else s.duplicateItem(sel.id);
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
        const step = (s.project.settings.gridSnap > 0 ? s.project.settings.gridSnap : 1) * (e.shiftKey ? 10 : 1);
        const d = nudgeDelta(e.key, step);
        if (!d) return;
        e.preventDefault();
        s.moveItem(sel.id, sel.x + d.dx, sel.y + d.dy);
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

  const onLoadSample = () => {
    if (project.items.length && !window.confirm('Replace the current project with the sample? You can undo with Ctrl+Z.')) return;
    useStore.getState().loadProject(sampleProject());
    setNotice({ kind: 'info', text: 'Loaded the sample project' });
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
          <button type="button" onClick={onLoadSample} title="Load a demo project with one of each box type">
            Load sample
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
            disabled={!exporter || !kernelReady || !project.items.length || !!exporting}
            title={
              !exporter
                ? missing('Exporter')
                : kernelError
                  ? 'Geometry engine failed to load'
                  : !kernelReady
                    ? 'Loading the geometry engine…'
                    : 'Export every box as STL (zip)'
            }
            onClick={() => void onExportAll()}
          >
            {exporting
              ? `Exporting ${exporting}`
              : exporter && !kernelReady && !kernelError
                ? 'Export all STL (loading geometry…)'
                : 'Export all STL'}
          </button>
          <span className="sep" />
          <button type="button" disabled={!canUndo} onClick={s.undo} title="Undo (Ctrl+Z)" aria-keyshortcuts="Control+Z">
            ↶ Undo
          </button>
          <button type="button" disabled={!canRedo} onClick={s.redo} title="Redo (Ctrl+Y or Ctrl+Shift+Z)" aria-keyshortcuts="Control+Y Control+Shift+Z">
            ↷ Redo
          </button>
          {notice && (
            <span className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
              <button type="button" className="link" onClick={() => setNotice(null)} aria-label="Dismiss">
                ×
              </button>
            </span>
          )}
          {kernelError && (
            <div className="kernel-banner" role="alert">
              <span>
                Geometry engine failed to load — 3D preview and STL export are unavailable. ({kernelError})
              </span>
              {onRetryKernel && (
                <button type="button" onClick={onRetryKernel}>
                  Retry
                </button>
              )}
            </div>
          )}
        </header>

        <aside className="left">
          <SettingsPanel bggSlot={<BggSlot services={services} />} />
          <Palette />
          <OutlinePanel />
          <FinishPanel />
        </aside>

        <main className="centre">
          {AssemblyView ? (
            <AssemblyView editable />
          ) : (
            <div className="centre-msg muted">The 3D editor is not available.</div>
          )}
        </main>

        <aside className="right">
          <Inspector previewSlot={<PreviewTabs />} exportSlot={<ItemExportButtons />} />
          <ValidationPanel summary={summary} />
        </aside>

        <StatusBar summary={summary} />
      </div>
    </ServicesProvider>
  );
}
