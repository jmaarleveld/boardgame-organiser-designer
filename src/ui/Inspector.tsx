import type { ReactNode } from 'react';
import { useStore } from '../state/store';
import { findBoxType } from '../boxes/registry';
import { resolveItem } from '../model/resolve';
import { safeItemRect } from '../model/layout';
import { NumberField } from './NumberField';
import { ParamForm } from './ParamForm';

export interface InspectorProps {
  /** 3D preview of the selected item. */
  previewSlot?: ReactNode;
  /** Export buttons for the selected item. */
  exportSlot?: ReactNode;
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function Inspector({ previewSlot, exportSlot }: InspectorProps) {
  const project = useStore((s) => s.project);
  const selectedId = useStore((s) => s.selectedId);
  const updateItem = useStore((s) => s.updateItem);
  const setParam = useStore((s) => s.setParam);
  const moveItem = useStore((s) => s.moveItem);
  const rotateItem = useStore((s) => s.rotateItem);
  const removeItem = useStore((s) => s.removeItem);
  const duplicateItem = useStore((s) => s.duplicateItem);
  const duplicateItemStacked = useStore((s) => s.duplicateItemStacked);

  const item = project.items.find((i) => i.id === selectedId);
  // The preview slot is rendered at the same position with and without a
  // selection so its state (active tab, 3D camera) survives selection changes.
  if (!item) {
    return (
      <section className="panel inspector" aria-label="Inspector">
        <div className="inspector-body">
          <h2>Inspector</h2>
          <p className="muted">Select a box in the 3D editor or the Stacks list, or add one from the palette.</p>
        </div>
        {previewSlot && <div className="preview-slot">{previewSlot}</div>}
      </section>
    );
  }

  const { settings, items } = project;
  const def = findBoxType(item.type);
  const rect = safeItemRect(item, settings, items);
  let messages: string[] = [];
  let resolvedParams = item.params;
  let basedOn: { itemIds: string[]; note: string } | null = null;
  if (def) {
    try {
      const resolved = resolveItem(item, settings, items);
      resolvedParams = resolved.params;
      messages = def.validate?.(resolved) ?? [];
      basedOn = def.describeContext?.(resolved) ?? null;
    } catch (e) {
      messages = [String(e)];
    }
  }

  return (
    <section className="panel inspector" aria-label="Inspector">
      <div className="inspector-body">
        <h2>{def?.name ?? `Unknown type "${item.type}"`}</h2>
        <label className="field wide">
          <span className="field-label">Label</span>
          <input type="text" value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} />
        </label>

        <div className="grid2">
          <NumberField label="X" unit="mm" value={item.x} onChange={(v) => moveItem(item.id, v, item.y)} />
          <NumberField label="Y" unit="mm" value={item.y} onChange={(v) => moveItem(item.id, item.x, v)} />
        </div>
        <div className="row">
          <span className="muted">Rotation {item.rotation}°</span>
          <button type="button" onClick={() => rotateItem(item.id)} title="Rotate 90° (R)">
            Rotate
          </button>
        </div>

        <h3>Elevation</h3>
        <p className="elevation" aria-label="Elevation">
          Rests at z = {f1(rect.z)} mm · top at <span className="elevation-top">{f1(rect.top)} mm</span>
        </p>
        <p className="muted">Items rest on whatever is under them; the stack order decides what is on top.</p>
        <div className="row">
          <button type="button" onClick={() => duplicateItemStacked(item.id)} title="Duplicate on top of this item (Ctrl+Shift+D)">
            Duplicate on top
          </button>
        </div>

        <h3>Thickness</h3>
        <OverrideField
          label="Wall"
          value={item.wall}
          fallback={settings.defaults.wall}
          onChange={(v) => updateItem(item.id, { wall: v })}
        />
        <OverrideField
          label="Floor"
          value={item.floor}
          fallback={settings.defaults.floor}
          onChange={(v) => updateItem(item.id, { floor: v })}
        />

        {def && def.params.length > 0 && (
          <>
            <h3>Parameters</h3>
            <ParamForm specs={def.params} values={resolvedParams} onChange={(k, v) => setParam(item.id, k, v)} />
          </>
        )}

        {basedOn && (
          <div className="based-on" aria-label="Geometry based on">
            {basedOn.itemIds.length > 0 && <span className="field-label">Geometry based on</span>}
            {basedOn.itemIds.length > 0 && (
              <ul>
                {basedOn.itemIds.map((id) => (
                  <li key={id}>{items.find((i) => i.id === id)?.label || id}</li>
                ))}
              </ul>
            )}
            <p className="muted">{basedOn.note}</p>
          </div>
        )}

        <p className="footprint">
          Outer {f1(rect.width)} × {f1(rect.depth)} × {f1(rect.height)} mm · top at {f1(rect.top)} mm
          {rect.broken && <span className="error-text"> (footprint unavailable)</span>}
        </p>

        {messages.length > 0 && (
          <ul className="messages" aria-label="Parameter problems">
            {messages.map((m, i) => (
              <li key={i} className="warning">
                {m}
              </li>
            ))}
          </ul>
        )}

        <div className="row">
          <button type="button" onClick={() => duplicateItem(item.id)} title="Duplicate (Ctrl+D)">
            Duplicate
          </button>
          <button type="button" className="danger" onClick={() => removeItem(item.id)} title="Delete (Del)">
            Delete
          </button>
        </div>
      </div>

      {previewSlot && <div className="preview-slot">{previewSlot}</div>}
      {exportSlot && <div className="export-slot">{exportSlot}</div>}
    </section>
  );
}

function OverrideField(props: { label: string; value: number | undefined; fallback: number; onChange(v: number | undefined): void }) {
  const { label, value, fallback, onChange } = props;
  const overridden = value !== undefined;
  return (
    <div className="override">
      <label className="field check">
        <input
          type="checkbox"
          checked={overridden}
          onChange={(e) => onChange(e.target.checked ? fallback : undefined)}
        />
        <span className="field-label">{label}: override project default</span>
      </label>
      <NumberField
        label={label}
        unit="mm"
        min={0.1}
        value={value ?? fallback}
        disabled={!overridden}
        onChange={(v) => onChange(v)}
      />
    </div>
  );
}
