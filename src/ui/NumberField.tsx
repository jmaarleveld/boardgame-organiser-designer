import { useId, useState } from 'react';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}

const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '');

/**
 * Number input that keeps its own text while typing (so "", "1." or "-" do not
 * get clobbered) and commits every valid, in-range value immediately.
 */
export function NumberField(props: NumberFieldProps) {
  const { label, value, onChange, min, max, step = 0.1, unit, disabled, title, className } = props;
  const id = useId();
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);

  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    // Sync external changes (undo, drag…) unless the user is mid-edit on an equal value.
    setPrevValue(value);
    if (!focused || Number(text) !== value) setText(fmt(value));
  }

  const parse = (t: string): number | null => {
    if (t.trim() === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    if (min !== undefined && n < min) return null;
    if (max !== undefined && n > max) return null;
    return n;
  };
  const invalid = parse(text) === null;

  return (
    <label className={`field ${className ?? ''}`} htmlFor={id} title={title}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setText(fmt(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = parse(e.target.value);
            if (n !== null && n !== value) onChange(n);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}
