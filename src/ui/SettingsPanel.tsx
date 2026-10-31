import type { ReactNode } from 'react';
import { useStore } from '../state/store';
import { NumberField } from './NumberField';

export interface SettingsPanelProps {
  /** BGG lookup UI, rendered next to the box size. */
  bggSlot?: ReactNode;
}

export function SettingsPanel({ bggSlot }: SettingsPanelProps) {
  const settings = useStore((s) => s.project.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setBoxSize = useStore((s) => s.setBoxSize);

  return (
    <section className="panel settings" aria-label="Project settings">
      <h2>Project</h2>
      <label className="field wide">
        <span className="field-label">Name</span>
        <input type="text" value={settings.name} onChange={(e) => setSettings({ name: e.target.value })} />
      </label>

      <h3>Game box (inner)</h3>
      <div className="grid3">
        <NumberField label="Width" unit="mm" min={1} value={settings.box.width} onChange={(v) => setBoxSize({ width: v })} />
        <NumberField label="Depth" unit="mm" min={1} value={settings.box.depth} onChange={(v) => setBoxSize({ depth: v })} />
        <NumberField label="Height" unit="mm" min={1} value={settings.box.height} onChange={(v) => setBoxSize({ height: v })} />
      </div>
      {bggSlot && <div className="bgg-slot">{bggSlot}</div>}

      <h3>Tolerance (total slack)</h3>
      <div className="grid2">
        <NumberField label="X" unit="mm" min={0} value={settings.tolerance.x} onChange={(v) => setSettings({ tolerance: { x: v } })} />
        <NumberField label="Y" unit="mm" min={0} value={settings.tolerance.y} onChange={(v) => setSettings({ tolerance: { y: v } })} />
      </div>

      <h3>Defaults</h3>
      <div className="grid3">
        <NumberField label="Wall" unit="mm" min={0.1} value={settings.defaults.wall} onChange={(v) => setSettings({ defaults: { wall: v } })} />
        <NumberField label="Floor" unit="mm" min={0.1} value={settings.defaults.floor} onChange={(v) => setSettings({ defaults: { floor: v } })} />
        <NumberField
          label="Grid snap"
          unit="mm"
          min={0}
          step={0.5}
          title="0 disables grid snapping"
          value={settings.gridSnap}
          onChange={(v) => setSettings({ gridSnap: v })}
        />
      </div>
    </section>
  );
}
