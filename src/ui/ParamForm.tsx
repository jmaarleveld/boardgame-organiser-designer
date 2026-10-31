import type { ItemParams, ParamValue } from '../model/types';
import type { ParamSpec } from '../boxes/types';
import { NumberField } from './NumberField';

export interface ParamFormProps {
  specs: ParamSpec[];
  /** Resolved params (defaults applied). */
  values: ItemParams;
  onChange(key: string, value: ParamValue): void;
}

/** Generic form for a box type's ParamSpec list. */
export function ParamForm({ specs, values, onChange }: ParamFormProps) {
  const visible = specs.filter((s) => {
    try {
      return s.visibleIf ? s.visibleIf(values) : true;
    } catch {
      return true;
    }
  });
  const groups: { name: string | undefined; specs: ParamSpec[] }[] = [];
  for (const s of visible) {
    let g = groups.find((x) => x.name === s.group);
    if (!g) {
      g = { name: s.group, specs: [] };
      groups.push(g);
    }
    g.specs.push(s);
  }

  return (
    <div className="param-form">
      {groups.map((g) => (
        <fieldset key={g.name ?? '_'} className="param-group">
          {g.name && <legend>{g.name}</legend>}
          {g.specs.map((s) => (
            <ParamField key={s.key} spec={s} value={values[s.key]} onChange={(v) => onChange(s.key, v)} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function ParamField({ spec, value, onChange }: { spec: ParamSpec; value: ParamValue | undefined; onChange(v: ParamValue): void }) {
  switch (spec.kind) {
    case 'number':
      return (
        <NumberField
          label={spec.label}
          title={spec.help}
          value={typeof value === 'number' ? value : spec.default}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? (spec.unit === 'count' ? 1 : 0.1)}
          unit={spec.unit === 'mm' ? 'mm' : undefined}
          onChange={onChange}
        />
      );
    case 'boolean':
      return (
        <label className="field check" title={spec.help}>
          <input
            type="checkbox"
            checked={typeof value === 'boolean' ? value : spec.default}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="field-label">{spec.label}</span>
        </label>
      );
    case 'select':
      return (
        <label className="field" title={spec.help}>
          <span className="field-label">{spec.label}</span>
          <span className="field-input">
            <select value={typeof value === 'string' ? value : spec.default} onChange={(e) => onChange(e.target.value)}>
              {spec.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        </label>
      );
  }
}
